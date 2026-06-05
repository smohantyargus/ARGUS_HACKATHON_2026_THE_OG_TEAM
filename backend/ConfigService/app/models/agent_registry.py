from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID, ARRAY
from sqlalchemy.sql import func
from app.core.database import Base


class AgentRegistry(Base):
    __tablename__ = "agent_registry"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)
    input_topic = Column(String(255), nullable=False)
    output_topic = Column(String(255), nullable=False)
    input_schema = Column(JSONB, nullable=True)
    output_schema = Column(JSONB, nullable=True)
    health_url = Column(Text, nullable=True)
    version = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True)
    registered_at = Column(DateTime(timezone=True), server_default=func.now())

    # Phase A additions — added via migration for existing rows (see migrations/phase_a_alter.sql)
    capability_tags = Column(ARRAY(Text), nullable=False, server_default="{}")
    # e.g. ["stt", "transcription"] or ["nlp", "soap"] or ["reasoning", "medical"]
    max_concurrency = Column(Integer, nullable=False, server_default="1")
    # How many simultaneous jobs this agent instance can handle
    llm_required = Column(Boolean, nullable=False, server_default="false")
    # True if agent calls an LLM; used to populate agent_llm_assignments
    llm_instance_id = Column(UUID(as_uuid=True), nullable=True)
    # Default LLM for this agent (FK to llm_instances.id, enforced at app layer to avoid cross-DB FK)
