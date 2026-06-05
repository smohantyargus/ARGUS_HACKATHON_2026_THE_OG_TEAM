"""
Graph pipeline CRUD endpoints.
Operates on pipeline_definitions / pipeline_nodes / pipeline_edges.
This is the single pipeline source of truth — pipeline_templates table has been removed.
"""
import os
from typing import Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services import pipeline_graph_service

_JWT_SECRET = os.getenv("JWT_SECRET", "haidoc-dev-secret-change-in-production")

router = APIRouter(prefix="/pipelines/graph", tags=["pipeline-graph"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class NodeInput(BaseModel):
    node_key: str
    agent_id: Optional[Union[int, str]] = None   # int for registry, UUID str for generic_llm/output_merger/context_aggregator
    agent_type: str = "registry"                  # registry | generic_llm | output_merger | context_aggregator
    position_x: Optional[float] = None
    position_y: Optional[float] = None
    config_override: dict = {}
    max_retries: int = 2
    on_failure: str = "fail_job"


class EdgeInput(BaseModel):
    source_node_key: str
    target_node_key: str
    edge_type: str = "sequential"    # sequential | parallel_fanout | merger_input
    is_parallel: bool = False        # derived from edge_type if not set explicitly
    wait_for_group: Optional[str] = None   # required for merger_input edges
    is_optional: bool = False


class PipelineGraphCreate(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    input_type: str = "text"
    nodes: list[NodeInput] = []
    edges: list[EdgeInput] = []


class PipelineGraphUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    input_type: Optional[str] = None
    nodes: list[NodeInput] = []
    edges: list[EdgeInput] = []


class PipelineGraphSummary(BaseModel):
    id: str
    name: str
    description: Optional[str]
    input_type: str = "text"
    version: int
    is_active: bool
    created_by: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]

    model_config = {"from_attributes": True}


def _role(
    authorization: Optional[str] = Header(default=None),
) -> str:
    """Role derived from JWT only — never from a client-set header."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        try:
            from jose import jwt as _jwt
            payload = _jwt.decode(token, _JWT_SECRET, algorithms=["HS256"])
            return payload.get("role", "user")
        except Exception:
            pass
    return "user"


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[PipelineGraphSummary])
def list_graph_pipelines(db: Session = Depends(get_db)):
    """List all graph pipeline definitions (summary — no nodes/edges)."""
    pipelines = pipeline_graph_service.list_graph_pipelines(db)
    return [
        PipelineGraphSummary(
            id=str(p.id),
            name=p.name,
            description=p.description,
            input_type=p.input_type or "text",
            version=p.version,
            is_active=p.is_active,
            created_by=p.created_by,
            created_at=p.created_at.isoformat() if p.created_at else None,
            updated_at=p.updated_at.isoformat() if p.updated_at else None,
        )
        for p in pipelines
    ]


@router.get("/{pipeline_id}")
def get_graph_pipeline(pipeline_id: str, db: Session = Depends(get_db)):
    """Fetch full pipeline graph: definition + nodes (with agent info) + edges."""
    result = pipeline_graph_service.get_graph_pipeline(db, pipeline_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Pipeline graph '{pipeline_id}' not found")
    return result


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_graph_pipeline(
    data: PipelineGraphCreate,
    role: str = Depends(_role),
    db: Session = Depends(get_db),
):
    """Create a new graph pipeline. Admin only."""
    if role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin access required.")
    try:
        return pipeline_graph_service.create_graph_pipeline(db, data.model_dump(), created_by=role)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{pipeline_id}")
def update_graph_pipeline(
    pipeline_id: str,
    data: PipelineGraphUpdate,
    role: str = Depends(_role),
    db: Session = Depends(get_db),
):
    """Full graph replace — bumps version, replaces all nodes and edges. Admin only."""
    if role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin access required.")
    result = pipeline_graph_service.update_graph_pipeline(db, pipeline_id, data.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=404, detail=f"Pipeline graph '{pipeline_id}' not found")
    return result


@router.delete("/{pipeline_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_graph_pipeline(
    pipeline_id: str,
    role: str = Depends(_role),
    db: Session = Depends(get_db),
):
    """Deactivate a graph pipeline. Admin only."""
    if role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin access required.")
    if not pipeline_graph_service.delete_graph_pipeline(db, pipeline_id):
        raise HTTPException(status_code=404, detail=f"Pipeline graph '{pipeline_id}' not found")


@router.post("/{pipeline_id}/activate")
def activate_graph_pipeline(
    pipeline_id: str,
    role: str = Depends(_role),
    db: Session = Depends(get_db),
):
    """Re-activate a deactivated graph pipeline. Admin only."""
    if role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin access required.")
    result = pipeline_graph_service.activate_graph_pipeline(db, pipeline_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Pipeline graph '{pipeline_id}' not found")
    return result


@router.get("/{pipeline_id}/versions")
def list_pipeline_versions(
    pipeline_id: str,
    db: Session = Depends(get_db),
):
    """List all immutable version snapshots for a pipeline, newest first."""
    # verify pipeline exists first
    if not pipeline_graph_service.get_graph_pipeline(db, pipeline_id):
        raise HTTPException(status_code=404, detail=f"Pipeline graph '{pipeline_id}' not found")
    return pipeline_graph_service.list_pipeline_versions(db, pipeline_id)
