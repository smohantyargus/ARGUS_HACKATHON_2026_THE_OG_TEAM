"""Redis client for reading token streams and aggregator partial events."""
import os
import logging
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

_redis: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def tail_stream(job_id: str, last_id: str = "0"):
    """
    Async generator that yields (entry_id, fields) from the job's Redis stream.
    Blocks up to 2s per call; yields None on timeout to let the caller send heartbeats.
    Stops when a 'done' sentinel is received or the stream doesn't exist.
    """
    r = await get_redis()
    stream_key = f"stream:{job_id}"
    current_id = last_id

    while True:
        try:
            results = await r.xread({stream_key: current_id}, count=50, block=2000)
            if not results:
                yield None  # timeout — let caller decide what to do
                continue

            for _key, entries in results:
                for entry_id, fields in entries:
                    current_id = entry_id
                    yield fields
                    if fields.get("done") == "1":
                        return
        except Exception as e:
            logger.warning("Redis tail_stream error for job %s: %s", job_id, e)
            return


async def read_aggregator_partial(job_id: str, last_id: str = "0") -> tuple[str, list[dict]]:
    """
    Non-blocking read of aggregator partial events for a job.
    Returns (last_id, [payload_dicts]) — call repeatedly with last_id to get new events.
    """
    import json as _json
    r = await get_redis()
    stream_key = f"aggregator_partial:{job_id}"
    try:
        results = await r.xread({stream_key: last_id}, count=20, block=0)
        if not results:
            return last_id, []
        events = []
        new_id = last_id
        for _key, entries in results:
            for entry_id, fields in entries:
                new_id = entry_id
                try:
                    events.append(_json.loads(fields.get("payload", "{}")))
                except Exception:
                    pass
        return new_id, events
    except Exception as e:
        logger.debug("read_aggregator_partial error for job %s: %s", job_id, e)
        return last_id, []
