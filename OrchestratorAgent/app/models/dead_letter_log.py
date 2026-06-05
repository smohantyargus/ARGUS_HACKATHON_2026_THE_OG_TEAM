from sqlalchemy import Column, BigInteger, String, Text, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.core.app_database import AppBase


class DeadLetterLog(AppBase):
    """
    Audit record for every message that exhausted validation retries and was
    published to the agent.deadletter Kafka topic.

    Populated by the orchestrator's DLQ consumer (_consume_dlq in main.py).
    """
    __tablename__ = "dead_letter_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    job_id = Column(String(255), nullable=False, index=True)
    step_name = Column(String(100), nullable=True)
    topic = Column(String(200), nullable=True)          # originating Kafka topic
    error = Column(Text, nullable=True)
    original_message = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
