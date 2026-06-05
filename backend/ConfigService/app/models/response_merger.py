import uuid
from sqlalchemy import Column, String, Boolean, Integer, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.sql import func
from app.core.database import Base


class ResponseMerger(Base):
    __tablename__ = "response_mergers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)
    display_name = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)

    # {"input_topic": "output_field_name"}
    # e.g. {"soap.validated": "soap", "differential.validated": "differential_diagnosis"}
    input_topic_map = Column(JSON, nullable=False)

    output_topic = Column(String(200), nullable=False)
    timeout_seconds = Column(Integer, nullable=False, default=60)

    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
