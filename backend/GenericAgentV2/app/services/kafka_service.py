"""
GenericAgent v2 Kafka consumer — multi-agent mode.

Loads active AgentDefinitions that declare `data_queries` (the data-aware ones)
and spawns one consumer task per definition. Same Kafka contract as v1 — subscribes
to each definition's input_topic and publishes to its output_topic — so it drops
into pipelines and is gated by GenericValidator unchanged.
"""
from __future__ import annotations

import asyncio
import logging

from app.utils.config_client import load_all_definitions
from app.utils.kafka import get_consumer, get_producer
from app.services.generic_agent_v2 import process_message

logger = logging.getLogger(__name__)


async def _run_agent(definition: dict) -> None:
    """Consumer loop for a single AgentDefinition. Restarts on error."""
    name = definition["name"]
    input_topic: str = definition["input_topic"]
    output_topic: str = definition["output_topic"]
    group_id = f"generic-v2-{name}"

    logger.info("GenericAgentV2[%s]: starting — input=%s output=%s", name, input_topic, output_topic)

    while True:
        consumer = None
        producer = None
        try:
            await asyncio.sleep(5)

            consumer = await get_consumer(input_topic, group_id)
            producer = await get_producer()

            async for msg in consumer:
                data: dict = msg.value
                job_id = data.get("job_id", "unknown")
                logger.info("GenericAgentV2[%s]: processing job %s", name, job_id)

                try:
                    result = await process_message(data, definition)
                    await producer.send_and_wait(output_topic, result)
                    logger.info("GenericAgentV2[%s]: job %s → %s", name, job_id, output_topic)
                except Exception:
                    logger.exception("GenericAgentV2[%s]: error processing job %s", name, job_id)
                    await producer.send_and_wait(output_topic, {
                        "job_id": job_id,
                        "step_name": data.get("step_name", name),
                        "error": f"GenericAgentV2[{name}] failed for job {job_id}",
                        "agent": name,
                    })

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("GenericAgentV2[%s]: consumer error — reconnecting in 10s", name)
            await asyncio.sleep(10)
        finally:
            if consumer:
                await consumer.stop()
            if producer:
                await producer.stop()


async def consume_loop() -> None:
    """Load data-aware definitions, spawn one task per agent, run until cancelled."""
    definitions = load_all_definitions()
    if not definitions:
        logger.warning("GenericAgentV2: no active data-aware agent definitions found — idling")
        await asyncio.Event().wait()
        return

    logger.info("GenericAgentV2: launching %d agent tasks: %s", len(definitions), [d["name"] for d in definitions])
    tasks = [asyncio.create_task(_run_agent(d)) for d in definitions]
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
