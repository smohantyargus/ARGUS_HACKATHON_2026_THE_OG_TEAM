from sqlalchemy import Column, Integer, String, SmallInteger, Text, DateTime
from sqlalchemy.sql import func
from app.models.base import Base


class OutputFeedback(Base):
    __tablename__ = "output_feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=True)
    output_type = Column(String(100), nullable=False)
    field = Column(String(100), nullable=True)
    rating = Column(SmallInteger, nullable=False)
    correction = Column(Text, nullable=True)
    submitted_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
