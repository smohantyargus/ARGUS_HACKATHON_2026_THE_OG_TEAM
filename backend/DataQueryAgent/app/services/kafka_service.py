"""
DataQueryAgent — answers data requests for other agents over Kafka.

Request  (topic: data.request):
    {request_id, job_id, reply_topic, domain, query_name, params}
    domain defaults to "civic" for backward compatibility.
Response (topic: caller's reply_topic):
    {request_id, job_id, domain, query_name, status, rows, error}

Read-only — resolver runs SELECTs only, so reprocessing under the
at-least-once delivery contract is harmless (idempotent).
"""
from __future__ import annotations

import asyncio
import logging

from aiokafka import AIOKafkaProducer

from civis_obs import BaseKafkaAgent

from app.db.seed import create_and_seed
from app.services.query_resolver import run_query

logger = logging.getLogger(__name__)

DEFAULT_REPLY_TOPIC = "data.response"
DEFAULT_DOMAIN = "civic"


class DataQueryAgent(BaseKafkaAgent):
    agent_name = "data_query_agent"
    input_topic = "data.request"
    group_id = "data-query-group"

    async def on_startup(self) -> None:
        await asyncio.to_thread(create_and_seed)

    async def process(self, data: dict, producer: AIOKafkaProducer) -> None:
        reply_topic = data.get("reply_topic") or DEFAULT_REPLY_TOPIC
        domain = data.get("domain") or DEFAULT_DOMAIN
        query_name = data.get("query_name")
        params = data.get("params") or {}

        rows, status, error = await asyncio.to_thread(
            run_query, domain, query_name, params
        )

        await producer.send_and_wait(reply_topic, {
            "request_id": data.get("request_id"),
            "job_id":     data.get("job_id"),
            "domain":     domain,
            "query_name": query_name,
            "status":     status,
            "rows":       rows,
            "error":      error,
        })
        logger.info(
            "DataQueryAgent: domain=%s query=%s status=%s rows=%d → %s",
            domain, query_name, status, len(rows), reply_topic,
        )


_agent = DataQueryAgent()


async def start() -> None:
    await _agent.run()
