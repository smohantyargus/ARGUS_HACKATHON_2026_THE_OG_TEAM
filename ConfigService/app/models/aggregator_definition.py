"""
AggregatorDefinition — config-driven fan-in synthesis agent.

One ContextAggregatorAgent container reads one AggregatorDefinition (by
AGGREGATOR_NAME env var) and runs as that aggregator — waiting for all
required input_sources, then calling the LLM with dynamic confidence weights
to produce a single synthesized output.
"""
import uuid
from sqlalchemy import Column, String, Boolean, Integer, Float, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.core.database import Base


class AggregatorDefinition(Base):
    __tablename__ = "aggregator_definitions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Identity — used as AGGREGATOR_NAME env var in container
    name = Column(String(100), nullable=False, unique=True)
    display_name = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)

    # Kafka routing
    input_topic = Column(String(200), nullable=False)   # all sources publish here
    output_topic = Column(String(200), nullable=False, default="aggregator.completed")

    # Input sources — list of:
    # { agent_name, base_weight (0.0–1.0), label, required (bool) }
    # base_weight=0 means exclude. required=false means optional (don't block quorum).
    input_sources = Column(JSONB, nullable=False, default=list)

    # LLM synthesis
    synthesis_prompt = Column(Text, nullable=True)   # custom system prompt; fallback to default
    output_schema_type = Column(String(50), nullable=False, default="freeform")
    # freeform | soap | structured_json | fhir
    output_persona = Column(String(50), nullable=False, default="clinician")
    # clinician | patient | ehr_import
    llm_instance_name = Column(String(100), nullable=True)
    max_tokens = Column(Integer, nullable=False, default=2048)
    temperature = Column(Float, nullable=False, default=0.3)

    # Fan-in behaviour
    min_required_inputs = Column(Integer, nullable=False, default=1)
    # proceed with partial synthesis if this many required sources arrived + timeout hit
    timeout_seconds = Column(Integer, nullable=False, default=60)
    conflict_threshold = Column(Float, nullable=False, default=0.4)
    # unused in AG-1; reserved for AG-4 conflict detection

    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
