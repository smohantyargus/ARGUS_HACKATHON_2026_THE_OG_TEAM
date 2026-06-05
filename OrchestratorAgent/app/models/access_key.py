import uuid
from sqlalchemy import Column, String, Boolean, Integer, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.sql import func
from app.core.app_database import AppBase


class AccessKey(AppBase):
    """
    Pipeline-scoped API key for client (tenant) access.

    Key format:  mk_{8-char-prefix}_{64-char-hex-random}
    Storage:     Only key_prefix and SHA-256 hash stored. Raw key shown once on creation.
    Auth flow:   Client sends Bearer mk_..., orchestrator hashes → lookup here → resolve pipelines.

    pipeline_ids: UUID array of pipeline_definitions.id values this key can invoke.
                  Stored as text[] of UUID strings for portability (cross-DB FK not enforceable).
    """
    __tablename__ = "access_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)   # FK to tenants.id (app-layer)
    key_prefix = Column(String(16), nullable=False)                       # visible prefix for identification
    key_hash = Column(String(64), nullable=False, unique=True)            # SHA-256 hex of full raw key
    name = Column(String(200), nullable=False)
    pipeline_ids = Column(ARRAY(Text), nullable=False, default=list)      # allowed pipeline UUIDs
    rate_limit_rpm = Column(Integer, nullable=False, default=60)
    expires_at = Column(DateTime(timezone=True), nullable=True)           # null = no expiry
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    org_id = Column(UUID(as_uuid=True), nullable=True, index=True)         # optional org grouping (app-layer FK to organisations.id)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(255), nullable=True)                       # admin username
    created_at = Column(DateTime(timezone=True), server_default=func.now())
