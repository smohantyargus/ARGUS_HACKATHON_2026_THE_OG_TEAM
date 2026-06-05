"""
Agent runtime config — concurrency and replica targets, live-synced to Redis.

PUT upserts the DB row, then:
  1. SET agent:{name}:concurrency in Redis  (agents read on reconnect)
  2. PUBLISH to agent.config.{name}         (live update via pub/sub in BaseKafkaAgent)
"""
import json
import os
from typing import Optional

import redis as sync_redis
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_write_auth
from app.models.agent_runtime_config import AgentRuntimeConfig

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")
_redis_client: sync_redis.Redis | None = None

router = APIRouter(prefix="/internal/agent-runtime-config", tags=["agent-runtime-config"])


def _get_redis() -> sync_redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = sync_redis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


# NOTE: removed legacy `_role` helper that trusted X-User-Role header.
# Use `require_write_auth` dependency on mutating endpoints instead.


# ── Schemas ───────────────────────────────────────────────────────────────────

class RuntimeConfigIn(BaseModel):
    concurrency: int = Field(ge=1, le=200)
    replica_target: int = Field(default=1, ge=1, le=50)


class RuntimeConfigOut(BaseModel):
    agent_name: str
    concurrency: int
    replica_target: int
    updated_at: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[RuntimeConfigOut])
def list_configs(db: Session = Depends(get_db)):
    rows = db.query(AgentRuntimeConfig).order_by(AgentRuntimeConfig.agent_name).all()
    return [
        RuntimeConfigOut(
            agent_name=r.agent_name,
            concurrency=r.concurrency,
            replica_target=r.replica_target,
            updated_at=r.updated_at.isoformat() if r.updated_at else None,
        )
        for r in rows
    ]


@router.get("/{agent_name}", response_model=RuntimeConfigOut)
def get_config(agent_name: str, db: Session = Depends(get_db)):
    row = db.get(AgentRuntimeConfig, agent_name)
    if not row:
        raise HTTPException(status_code=404, detail=f"No config for agent '{agent_name}'")
    return RuntimeConfigOut(
        agent_name=row.agent_name,
        concurrency=row.concurrency,
        replica_target=row.replica_target,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )


@router.put("/{agent_name}", response_model=RuntimeConfigOut)
def upsert_config(
    agent_name: str,
    data: RuntimeConfigIn,
    db: Session = Depends(get_db),
    _: dict = Depends(require_write_auth),
):
    row = db.get(AgentRuntimeConfig, agent_name)
    if row:
        row.concurrency = data.concurrency
        row.replica_target = data.replica_target
    else:
        row = AgentRuntimeConfig(
            agent_name=agent_name,
            concurrency=data.concurrency,
            replica_target=data.replica_target,
        )
        db.add(row)
    db.commit()
    db.refresh(row)

    # Sync to Redis — fail gracefully so DB write is never rolled back
    try:
        r = _get_redis()
        r.set(f"agent:{agent_name}:concurrency", data.concurrency)
        r.publish(
            f"agent.config.{agent_name}",
            json.dumps({"concurrency": data.concurrency}),
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(
            "Redis sync failed for agent %s: %s", agent_name, exc
        )

    return RuntimeConfigOut(
        agent_name=row.agent_name,
        concurrency=row.concurrency,
        replica_target=row.replica_target,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )
