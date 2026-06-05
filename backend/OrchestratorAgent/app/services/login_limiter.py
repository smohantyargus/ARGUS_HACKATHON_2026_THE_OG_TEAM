"""
Login rate limiting — two Redis sliding-window buckets.

IP bucket:   10 attempts / IP / 5 min
             Catches bots/scrapers hammering multiple accounts from one IP.

User bucket: 20 wrong-password failures / username / 15 min
             Less aggressive — avoids DoS where attacker locks out a real user
             by intentionally sending bad passwords from many IPs.

Both buckets fail open if Redis is unavailable.
"""
import logging
import time

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

_IP_MAX = 10
_IP_WINDOW = 300        # 5 min in seconds
_IP_TTL = 600           # 2 windows

_USER_MAX = 20
_USER_WINDOW = 900      # 15 min in seconds
_USER_TTL = 1800        # 2 windows


async def check_ip(redis, ip: str) -> None:
    """Raise 429 if IP has exceeded login attempt limit. Always increments counter."""
    try:
        bucket = int(time.time() / _IP_WINDOW)
        key = f"ratelimit:login:ip:{ip}:{bucket}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _IP_TTL)
        if count > _IP_MAX:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many login attempts from this IP. Try again in 5 minutes.",
                headers={"Retry-After": "300"},
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("login IP rate-limit check failed (Redis?): %s", exc)


async def check_user_failures(redis, username: str) -> None:
    """Raise 429 if username has too many recent wrong-password failures."""
    try:
        bucket = int(time.time() / _USER_WINDOW)
        key = f"ratelimit:login:user:{username}:{bucket}"
        count = int(await redis.get(key) or 0)
        if count >= _USER_MAX:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts for this account. Try again in 15 minutes.",
                headers={"Retry-After": "900"},
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("login user rate-limit check failed (Redis?): %s", exc)


async def record_user_failure(redis, username: str) -> None:
    """Increment wrong-password counter for username. Fail silently."""
    try:
        bucket = int(time.time() / _USER_WINDOW)
        key = f"ratelimit:login:user:{username}:{bucket}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _USER_TTL)
    except Exception as exc:
        logger.warning("record_user_failure failed (Redis?): %s", exc)


async def clear_user_failures(redis, username: str) -> None:
    """Delete user failure bucket on successful login. Best-effort."""
    try:
        bucket = int(time.time() / _USER_WINDOW)
        await redis.delete(f"ratelimit:login:user:{username}:{bucket}")
    except Exception as exc:
        logger.warning("clear_user_failures failed (Redis?): %s", exc)
