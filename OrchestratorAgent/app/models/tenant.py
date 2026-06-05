import uuid
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.core.app_database import AppBase


class Tenant(AppBase):
    """
    Organisation / client entity. Every access key belongs to a tenant.
    Jobs created via access key are tagged with tenant_id for isolation.
    """
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False, unique=True)
    slug = Column(String(100), nullable=False, unique=True)   # url-safe, e.g. "acme-health"
    config_overrides = Column(JSONB, nullable=False, default=dict)
    # Per-tenant overrides: {"model": "...", "pipeline": "...", "max_tokens": 2048}
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
