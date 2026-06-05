from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.core.database import Base


class ValidationRule(Base):
    __tablename__ = "validation_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    step_name = Column(String(100), nullable=False, index=True)   # "transcribe", "summarise"
    rule_type = Column(String(50), nullable=False)                 # "json_schema", "completeness", etc.
    rule_config = Column(JSONB, nullable=False, default={})        # rule-specific parameters
    severity = Column(String(20), nullable=False, default="error") # "error" | "warning"
    is_active = Column(Boolean, default=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
