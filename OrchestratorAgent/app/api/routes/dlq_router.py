from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.app_database import get_app_db
from app.core.auth import require_admin
from app.models.dead_letter_log import DeadLetterLog
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

router = APIRouter(prefix="/v1/dlq", tags=["dlq"])


class DLQEntry(BaseModel):
    id: int
    job_id: str
    step_name: Optional[str] = None
    topic: Optional[str] = None
    error: Optional[str] = None
    original_message: Optional[dict] = None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[DLQEntry])
def list_dlq_entries(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_app_db),
    _user: dict = Depends(require_admin),
):
    """List dead-letter queue entries, newest first. Admin only."""
    return (
        db.query(DeadLetterLog)
        .order_by(DeadLetterLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.get("/count")
def count_dlq_entries(
    db: Session = Depends(get_app_db),
    _user: dict = Depends(require_admin),
):
    """Total DLQ entry count."""
    return {"count": db.query(DeadLetterLog).count()}
