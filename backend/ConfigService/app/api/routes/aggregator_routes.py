"""
CRUD for AggregatorDefinition — config-driven fan-in synthesis agents.
ContextAggregatorAgent containers call GET /internal/aggregators/{name} on startup.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import require_write_auth
from app.models.aggregator_definition import AggregatorDefinition

router = APIRouter(prefix="/internal/aggregators", tags=["aggregators"])


def _row(a: AggregatorDefinition) -> dict:
    return {
        "id": str(a.id),
        "name": a.name,
        "display_name": a.display_name,
        "description": a.description,
        "input_topic": a.input_topic,
        "output_topic": a.output_topic,
        "input_sources": a.input_sources or [],
        "synthesis_prompt": a.synthesis_prompt,
        "output_schema_type": a.output_schema_type,
        "output_persona": a.output_persona,
        "llm_instance_name": a.llm_instance_name,
        "max_tokens": a.max_tokens,
        "temperature": a.temperature,
        "min_required_inputs": a.min_required_inputs,
        "timeout_seconds": a.timeout_seconds,
        "conflict_threshold": a.conflict_threshold,
        "is_active": a.is_active,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


@router.get("/")
def list_aggregators(db: Session = Depends(get_db)):
    return [_row(a) for a in db.query(AggregatorDefinition).order_by(AggregatorDefinition.name).all()]


@router.get("/{name}")
def get_aggregator(name: str, db: Session = Depends(get_db)):
    """Called by ContextAggregatorAgent on startup to fetch config."""
    a = db.query(AggregatorDefinition).filter(AggregatorDefinition.name == name).first()
    if not a:
        raise HTTPException(status_code=404, detail=f"Aggregator definition '{name}' not found")
    return _row(a)


@router.post("/", status_code=201)
def create_aggregator(payload: dict, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    if db.query(AggregatorDefinition).filter(AggregatorDefinition.name == payload.get("name")).first():
        raise HTTPException(status_code=409, detail="Aggregator with this name already exists")
    allowed = {
        "name", "display_name", "description", "input_topic", "output_topic",
        "input_sources", "synthesis_prompt", "output_schema_type", "output_persona",
        "llm_instance_name", "max_tokens", "temperature",
        "min_required_inputs", "timeout_seconds", "conflict_threshold", "is_active",
    }
    a = AggregatorDefinition(**{k: v for k, v in payload.items() if k in allowed})
    db.add(a)
    db.commit()
    db.refresh(a)
    return _row(a)


@router.patch("/{name}")
def update_aggregator(name: str, payload: dict, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    a = db.query(AggregatorDefinition).filter(AggregatorDefinition.name == name).first()
    if not a:
        raise HTTPException(status_code=404, detail=f"Aggregator definition '{name}' not found")
    allowed = {
        "display_name", "description", "input_topic", "output_topic",
        "input_sources", "synthesis_prompt", "output_schema_type", "output_persona",
        "llm_instance_name", "max_tokens", "temperature",
        "min_required_inputs", "timeout_seconds", "conflict_threshold", "is_active",
    }
    for k, v in payload.items():
        if k in allowed:
            setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return _row(a)


@router.delete("/{name}", status_code=204)
def delete_aggregator(name: str, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    a = db.query(AggregatorDefinition).filter(AggregatorDefinition.name == name).first()
    if not a:
        raise HTTPException(status_code=404, detail=f"Aggregator definition '{name}' not found")
    db.delete(a)
    db.commit()
