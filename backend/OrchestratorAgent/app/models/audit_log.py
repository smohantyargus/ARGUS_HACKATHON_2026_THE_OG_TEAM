from sqlalchemy import Column, BigInteger, String, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID, INET
from sqlalchemy.sql import func
from app.core.app_database import AppBase


class AuditLog(AppBase):
    """
    Immutable audit trail for security-relevant actions.
    Written on: job create/delete, access key create/revoke, pipeline change, admin actions.

    actor_type: "user" | "access_key" | "system"
    action:     dot-notation, e.g. "job.create", "key.revoke", "pipeline.update"
    resource:   "job:<uuid>", "key:<uuid>", "pipeline:<uuid>" — what was acted on
    """
    __tablename__ = "audit_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    user_id = Column(String(255), nullable=True)       # username or access_key id
    actor_type = Column(String(20), nullable=False)
    action = Column(String(100), nullable=False, index=True)
    resource = Column(String(200), nullable=True)
    ip_address = Column(INET, nullable=True)
    detail = Column(Text, nullable=True)               # optional JSON or free text
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
