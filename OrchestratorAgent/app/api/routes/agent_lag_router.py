from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import require_admin
from app.services.kafka_lag_service import get_lag_snapshot, refresh_lag_snapshot

router = APIRouter(prefix="/v1/agent-lag", tags=["agent-lag"])


class AgentLagItem(BaseModel):
    agent_name: str
    topic: str
    group_id: str
    lag: Optional[int] = None
    end_offset: Optional[int] = None
    committed_offset: Optional[int] = None
    partitions: int
    status: str


class AgentLagSnapshot(BaseModel):
    items: list[AgentLagItem]
    updated_at: Optional[str] = None
    error: Optional[str] = None


@router.get("/", response_model=AgentLagSnapshot)
async def list_agent_lag(_user: dict = Depends(require_admin)):
    """Return the latest Kafka consumer lag snapshot. Admin only."""
    snapshot = get_lag_snapshot()
    if snapshot.get("updated_at") is None:
        await refresh_lag_snapshot()
        snapshot = get_lag_snapshot()
    return snapshot
