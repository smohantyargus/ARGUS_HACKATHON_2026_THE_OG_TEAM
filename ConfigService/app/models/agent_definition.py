"""
AgentDefinition — fully configurable text-to-text agent.

A single GenericAgent container reads one AgentDefinition (by AGENT_NAME env var)
and runs as that agent — subscribing to input_topic, calling the LLM with the
configured prompt, and publishing to output_topic.

No code changes needed to create new LLM text-to-text agents.
"""
import uuid
from sqlalchemy import Column, String, Boolean, Integer, Float, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.sql import func
from app.core.database import Base


class AgentDefinition(Base):
    __tablename__ = "agent_definitions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Identity — name is used as AGENT_NAME env var in the GenericAgent container
    name = Column(String(100), nullable=False, unique=True)
    display_name = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)

    # Kafka routing
    input_topic = Column(String(200), nullable=False)
    output_topic = Column(String(200), nullable=False)

    # Which fields to extract from the incoming Kafka message and pass to the prompt
    # e.g. ["transcript", "action", "soap"] — each becomes a {{field}} template variable
    input_fields = Column(JSON, nullable=False, default=list)

    # Prompt — inline (system_prompt + user_prompt_template) takes priority over prompt_action
    # Use {{field}} placeholders matching input_fields entries
    system_prompt = Column(Text, nullable=True)
    user_prompt_template = Column(Text, nullable=True)

    # Alternatively, reference an existing prompt_templates row by action string
    prompt_action = Column(String(100), nullable=True)  # e.g. "soap", "medical_reasoning"

    # LLM config
    llm_instance_name = Column(String(100), nullable=True)    # preferred LlmInstance.name; falls back to registry
    max_tokens = Column(Integer, nullable=False, default=1024)
    temperature = Column(Float, nullable=False, default=0.3)

    # Optional JSON schema — output is validated against this before publishing
    output_schema = Column(JSON, nullable=True)

    # Validation rules for GenericValidator — defines how output is validated before *.validated
    # {"type": "not_empty"} | {"type": "required_fields", "fields": [...]} | {"type": "json_schema", "schema": {...}} | {"type": "none"}
    validation_rules = Column(JSON, nullable=True)

    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
