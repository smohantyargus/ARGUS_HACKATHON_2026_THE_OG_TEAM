"""
Graph pipeline service — CRUD for pipeline_definitions, pipeline_nodes, pipeline_edges.
"""
import uuid
from sqlalchemy.orm import Session
from app.models.pipeline_definition import PipelineDefinition, PipelineNode, PipelineEdge, PipelineVersion
from app.models.agent_registry import AgentRegistry
from app.models.agent_definition import AgentDefinition
from app.models.response_merger import ResponseMerger
from app.models.aggregator_definition import AggregatorDefinition


# ─── Read ─────────────────────────────────────────────────────────────────────

def list_graph_pipelines(db: Session) -> list[PipelineDefinition]:
    return db.query(PipelineDefinition).order_by(PipelineDefinition.created_at.desc()).all()


def get_graph_pipeline(db: Session, pipeline_id: str) -> dict | None:
    """Return full graph: definition + nodes (with agent info) + edges."""
    defn = db.query(PipelineDefinition).filter(
        PipelineDefinition.id == pipeline_id
    ).first()
    if not defn:
        return None

    nodes = db.query(PipelineNode).filter(PipelineNode.pipeline_id == defn.id).all()
    edges = db.query(PipelineEdge).filter(PipelineEdge.pipeline_id == defn.id).all()

    # Enrich nodes with agent info from the right table per node_agent_type
    registry_ids = [n.agent_id for n in nodes if n.node_agent_type == "registry" and n.agent_id]
    generic_ids = [n.generic_agent_id for n in nodes if n.node_agent_type == "generic_llm" and n.generic_agent_id]
    merger_ids = [n.merger_id for n in nodes if n.node_agent_type == "output_merger" and n.merger_id]
    aggregator_ids = [n.aggregator_id for n in nodes if n.node_agent_type == "context_aggregator" and n.aggregator_id]

    registry_agents = {a.id: a for a in db.query(AgentRegistry).filter(AgentRegistry.id.in_(registry_ids)).all()} if registry_ids else {}
    generic_agents = {a.id: a for a in db.query(AgentDefinition).filter(AgentDefinition.id.in_(generic_ids)).all()} if generic_ids else {}
    merger_agents = {m.id: m for m in db.query(ResponseMerger).filter(ResponseMerger.id.in_(merger_ids)).all()} if merger_ids else {}
    aggregator_agents = {a.id: a for a in db.query(AggregatorDefinition).filter(AggregatorDefinition.id.in_(aggregator_ids)).all()} if aggregator_ids else {}

    node_id_to_key = {str(n.id): n.node_key for n in nodes}

    def _enrich_node(n: PipelineNode) -> dict:
        if n.node_agent_type == "generic_llm":
            agent_id = str(n.generic_agent_id) if n.generic_agent_id else None
            agent = generic_agents.get(n.generic_agent_id)
            agent_info = _generic_agent_dict(agent) if agent else None
        elif n.node_agent_type == "output_merger":
            agent_id = str(n.merger_id) if n.merger_id else None
            agent = merger_agents.get(n.merger_id)
            agent_info = _merger_agent_dict(agent) if agent else None
        elif n.node_agent_type == "context_aggregator":
            agent_id = str(n.aggregator_id) if n.aggregator_id else None
            agent = aggregator_agents.get(n.aggregator_id)
            agent_info = _aggregator_dict(agent) if agent else None
        else:
            agent_id = n.agent_id
            agent = registry_agents.get(n.agent_id)
            agent_info = _agent_dict(agent) if agent else None
        return {
            "id": str(n.id),
            "node_key": n.node_key,
            "agent_id": agent_id,
            "node_agent_type": n.node_agent_type,
            "agent": agent_info,
            "position_x": n.position_x,
            "position_y": n.position_y,
            "config_override": n.config_override or {},
            "max_retries": n.max_retries,
            "on_failure": n.on_failure,
        }

    return {
        "id": str(defn.id),
        "name": defn.name,
        "description": defn.description,
        "input_type": defn.input_type or "text",
        "version": defn.version,
        "is_active": defn.is_active,
        "created_by": defn.created_by,
        "created_at": defn.created_at.isoformat() if defn.created_at else None,
        "updated_at": defn.updated_at.isoformat() if defn.updated_at else None,
        "nodes": [_enrich_node(n) for n in nodes],
        "edges": [
            {
                "id": str(e.id),
                "source_node_key": node_id_to_key.get(str(e.source_node_id), ""),
                "target_node_key": node_id_to_key.get(str(e.target_node_id), ""),
                "source_node_id": str(e.source_node_id),
                "target_node_id": str(e.target_node_id),
                "edge_type": e.edge_type or "sequential",
                "is_parallel": e.is_parallel,
                "wait_for_group": e.wait_for_group,
                "is_optional": e.is_optional,
                # cyclic_feedback fields — required by the Pipeline Router to drive the loop
                "max_iterations": e.max_iterations,
                "break_field": e.break_field,
                "break_value": e.break_value,
                "loop_to": e.loop_to or "source",
                # agent_routed field
                "candidate_agents": e.candidate_agents,
            }
            for e in edges
        ],
    }


