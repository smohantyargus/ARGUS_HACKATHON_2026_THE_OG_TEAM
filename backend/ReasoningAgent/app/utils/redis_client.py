"""Redis client for writing token streams during LLM generation."""
import os
import logging
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
_STREAM_MAXLEN = 10000  # cap per-job stream length

_redis: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def write_token(job_id: str, token: str) -> None:
    """Append one token to the job's Redis stream."""
    try:
        r = await get_redis()
        await r.xadd(f"stream:{job_id}", {"token": token, "step": "reason"}, maxlen=_STREAM_MAXLEN)
    except Exception:
        logger.warning("Redis write_token failed for job %s (non-fatal)", job_id)


async def write_stream_done(job_id: str) -> None:
    """Write a sentinel entry marking the stream as complete."""
    try:
        r = await get_redis()
        await r.xadd(f"stream:{job_id}", {"done": "1", "step": "reason"}, maxlen=_STREAM_MAXLEN)
    except Exception:
        logger.warning("Redis write_stream_done failed for job %s (non-fatal)", job_id)


async def close() -> None:
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None
