from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from aiokafka import AIOKafkaConsumer, TopicPartition
from aiokafka.admin import AIOKafkaAdminClient

from civis_obs import agent_errors_total, kafka_consumer_lag

logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "kafka:29092")
CONFIG_SERVICE_URL = os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")
SCRAPE_INTERVAL_SECONDS = int(os.getenv("KAFKA_LAG_SCRAPE_INTERVAL_SECONDS", "30"))


@dataclass(frozen=True)
class LagTarget:
    agent_name: str
    topic: str
    group_id: str


BUILTIN_TARGETS: tuple[LagTarget, ...] = (
    LagTarget("audio_preprocessor", "audio.uploaded", "audio-preprocessor-group"),
    LagTarget("stt_agent", "audio.preprocessed", "stt-group"),
    LagTarget("stt_validator", "stt.completed", "stt-validator-group"),
    LagTarget("nlp_agent", "transcript.generated", "nlp-group"),
    LagTarget("nlp_validator", "nlp.completed", "nlp-validator-group"),
    LagTarget("reasoning_agent", "nlp.validated", "reasoning-group"),
    LagTarget("reasoning_validator", "reasoning.completed", "reasoning-validator-group"),
)

REGISTRY_GROUPS = {
    "audio_preprocessor": ("audio_preprocessor", "audio-preprocessor-group"),
    "stt": ("stt_agent", "stt-group"),
    "stt_agent": ("stt_agent", "stt-group"),
    "stt-validator": ("stt_validator", "stt-validator-group"),
    "stt_validator": ("stt_validator", "stt-validator-group"),
    "nlp": ("nlp_agent", "nlp-group"),
    "nlp_agent": ("nlp_agent", "nlp-group"),
    "nlp-validator": ("nlp_validator", "nlp-validator-group"),
    "nlp_validator": ("nlp_validator", "nlp-validator-group"),
    "reasoning-agent": ("reasoning_agent", "reasoning-group"),
    "reasoning_agent": ("reasoning_agent", "reasoning-group"),
    "reasoning-validator": ("reasoning_validator", "reasoning-validator-group"),
    "reasoning_validator": ("reasoning_validator", "reasoning-validator-group"),
}

_snapshot: dict[str, Any] = {
    "items": [],
    "updated_at": None,
    "error": None,
}


def get_lag_snapshot() -> dict[str, Any]:
    return _snapshot


