"""
Access Key service — generation, verification, rate limiting.

Key format:  mk_{8-char-prefix}_{64-char-hex-random}
Storage:     key_prefix (visible) + SHA-256 hash stored. Raw key shown once.
Rate limit:  Redis sliding-window per key per minute.
"""
import hashlib
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.access_key import AccessKey
from app.models.tenant import Tenant

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

# Lazy Redis client — only imported/used if rate limiting is exercised
_redis = None


async def _get_redis():
    global _redis
    if _redis is None:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


# ─── Key generation ──────────────────────────────────────────────────────────

def _generate_raw_key() -> tuple[str, str, str]:
    """
    Returns (raw_key, prefix, sha256_hash).
    raw_key = mk_{prefix}_{64-hex-random}
    """
    prefix = secrets.token_hex(4)          # 8 hex chars
    random_part = secrets.token_hex(32)    # 64 hex chars
    raw = f"mk_{prefix}_{random_part}"
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, prefix, key_hash


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# ─── Tenant helpers ───────────────────────────────────────────────────────────

def get_or_create_tenant(db: Session, name: str, slug: str | None = None) -> Tenant:
    existing = db.query(Tenant).filter(Tenant.name == name).first()
    if existing:
        return existing
    if not slug:
        slug = name.lower().replace(" ", "-").replace("_", "-")
    tenant = Tenant(name=name, slug=slug)
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


def list_tenants(db: Session) -> list[Tenant]:
    return db.query(Tenant).order_by(Tenant.created_at.desc()).all()


# ─── Key CRUD ─────────────────────────────────────────────────────────────────

def create_access_key(
    db: Session,
    *,
    name: str,
    tenant_id: UUID,
    pipeline_ids: list[str],
    rate_limit_rpm: int = 60,
    expires_at: datetime | None = None,
    created_by: str | None = None,
    org_id: UUID | None = None,
) -> tuple[AccessKey, str]:
    """
    Create a new access key.
    Returns (AccessKey row, raw_key).
    The raw_key is returned ONCE — it is NOT stored.
    """
    raw, prefix, key_hash = _generate_raw_key()
    key = AccessKey(
        tenant_id=tenant_id,
        org_id=org_id,
        key_prefix=prefix,
        key_hash=key_hash,
        name=name,
        pipeline_ids=pipeline_ids,
        rate_limit_rpm=rate_limit_rpm,
        expires_at=expires_at,
        created_by=created_by,
        is_active=True,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key, raw


def list_access_keys(db: Session, tenant_id: UUID | None = None) -> list[AccessKey]:
    q = db.query(AccessKey).order_by(AccessKey.created_at.desc())
    if tenant_id:
        q = q.filter(AccessKey.tenant_id == tenant_id)
    return q.all()


def revoke_access_key(db: Session, key_id: UUID) -> bool:
    key = db.query(AccessKey).filter(AccessKey.id == key_id).first()
    if not key:
        return False
    key.is_active = False
    db.commit()
    return True


def verify_access_key(db: Session, raw: str) -> AccessKey:
    """
    Look up a key by its hash. Raises 401 if not found, expired, or inactive.
    Updates last_used_at (best-effort, fire-and-forget at call site).
    """
    key_hash = _hash_key(raw)
    key = db.query(AccessKey).filter(
        AccessKey.key_hash == key_hash,
        AccessKey.is_active == True,  # noqa: E712
    ).first()

    if not key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked access key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if key.expires_at and key.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Access key has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return key


def touch_last_used(db: Session, key_id: UUID) -> None:
    """Update last_used_at. Call outside the critical path — best effort."""
    try:
        key = db.query(AccessKey).filter(AccessKey.id == key_id).first()
        if key:
            key.last_used_at = datetime.now(timezone.utc)
            db.commit()
    except Exception:
        logger.debug("touch_last_used failed for key %s", key_id)


# ─── Rate limiting ────────────────────────────────────────────────────────────

async def check_rate_limit(key: AccessKey) -> None:
    """
    Redis sliding window rate limit: max key.rate_limit_rpm requests per minute.
    Raises 429 if exceeded.
    """
    try:
        r = await _get_redis()
        minute_bucket = int(time.time() / 60)
        redis_key = f"ratelimit:key:{key.id}:{minute_bucket}"
        count = await r.incr(redis_key)
        if count == 1:
            await r.expire(redis_key, 120)  # 2-minute TTL covers the current + previous bucket
        if count > key.rate_limit_rpm:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: {key.rate_limit_rpm} requests/minute",
                headers={"Retry-After": "60"},
            )
    except HTTPException:
        raise
    except Exception as e:
        # Redis unavailable — fail open (log and continue)
        logger.warning("Rate limit check failed (Redis unavailable?): %s", e)
