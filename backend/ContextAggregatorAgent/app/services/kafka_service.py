"""
Kafka consumer loop for ContextAggregatorAgent.

Subscribes to a single fan-in topic. Multiple upstream agents all publish
their outputs to this topic with a "source_agent" field. The aggregator
tracks per-job quorum in memory, then synthesizes once all required sources
have arrived (or timeout is hit with min_required_inputs met).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import defaultdict

from app.services.aggregator_service import synthesize
from app.utils.config_client import load_definition, reload

logger = logging.getLogger(__name__)

AGGREGATOR_NAME = os.getenv("AGGREGATOR_NAME", "aggregator")

# Per-job input buffer: {job_id: {source_agent: message_dict}}
_job_buffers: dict[str, dict[str, dict]] = defaultdict(dict)
# Per-job arrival timestamps for timeout enforcement
_job_first_arrival: dict[str, float] = {}
# Per-job scenario context (scenario/region/...) echoed onto the synthesis output so a
# downstream cyclic loop (negotiation re-entry) keeps the scenario across rounds.
_job_context: dict[str, dict] = {}

# Scenario-context fields threaded through the pipeline and echoed back on the output.
_CONTEXT_KEYS = ("scenario", "region", "transcript", "current_policy", "peer_feedback", "iteration")


def _buffer_source(job_id: str, source_agent: str, output, confidence=1.0, urgency: str = "") -> None:
    """Record one source's contribution in the per-job buffer."""
    _job_buffers[job_id][source_agent] = {
        "content": json.dumps(output) if isinstance(output, (dict, list)) else str(output),
        "output": output,
        "confidence": confidence,
        "urgency": urgency,
    }


async def _check_quorum(
    job_id: str,
    definition: dict,
    producer,
) -> None:
    """Check if quorum is met for a job; synthesize if so."""
    sources = definition.get("input_sources", [])
    required = [s["agent_name"] for s in sources if s.get("required", True)]
    timeout_s = definition.get("timeout_seconds", 60)
    min_required = definition.get("min_required_inputs", 1)
    # Self-validates — publish directly to the .validated topic so pipeline_router picks it up
    base_output_topic = definition.get("output_topic", "aggregator.completed")
    output_topic = f"{base_output_topic}.validated"

    arrived = _job_buffers.get(job_id, {})
    arrived_required = [a for a in arrived if a in required]
    all_arrived = all(r in arrived for r in required)

    elapsed = time.monotonic() - _job_first_arrival.get(job_id, time.monotonic())
    timed_out = elapsed >= timeout_s
    partial_ok = timed_out and len(arrived_required) >= min_required

    if not (all_arrived or partial_ok):
        return

    inputs = dict(arrived)
    # Clean up buffers
    _job_buffers.pop(job_id, None)
    _job_first_arrival.pop(job_id, None)
    ctx = _job_context.pop(job_id, {})

    if timed_out and not all_arrived:
        missing = [r for r in required if r not in inputs]
        logger.warning(
            "Job %s: timeout after %.1fs — synthesizing with partial inputs (missing: %s)",
            job_id, elapsed, missing,
        )

    try:
        result = await synthesize(job_id, inputs)
        # Echo scenario context so a downstream cyclic loop keeps it across negotiation rounds.
        await producer.send_and_wait(output_topic, {
            **ctx,
            "job_id": job_id,
            "step_name": AGGREGATOR_NAME,
            "output": result,
            "status_code": 200,
            "confidence": result.get("confidence", 1.0),
        })
        logger.info("Job %s: synthesis complete → %s", job_id, output_topic)
    except Exception as exc:
        logger.exception("Job %s: synthesis failed: %s", job_id, exc)
        await producer.send_and_wait("validation.failed", {
            "job_id": job_id,
            "step_name": AGGREGATOR_NAME,
            "rule_violated": "aggregation_failed",
            "error_detail": str(exc),
        })


async def _timeout_watchdog(definition: dict, producer) -> None:
    """Background task — checks for timed-out jobs every 5s."""
    timeout_s = definition.get("timeout_seconds", 60)
    while True:
        await asyncio.sleep(5)
        now = time.monotonic()
        expired = [
            jid for jid, t in list(_job_first_arrival.items())
            if now - t >= timeout_s
        ]
        for jid in expired:
            try:
                await _check_quorum(jid, definition, producer)
            except Exception:
                logger.exception("Timeout watchdog error for job %s", jid)


