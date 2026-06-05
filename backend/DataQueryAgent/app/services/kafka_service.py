"""
DataQueryAgent — answers data requests for other agents over Kafka.

Request  (topic: data.request):
    {request_id, job_id, reply_topic, query_name, params}
Response (topic: caller's reply_topic, default data.response):
    {request_id, job_id, query_name, status, rows, error}

Read-only — every handler runs SELECTs only, so reprocessing under the
at-least-once delivery contract is harmless (idempotent).
"""
from __future__ import annotations

import asyncio
import logging

from aiokafka import AIOKafkaProducer

from civis_obs import BaseKafkaAgent

from app.db.database import SessionLocal
from app.db.seed import create_and_seed
from app.services.queries import NAMED_QUERIES

logger = logging.getLogger(__name__)

DEFAULT_REPLY_TOPIC = "data.response"


def _run_query(query_name: str, params: dict) -> tuple[list, str, str | None]:
    """Sync DB work — runs in a thread so it doesn't block the event loop."""
    fn = NAMED_QUERIES.get(query_name)
    if fn is None:
        return [], "error", f"unknown query '{query_name}'"
    try:
        with SessionLocal() as session:
            return fn(session, params or {}), "ok", None
    except Exception as exc:  # noqa: BLE001 — report the failure to the caller, don't crash the loop
        logger.exception("DataQueryAgent: query '%s' failed", query_name)
        return [], "error", f"{type(exc).__name__}: {exc}"


class DataQueryAgent(BaseKafkaAgent):
    agent_name = "data_query_agent"
    input_topic = "data.request"
    group_id = "data-query-group"

    async def on_startup(self) -> None:
        await asyncio.to_thread(create_and_seed)

    async def process(self, data: dict, producer: AIOKafkaProducer) -> None:
        reply_topic = data.get("reply_topic") or DEFAULT_REPLY_TOPIC
        query_name = data.get("query_name")
        params = data.get("params") or {}

        rows, status, error = await asyncio.to_thread(_run_query, query_name, params)

        await producer.send_and_wait(reply_topic, {
            "request_id": data.get("request_id"),
            "job_id": data.get("job_id"),
            "query_name": query_name,
            "status": status,
            "rows": rows,
            "error": error,
        })
        logger.info(
            "DataQueryAgent: query=%s status=%s rows=%d → %s",
            query_name, status, len(rows), reply_topic,
        )


_agent = DataQueryAgent()


async def start() -> None:
    await _agent.run()
