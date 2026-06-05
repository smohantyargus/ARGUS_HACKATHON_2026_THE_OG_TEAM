from sqlalchemy import Column, BigInteger, Integer, String, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.core.app_database import AppBase


class TokenUsageLog(AppBase):
    """
    Per-LLM-call token record. Written by `haidoc_obs.token_tracker` whenever
    an agent calls `chat_completion`. Mapped to (pipeline, agent, job) for
    cost attribution.
    """
    __tablename__ = "token_usage_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    job_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    pipeline_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    agent_name = Column(String(100), nullable=True, index=True)
    service_name = Column(String(100), nullable=True)
    model_name = Column(String(150), nullable=True)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    total_tokens = Column(Integer, nullable=False, default=0)
    request_id = Column(String(64), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index("idx_token_usage_pipeline_agent", "pipeline_id", "agent_name"),
        Index("idx_token_usage_job_agent", "job_id", "agent_name"),
    )