async def consume_loop() -> None:
    """Main consumer loop — restarts automatically on errors."""
    from civis_obs.kafka_utils import get_consumer, get_producer

    while True:
        consumer = None
        producer = None
        watchdog_task = None
        try:
            await asyncio.sleep(5)
            reload()
            definition = load_definition()
            input_topic: str = definition["input_topic"]

            logger.info(
                "ContextAggregatorAgent[%s] connecting — input=%s output=%s sources=%s",
                AGGREGATOR_NAME,
                input_topic,
                definition.get("output_topic"),
                [s["agent_name"] for s in definition.get("input_sources", [])],
            )

            consumer = await get_consumer(input_topic, f"aggregator-{AGGREGATOR_NAME}")
            producer = await get_producer()

            watchdog_task = asyncio.create_task(
                _timeout_watchdog(definition, producer)
            )

            async for msg in consumer:
                data: dict = msg.value
                job_id = data.get("job_id")
                if not job_id:
                    continue

                # Record arrival timestamp + capture scenario context (for the cyclic loop)
                if job_id not in _job_first_arrival:
                    _job_first_arrival[job_id] = time.monotonic()
                ctx = _job_context.setdefault(job_id, {})
                for k in _CONTEXT_KEYS:
                    v = data.get(k)
                    if v not in (None, ""):
                        ctx[k] = v

                required_count = len([s for s in definition.get("input_sources", []) if s.get("required", True)])

                # The Pipeline Router's merger_input fan-in delivers ONE message carrying an
                # `aggregated` dict {source_node_key: output} — expand it into per-source buckets
                # so this aggregator's quorum + conflict detection sees each advisor individually.
                aggregated = data.get("aggregated")
                if isinstance(aggregated, dict) and aggregated:
                    for src_name, out in aggregated.items():
                        conf = out.get("confidence", 1.0) if isinstance(out, dict) else 1.0
                        urg = out.get("urgency", "") if isinstance(out, dict) else ""
                        _buffer_source(job_id, src_name, out, conf, urg)
                    arrived_count = len(_job_buffers[job_id])
                    logger.info(
                        "Job %s: fan-in delivered %d sources (%s) — %d/%d required",
                        job_id, len(aggregated), list(aggregated.keys()), arrived_count, required_count,
                    )
                    await producer.send_and_wait("aggregator.partial", {
                        "job_id": job_id,
                        "arrived_agent": list(aggregated.keys()),
                        "inputs_received": arrived_count,
                        "inputs_required": required_count,
                        "aggregator": AGGREGATOR_NAME,
                    })
                    await _check_quorum(job_id, definition, producer)
                    continue

                # Single-source path: each upstream agent publishes individually with a tag.
                source_agent = data.get("source_agent") or data.get("step_name", "unknown")
                output = data.get("output") or data.get("content") or data.get("transcript", "")
                confidence = data.get("confidence", 1.0)
                _buffer_source(job_id, source_agent, output, confidence, data.get("urgency", ""))

                arrived_count = len(_job_buffers[job_id])
                logger.info(
                    "Job %s: received input from '%s' (confidence=%.2f) — %d/%d required",
                    job_id, source_agent, confidence, arrived_count, required_count,
                )

                # AG-3: publish incremental arrival notification
                await producer.send_and_wait("aggregator.partial", {
                    "job_id": job_id,
                    "arrived_agent": source_agent,
                    "confidence": confidence,
                    "inputs_received": arrived_count,
                    "inputs_required": required_count,
                    "aggregator": AGGREGATOR_NAME,
                })

                await _check_quorum(job_id, definition, producer)

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ContextAggregatorAgent[%s] error — reconnecting in 10s", AGGREGATOR_NAME)
            await asyncio.sleep(10)
        finally:
            if watchdog_task:
                watchdog_task.cancel()
                try:
                    await watchdog_task
                except asyncio.CancelledError:
                    pass
            if consumer:
                await consumer.stop()
            if producer:
                await producer.stop()
