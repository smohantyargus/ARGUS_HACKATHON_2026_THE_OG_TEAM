from sqlalchemy import Column, BigInteger, Integer, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.core.app_database import AppBase


class UsageLog(AppBase):
    """
    Per-job usage record for billing and quota tracking.
    Written when a job reaches terminal state (completed or failed).

    tokens_in / tokens_out: LLM token counts aggregated across all steps.
    compute_ms: wall-clock time from job creation to terminal state.
    """
    __tablename__ = "usage_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    access_key_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    job_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    pipeline_id = Column(UUID(as_uuid=True), nullable=True)         # pipeline_definitions.id
    llm_instance_name = Column(String(100), nullable=True)          # denormalised for query convenience
    tokens_in = Column(Integer, nullable=False, default=0)
    tokens_out = Column(Integer, nullable=False, default=0)
    compute_ms = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