def _agent_dict(agent: AgentRegistry | None) -> dict | None:
    if not agent:
        return None
    return {
        "id": agent.id,
        "name": agent.name,
        "input_topic": agent.input_topic,
        "output_topic": agent.output_topic,
        "input_schema": agent.input_schema,
        "output_schema": agent.output_schema,
        "health_url": agent.health_url,
        "version": agent.version,
    }


def _generic_agent_dict(agent: AgentDefinition | None) -> dict | None:
    if not agent:
        return None
    return {
        "id": str(agent.id),
        "name": agent.name,
        "input_topic": agent.input_topic,
        "output_topic": agent.output_topic,
        "input_schema": None,
        "output_schema": None,
        "health_url": None,
        "version": None,
    }


def _merger_agent_dict(agent: ResponseMerger | None) -> dict | None:
    if not agent:
        return None
    return {
        "id": str(agent.id),
        "name": agent.name,
        "input_topic": ", ".join(agent.input_topic_map.keys()) if agent.input_topic_map else "",
        "output_topic": agent.output_topic,
        "input_schema": None,
        "output_schema": None,
        "health_url": None,
        "version": None,
    }


def _aggregator_dict(agent: AggregatorDefinition | None) -> dict | None:
    if not agent:
        return None
    return {
        "id": str(agent.id),
        "name": agent.name,
        "input_topic": agent.input_topic,
        "output_topic": agent.output_topic,
        "input_schema": None,
        "output_schema": None,
        "health_url": None,
        "version": None,
    }


# ─── Write ────────────────────────────────────────────────────────────────────

def create_graph_pipeline(db: Session, data: dict, created_by: str | None = None) -> dict:
    """
    Create a new pipeline_definition with its nodes and edges.
    data keys: name, description, nodes[], edges[]
    """
    id_val = None
    if data.get("id"):
        try:
            id_val = uuid.UUID(str(data["id"]))
        except ValueError:
            pass

    defn = PipelineDefinition(
        id=id_val if id_val else uuid.uuid4(),
        name=data["name"],
        description=data.get("description"),
        input_type=data.get("input_type", "text"),
        version=1,
        is_active=True,
        created_by=created_by,
    )
    db.add(defn)
    db.flush()  # get defn.id

    node_key_to_id = _create_nodes(db, defn.id, data.get("nodes", []))
    _create_edges(db, defn.id, data.get("edges", []), node_key_to_id)

    db.flush()
    _save_snapshot(db, defn, data.get("nodes", []), data.get("edges", []))
    db.commit()
    return get_graph_pipeline(db, str(defn.id))


def update_graph_pipeline(db: Session, pipeline_id: str, data: dict) -> dict | None:
    """
    Full replace: bump version, delete old nodes/edges, create new ones.
    """
    defn = db.query(PipelineDefinition).filter(PipelineDefinition.id == pipeline_id).first()
    if not defn:
        return None

    # Delete existing nodes + edges (cascade handles edges on node delete, but explicit is safer)
    db.query(PipelineEdge).filter(PipelineEdge.pipeline_id == defn.id).delete()
    db.query(PipelineNode).filter(PipelineNode.pipeline_id == defn.id).delete()
    db.flush()

    defn.name = data.get("name", defn.name)
    defn.description = data.get("description", defn.description)
    if data.get("input_type"):
        defn.input_type = data["input_type"]
    defn.version = defn.version + 1
    db.flush()

    node_key_to_id = _create_nodes(db, defn.id, data.get("nodes", []))
    _create_edges(db, defn.id, data.get("edges", []), node_key_to_id)

    db.flush()
    _save_snapshot(db, defn, data.get("nodes", []), data.get("edges", []))
    db.commit()
    return get_graph_pipeline(db, str(defn.id))


def delete_graph_pipeline(db: Session, pipeline_id: str) -> bool:
    defn = db.query(PipelineDefinition).filter(PipelineDefinition.id == pipeline_id).first()
    if not defn:
        return False
    defn.is_active = False
    db.commit()
    return True


def activate_graph_pipeline(db: Session, pipeline_id: str) -> dict | None:
    defn = db.query(PipelineDefinition).filter(PipelineDefinition.id == pipeline_id).first()
    if not defn:
        return None
    defn.is_active = True
    db.commit()
    return get_graph_pipeline(db, pipeline_id)


