"""
ResponseMerger — waits for outputs from N parallel agents (per job_id),
merges them into one structured JSON, publishes to output_topic.

Config stored in ConfigService `response_mergers` table.
Input topic map: {"topic": "field_name_in_output"}
e.g. {"soap.validated": "soap", "differential.validated": "differential_diagnosis"}
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import redis.asyncio as aioredis

from app.utils.config_client import fetch_merger_definitions
from app.utils.kafka import get_consumer, get_producer
from haidoc_obs import (
    set_job_context, clear_job_context,
    agent_messages_consumed_total, agent_processing_duration_seconds,
    agent_errors_total,
)

logger = logging.getLogger(__name__)
_AGENT = "response_merger"

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

# topic → {merger_name, field_name, expected_count, output_topic, timeout_seconds}
_topic_index: dict[str, dict] = {}


def _build_index(definitions: list[dict]) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for defn in definitions:
        topic_map: dict = defn.get("input_topic_map") or {}
        expected_count = len(topic_map)
        for topic, field_name in topic_map.items():
            index[topic] = {
                "merger_name": defn["name"],
                "field_name": field_name,
                "expected_count": expected_count,
                "output_topic": defn["output_topic"],
                "timeout_seconds": defn.get("timeout_seconds", 60),
                "all_fields": set(topic_map.values()),
            }
    return index


async def consume_loop():
    while True:
        consumer = None
        producer = None
        redis_client = None
        try:
            await asyncio.sleep(5)

            definitions = fetch_merger_definitions()
            if not definitions:
                logger.info("ResponseMerger: no active definitions — retrying in 30s")
                await asyncio.sleep(30)
                continue

            index = _build_index(definitions)
            all_topics = list(index.keys())

            logger.info("ResponseMerger: subscribing to %d topics: %s", len(all_topics), all_topics)

            redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
            consumer = await get_consumer(all_topics, "response-merger")
            producer = await get_producer()

            async for msg in consumer:
                started = time.monotonic()
                topic = msg.topic
                data: dict = msg.value
                job_id = data.get("job_id", "unknown")
                set_job_context(job_id=job_id)
                outcome = "success"

                try:
                    if topic not in index:
                        outcome = "dropped"
                        continue

                    entry = index[topic]
                    merger_name = entry["merger_name"]
                    field_name = entry["field_name"]
                    expected_count = entry["expected_count"]
                    output_topic = entry["output_topic"]
                    timeout_seconds = entry["timeout_seconds"]

                    output_value = data.get("output") or data.get("data") or data
                    redis_key = f"merger:{merger_name}:{job_id}"

                    await redis_client.hset(redis_key, field_name, json.dumps(output_value))
                    await redis_client.expire(redis_key, timeout_seconds)

                    current_count = await redis_client.hlen(redis_key)
                    logger.info(
                        "ResponseMerger[%s]: job=%s field=%s (%d/%d)",
                        merger_name, job_id, field_name, current_count, expected_count,
                    )

                    if current_count >= expected_count:
                        raw = await redis_client.hgetall(redis_key)
                        await redis_client.delete(redis_key)
                        merged = {k: json.loads(v) for k, v in raw.items()}
                        result = {
                            "job_id": job_id,
                            "step_name": data.get("step_name", merger_name),
                            "data": {"merged_output": merged},
                            "status_code": 200,
                        }
                        await producer.send_and_wait(output_topic, result)
                        logger.info(
                            "ResponseMerger[%s]: job=%s → merged %d fields → %s",
                            merger_name, job_id, len(merged), output_topic,
                        )
                except Exception as exc:
                    outcome = "error"
                    agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
                    logger.exception("ResponseMerger: error for job %s", job_id)
                finally:
                    agent_messages_consumed_total.labels(_AGENT, topic, outcome).inc()
                    agent_processing_duration_seconds.labels(_AGENT).observe(time.monotonic() - started)
                    clear_job_context()

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            agent_errors_total.labels(_AGENT, type(exc).__name__).inc()
            logger.exception("ResponseMerger: error — reconnecting in 10s")
            await asyncio.sleep(10)
        finally:
            if consumer:
                await consumer.stop()
            if producer:
                await producer.stop()
            if redis_client:
                await redis_client.aclose()
