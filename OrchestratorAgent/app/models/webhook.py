from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.core.app_database import AppBase


class Webhook(AppBase):
    __tablename__ = "webhooks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    url = Column(Text, nullable=False)
    secret = Column(Text, nullable=True)
    events = Column(JSONB, nullable=False, default=["job.completed", "job.failed"])
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WebhookDelivery(AppBase):
    __tablename__ = "webhook_deliveries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    webhook_id = Column(Integer, ForeignKey("webhooks.id"), nullable=False, index=True)
    job_id = Column(String, nullable=True, index=True)
    event = Column(String(64), nullable=False)
    attempt = Column(Integer, default=1)
    status = Column(String(16), default="pending")  # pending | success | failed
    response_status = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)
    payload = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    next_retry_at = Column(DateTime(timezone=True), nullable=True)