async def _load_targets() -> list[LagTarget]:
    targets: dict[tuple[str, str, str], LagTarget] = {
        (t.agent_name, t.topic, t.group_id): t for t in BUILTIN_TARGETS
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            agents_res, generic_res = await asyncio.gather(
                client.get(f"{CONFIG_SERVICE_URL}/internal/agents/"),
                client.get(f"{CONFIG_SERVICE_URL}/internal/agent-definitions/"),
                return_exceptions=True,
            )

        if isinstance(agents_res, httpx.Response):
            agents_res.raise_for_status()
            for row in agents_res.json():
                if not row.get("is_active", True):
                    continue
                mapped = REGISTRY_GROUPS.get(row.get("name"))
                if not mapped:
                    continue
                agent_name, group_id = mapped
                target = LagTarget(agent_name, row["input_topic"], group_id)
                targets[(target.agent_name, target.topic, target.group_id)] = target

        if isinstance(generic_res, httpx.Response):
            generic_res.raise_for_status()
            definitions = [d for d in generic_res.json() if d.get("is_active", True)]
            for definition in definitions:
                name = definition["name"]
                target = LagTarget(
                    f"generic_{name}",
                    definition["input_topic"],
                    f"generic-{name}",
                )
                targets[(target.agent_name, target.topic, target.group_id)] = target

                validator_target = LagTarget(
                    "generic_validator",
                    definition["output_topic"],
                    "generic-validator-group",
                )
                targets[
                    (
                        validator_target.agent_name,
                        validator_target.topic,
                        validator_target.group_id,
                    )
                ] = validator_target
    except Exception:
        logger.debug("Kafka lag target discovery failed; using built-in targets", exc_info=True)

    return sorted(targets.values(), key=lambda t: (t.agent_name, t.topic, t.group_id))


async def _topic_partitions(admin: AIOKafkaAdminClient, topic: str) -> list[TopicPartition]:
    topic_descriptions = await admin.describe_topics([topic])
    if not topic_descriptions:
        return []

    description = topic_descriptions[0]
    if description.get("error_code") != 0:
        return []

    return [
        TopicPartition(topic, partition["partition"])
        for partition in sorted(description.get("partitions", []), key=lambda p: p["partition"])
    ]


async def collect_kafka_lag() -> list[dict[str, Any]]:
    targets = await _load_targets()
    if not targets:
        return []

    admin = AIOKafkaAdminClient(bootstrap_servers=KAFKA_BOOTSTRAP)
    consumer = AIOKafkaConsumer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        enable_auto_commit=False,
        request_timeout_ms=30_000,
        retry_backoff_ms=500,
    )
    await admin.start()
    await consumer.start()
    try:
        committed_cache: dict[str, dict[TopicPartition, Any]] = {}
        rows: list[dict[str, Any]] = []

        for target in targets:
            partitions = await _topic_partitions(admin, target.topic)
            if not partitions:
                rows.append({
                    "agent_name": target.agent_name,
                    "topic": target.topic,
                    "group_id": target.group_id,
                    "lag": None,
                    "end_offset": None,
                    "committed_offset": None,
                    "partitions": 0,
                    "status": "topic_missing",
                })
                continue

            if target.group_id not in committed_cache:
                try:
                    committed_cache[target.group_id] = await admin.list_consumer_group_offsets(
                        target.group_id
                    )
                except Exception:
                    logger.debug(
                        "Could not read committed offsets for group %s",
                        target.group_id,
                        exc_info=True,
                    )
                    committed_cache[target.group_id] = {}

            end_offsets = await consumer.end_offsets(partitions)
            committed_offsets = committed_cache[target.group_id]

            total_lag = 0
            total_end = 0
            total_committed = 0
            has_commit = False
            for tp in partitions:
                end_offset = int(end_offsets.get(tp, 0) or 0)
                committed = committed_offsets.get(tp)
                committed_offset = getattr(committed, "offset", None)
                total_end += end_offset
                if committed_offset is None or committed_offset < 0:
                    continue
                has_commit = True
                total_committed += int(committed_offset)
                total_lag += max(0, end_offset - int(committed_offset))

            lag_value = total_lag if has_commit else None
            if lag_value is not None:
                kafka_consumer_lag.labels(
                    target.agent_name,
                    target.topic,
                    target.group_id,
                ).set(lag_value)

            rows.append({
                "agent_name": target.agent_name,
                "topic": target.topic,
                "group_id": target.group_id,
                "lag": lag_value,
                "end_offset": total_end,
                "committed_offset": total_committed if has_commit else None,
                "partitions": len(partitions),
                "status": "ok" if has_commit else "no_committed_offset",
            })

        return rows
    finally:
        await consumer.stop()
        await admin.close()


async def refresh_lag_snapshot() -> None:
    global _snapshot
    rows = await collect_kafka_lag()
    _snapshot = {
        "items": rows,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "error": None,
    }


async def kafka_lag_collector_loop() -> None:
    while True:
        try:
            await refresh_lag_snapshot()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            agent_errors_total.labels("orchestrator", type(exc).__name__).inc()
            logger.warning("Kafka lag scrape failed: %s", exc)
            _snapshot["error"] = str(exc)
            _snapshot["updated_at"] = datetime.now(timezone.utc).isoformat()
        await asyncio.sleep(SCRAPE_INTERVAL_SECONDS)
