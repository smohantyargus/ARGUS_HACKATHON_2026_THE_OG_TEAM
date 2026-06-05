import uuid
from sqlalchemy import Column, String, DateTime, Integer, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.core.app_database import AppBase


class Job(AppBase):
    __tablename__ = "jobs"

    job_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    pipeline = Column(JSONB, nullable=False)          # legacy: inline pipeline steps JSON (kept for compat)
    pipeline_definition_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # Phase A: FK to pipeline_definitions.id (ConfigService). Pipeline Router checks this first;
    # falls back to inline `pipeline` JSONB if null (backward compat with pre-Phase-A jobs).
    access_key_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    current_step = Column(String(100), nullable=True)
    input_meta = Column(JSONB, nullable=True)
    result = Column(JSONB, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    timeout_at = Column(DateTime(timezone=True), nullable=True)


class JobStep(AppBase):
    __tablename__ = "job_steps"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.job_id"), nullable=False, index=True)
    step_name = Column(String(100), nullable=False)
    agent_name = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    input = Column(JSONB, nullable=True)
    output = Column(JSONB, nullable=True)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
