import uuid
from sqlalchemy import Column, String, Boolean, Integer, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.core.database import Base


class LlmInstance(Base):
    """
    Registry of LLM endpoints available to agents.
    Agents look up their assigned LLM here instead of having hardcoded URLs.

    provider values:
      - "anthropic"      Claude via Anthropic API
      - "llamacpp"       Local llama.cpp server (OpenAI-compat /v1/chat/completions)
      - "openai_compat"  Any OpenAI-compatible endpoint (together.ai, vllm, etc.)
      - "gemini"         Google Gemini API
    """
    __tablename__ = "llm_instances"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)       # e.g. "claude-sonnet", "local-llama3"
    provider = Column(String(50), nullable=False)                  # see docstring above
    base_url = Column(String(500), nullable=False)                 # e.g. "http://llm-server:8080"
    model_name = Column(String(200), nullable=True)               # model identifier / path
    max_parallel = Column(Integer, nullable=False, default=1)     # parallel slots this instance supports
    priority = Column(Integer, nullable=False, default=100)       # lower = preferred when multiple assigned
    is_active = Column(Boolean, nullable=False, default=True)
    health_endpoint = Column(String(200), nullable=True)          # GET path for health check, e.g. "/health"
    api_key_config_key = Column(String(255), nullable=True)       # ConfigEntry key holding the API key secret
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AgentLlmAssignment(Base):
    """
    Many-to-many: which LLM instances an agent is allowed to use.
    Agent picks the active instance with lowest priority number.
    """
    __tablename__ = "agent_llm_assignments"

    agent_id = Column(Integer, primary_key=True)                              # FK to agent_registry.id
    llm_instance_id = Column(UUID(as_uuid=True), primary_key=True)           # FK to llm_instances.id
