import uuid
from sqlalchemy import Column, String, Boolean, Float, ForeignKey, Integer, Text, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.core.database import Base


class PipelineVersion(Base):
    """
    Immutable snapshot of a pipeline_definition at a specific version number.
    Written on every create (v1) and update (v+1). Never modified after insert.

    snapshot JSONB shape mirrors get_graph_pipeline() output:
      { name, description, nodes: [...], edges: [...] }
    """
    __tablename__ = "pipeline_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pipeline_id = Column(
        UUID(as_uuid=True),
        ForeignKey("pipeline_definitions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version = Column(Integer, nullable=False)
    snapshot = Column(JSONB, nullable=False)      # full graph at this version
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("pipeline_id", "version", name="uq_pipeline_version"),
    )


class PipelineDefinition(Base):
    """Graph-based pipeline definition. Replaces PipelineTemplate's ordered step list."""
    __tablename__ = "pipeline_definitions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    version = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True)
    input_type = Column(String(20), nullable=False, default="text")  # text | audio
    created_by = Column(String(255), nullable=True)   # username of creator
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PipelineNode(Base):
    """A single agent node within a pipeline graph."""
    __tablename__ = "pipeline_nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pipeline_id = Column(UUID(as_uuid=True), ForeignKey("pipeline_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    # Exactly one of {agent_id, generic_agent_id, merger_id} is non-null; node_agent_type indicates which.
    agent_id = Column(Integer, ForeignKey("agent_registry.id", ondelete="RESTRICT"), nullable=True)
    generic_agent_id = Column(UUID(as_uuid=True), ForeignKey("agent_definitions.id", ondelete="RESTRICT"), nullable=True)
    merger_id = Column(UUID(as_uuid=True), ForeignKey("response_mergers.id", ondelete="RESTRICT"), nullable=True)
    aggregator_id = Column(UUID(as_uuid=True), ForeignKey("aggregator_definitions.id", ondelete="RESTRICT"), nullable=True)
    node_agent_type = Column(String(30), nullable=False, default="registry")  # registry | generic_llm | output_merger | context_aggregator
    node_key = Column(String(100), nullable=False)        # unique name within pipeline, e.g. "stt", "nlp"
    position_x = Column(Float, nullable=True)             # canvas X position for UI
    position_y = Column(Float, nullable=True)             # canvas Y position for UI
    config_override = Column(JSONB, nullable=False, default=dict)   # per-node overrides
    max_retries = Column(Integer, nullable=False, default=2)
    on_failure = Column(String(20), nullable=False, default="fail_job")  # fail_job | skip_step
    cycle_budget = Column(Integer, nullable=True, default=3)             # max iterations for cyclic_feedback edges originating here

    __table_args__ = (
        UniqueConstraint("pipeline_id", "node_key", name="uq_pipeline_node_key"),
    )


class PipelineEdge(Base):
    """Directed connection between two pipeline nodes. Edge = Kafka topic wire.

    edge_type values:
      sequential       — normal single-path connection (default)
      parallel_fanout  — fan-out branch; source publishes to this AND other parallel edges simultaneously
      merger_input     — edge into a fan-in/merger node; requires wait_for_group to be set
      cyclic_feedback  — loop-back: re-publishes to source node's input topic; capped by max_iterations
      agent_routed     — LLM DecisionAgent output picks the next agent at runtime; guardrailed by candidate_agents

    Routing fields derived from edge_type on create:
      is_parallel = True  for parallel_fanout and merger_input
      is_parallel = False for sequential, cyclic_feedback, agent_routed
    """
    __tablename__ = "pipeline_edges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pipeline_id = Column(UUID(as_uuid=True), ForeignKey("pipeline_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("pipeline_nodes.id", ondelete="CASCADE"), nullable=False)
    target_node_id = Column(UUID(as_uuid=True), ForeignKey("pipeline_nodes.id", ondelete="CASCADE"), nullable=False)
    edge_type = Column(String(20), nullable=False, server_default="sequential")  # sequential | parallel_fanout | merger_input | cyclic_feedback | agent_routed
    is_parallel = Column(Boolean, nullable=False, default=False)   # derived from edge_type; used by Pipeline Router
    wait_for_group = Column(String(100), nullable=True)            # fan-in group key (target waits for quorum)
    is_optional = Column(Boolean, nullable=False, default=False)   # skip on timeout, don't fail pipeline
    # cyclic_feedback fields
    max_iterations = Column(Integer, nullable=True, default=3)     # maximum loop iterations before forced exit
    break_field = Column(String(100), nullable=True)               # agent output field to check for early exit
    break_value = Column(String(100), nullable=True)               # value of break_field that triggers exit
    # agent_routed fields
    candidate_agents = Column(JSONB, nullable=True)                # allowlist of agent names; empty = no guardrail
