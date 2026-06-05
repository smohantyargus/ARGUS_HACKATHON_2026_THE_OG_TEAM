import uuid
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.core.app_database import AppBase


class Organisation(AppBase):
    """
    Organisation — grouping label for access keys.

    An org has zero or more mk_ access keys (via access_keys.org_id FK, app-layer).
    No key hash stored here — keys are managed via AccessKey model.
    """
    __tablename__ = "organisations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
