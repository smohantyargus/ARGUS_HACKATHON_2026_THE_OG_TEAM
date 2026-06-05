"""
request_data() — correlated request/response over Kafka against DataQueryAgent.

Any *coded* agent (one with its own consumer loop) can fetch domain facts inline:

    rows = await request_data("region_snapshot", {"region": "metro"}, job_id=job_id)

It emits to `data.request` with a fresh request_id and a unique reply topic, then
waits on that reply topic for the matching response. The reply topic auto-creates
(KAFKA_AUTO_CREATE_TOPICS_ENABLE=true). Raises DataQueryError on a failed query and
asyncio.TimeoutError if no response arrives within `timeout`.

Note: config-only agents (the original GenericAgent) can't await mid-flight — use
GenericAgent v2, which calls this helper before its LLM call.
"""
from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from .kafka_utils import get_consumer, get_producer

logger = logging.getLogger(__name__)

REQUEST_TOPIC = "data.request"


class DataQueryError(RuntimeError):
    """DataQueryAgent returned status='error' for a request."""


async def request_data(
    query_name: str,
    params: dict | None = None,
    *,
    domain: str = "civic",
    job_id: str | None = None,
    timeout: float = 5.0,
) -> list[dict]:
    request_id = uuid4().hex
    reply_topic = f"data.response.{request_id}"
    group_id = f"dq-reply-{request_id}"

    consumer = await get_consumer(reply_topic, group_id)
    producer = await get_producer()
    try:
        await producer.send_and_wait(REQUEST_TOPIC, {
            "request_id": request_id,
            "job_id":     job_id,
            "domain":     domain,
            "reply_topic": reply_topic,
            "query_name": query_name,
            "params":     params or {},
        })

        async def _await_reply() -> dict:
            async for msg in consumer:
                data = msg.value
                if data.get("request_id") == request_id:
                    return data
            raise DataQueryError("reply stream closed before response")  # pragma: no cover

        reply = await asyncio.wait_for(_await_reply(), timeout=timeout)
    finally:
        await consumer.stop()
        await producer.stop()

    if reply.get("status") != "ok":
        raise DataQueryError(reply.get("error") or f"query '{query_name}' failed")
    return reply.get("rows") or []
