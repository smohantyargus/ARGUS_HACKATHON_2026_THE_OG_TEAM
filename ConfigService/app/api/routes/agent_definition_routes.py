"""
CRUD for AgentDefinition — configurable text-to-text agents.
GenericAgent containers call GET /internal/agent-definitions/{name} on startup
to fetch their full configuration.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import require_write_auth
from app.models.agent_definition import AgentDefinition

router = APIRouter(prefix="/internal/agent-definitions", tags=["agent-definitions"])


def _row(d: AgentDefinition) -> dict:
    return {
        "id": str(d.id),
        "name": d.name,
        "display_name": d.display_name,
        "description": d.description,
        "input_topic": d.input_topic,
        "output_topic": d.output_topic,
        "input_fields": d.input_fields or [],
        "system_prompt": d.system_prompt,
        "user_prompt_template": d.user_prompt_template,
        "prompt_action": d.prompt_action,
        "llm_instance_name": d.llm_instance_name,
        "max_tokens": d.max_tokens,
        "temperature": d.temperature,
        "output_schema": d.output_schema,
        "validation_rules": d.validation_rules,
        "is_active": d.is_active,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


@router.get("/")
def list_definitions(db: Session = Depends(get_db)):
    return [_row(d) for d in db.query(AgentDefinition).order_by(AgentDefinition.name).all()]


@router.get("/{name}")
def get_definition(name: str, db: Session = Depends(get_db)):
    """Called by GenericAgent on startup to fetch its config."""
    d = db.query(AgentDefinition).filter(AgentDefinition.name == name).first()
    if not d:
        raise HTTPException(status_code=404, detail=f"Agent definition '{name}' not found")
    return _row(d)


@router.post("/", status_code=201)
def create_definition(payload: dict, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    if db.query(AgentDefinition).filter(AgentDefinition.name == payload.get("name")).first():
        raise HTTPException(status_code=409, detail="Agent definition with this name already exists")
    allowed = {
        "id", "name", "display_name", "description", "input_topic", "output_topic",
        "input_fields", "system_prompt", "user_prompt_template", "prompt_action",
        "llm_instance_name", "max_tokens", "temperature", "output_schema",
        "validation_rules", "is_active",
    }
    init_payload = {k: v for k, v in payload.items() if k in allowed}
    if "id" in init_payload and init_payload["id"]:
        import uuid
        init_payload["id"] = uuid.UUID(str(init_payload["id"]))
    d = AgentDefinition(**init_payload)
    db.add(d)
    db.commit()
    db.refresh(d)
    return _row(d)


@router.patch("/{name}")
def update_definition(name: str, payload: dict, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    d = db.query(AgentDefinition).filter(AgentDefinition.name == name).first()
    if not d:
        raise HTTPException(status_code=404, detail=f"Agent definition '{name}' not found")
    allowed = {
        "display_name", "description", "input_topic", "output_topic",
        "input_fields", "system_prompt", "user_prompt_template", "prompt_action",
        "llm_instance_name", "max_tokens", "temperature", "output_schema",
        "validation_rules", "is_active",
    }
    for k, v in payload.items():
        if k in allowed:
            setattr(d, k, v)
    db.commit()
    db.refresh(d)
    return _row(d)


@router.delete("/{name}", status_code=204)
def delete_definition(name: str, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    d = db.query(AgentDefinition).filter(AgentDefinition.name == name).first()
    if not d:
        raise HTTPException(status_code=404, detail=f"Agent definition '{name}' not found")
    db.delete(d)
    db.commit()