def list_pipeline_versions(db: Session, pipeline_id: str) -> list[dict]:
    """Return version history for a pipeline, newest first."""
    defn = db.query(PipelineDefinition).filter(PipelineDefinition.id == pipeline_id).first()
    if not defn:
        return []
    rows = (
        db.query(PipelineVersion)
        .filter(PipelineVersion.pipeline_id == defn.id)
        .order_by(PipelineVersion.version.desc())
        .all()
    )
    return [
        {
            "id": str(v.id),
            "pipeline_id": str(v.pipeline_id),
            "version": v.version,
            "snapshot": v.snapshot,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in rows
    ]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _save_snapshot(
    db: Session,
    defn: PipelineDefinition,
    nodes: list[dict],
    edges: list[dict],
) -> None:
    """Write an immutable PipelineVersion snapshot for the current graph state."""
    snapshot = {
        "name": defn.name,
        "description": defn.description,
        "nodes": nodes,
        "edges": edges,
    }
    pv = PipelineVersion(
        pipeline_id=defn.id,
        version=defn.version,
        snapshot=snapshot,
    )
    db.add(pv)


def _create_nodes(db: Session, pipeline_id: uuid.UUID, nodes: list[dict]) -> dict[str, uuid.UUID]:
    """Create PipelineNode rows. Returns {node_key: node_id} mapping."""
    key_to_id: dict[str, uuid.UUID] = {}
    for n in nodes:
        agent_type = n.get("agent_type", "registry")
        raw_id = n.get("agent_id")
        if agent_type == "generic_llm":
            node = PipelineNode(
                pipeline_id=pipeline_id,
                node_agent_type="generic_llm",
                generic_agent_id=uuid.UUID(str(raw_id)),
                node_key=n["node_key"],
                position_x=n.get("position_x"),
                position_y=n.get("position_y"),
                config_override=n.get("config_override", {}),
                max_retries=n.get("max_retries", 2),
                on_failure=n.get("on_failure", "fail_job"),
            )
        elif agent_type == "output_merger":
            node = PipelineNode(
                pipeline_id=pipeline_id,
                node_agent_type="output_merger",
                merger_id=uuid.UUID(str(raw_id)),
                node_key=n["node_key"],
                position_x=n.get("position_x"),
                position_y=n.get("position_y"),
                config_override=n.get("config_override", {}),
                max_retries=n.get("max_retries", 2),
                on_failure=n.get("on_failure", "fail_job"),
            )
        elif agent_type == "context_aggregator":
            node = PipelineNode(
                pipeline_id=pipeline_id,
                node_agent_type="context_aggregator",
                aggregator_id=uuid.UUID(str(raw_id)),
                node_key=n["node_key"],
                position_x=n.get("position_x"),
                position_y=n.get("position_y"),
                config_override=n.get("config_override", {}),
                max_retries=n.get("max_retries", 2),
                on_failure=n.get("on_failure", "fail_job"),
            )
        else:
            node = PipelineNode(
                pipeline_id=pipeline_id,
                node_agent_type="registry",
                agent_id=int(raw_id),
                node_key=n["node_key"],
                position_x=n.get("position_x"),
                position_y=n.get("position_y"),
                config_override=n.get("config_override", {}),
                max_retries=n.get("max_retries", 2),
                on_failure=n.get("on_failure", "fail_job"),
            )
        db.add(node)
        db.flush()
        key_to_id[n["node_key"]] = node.id
    return key_to_id


_PARALLEL_EDGE_TYPES = {"parallel_fanout", "merger_input"}


def _create_edges(
    db: Session,
    pipeline_id: uuid.UUID,
    edges: list[dict],
    node_key_to_id: dict[str, uuid.UUID],
) -> None:
    """Create PipelineEdge rows using node_key → node_id mapping.

    edge_type drives is_parallel:
      sequential      → is_parallel=False
      parallel_fanout → is_parallel=True
      merger_input    → is_parallel=True  (also requires wait_for_group)
    Explicit is_parallel field accepted too for backward compat.
    """
    for e in edges:
        src_id = node_key_to_id.get(e["source_node_key"])
        tgt_id = node_key_to_id.get(e["target_node_key"])
        if not src_id or not tgt_id:
            continue  # skip malformed edges
        edge_type = e.get("edge_type", "sequential")
        is_parallel = e.get("is_parallel", edge_type in _PARALLEL_EDGE_TYPES)
        edge = PipelineEdge(
            pipeline_id=pipeline_id,
            source_node_id=src_id,
            target_node_id=tgt_id,
            edge_type=edge_type,
            is_parallel=is_parallel,
            wait_for_group=e.get("wait_for_group"),
            is_optional=e.get("is_optional", False),
            # cyclic_feedback config (defaults keep sequential/parallel edges unchanged)
            max_iterations=e.get("max_iterations") or 3,
            break_field=e.get("break_field"),
            break_value=e.get("break_value"),
            loop_to=e.get("loop_to") or "source",
            # agent_routed allowlist
            candidate_agents=e.get("candidate_agents"),
        )
        db.add(edge)
    db.flush()
