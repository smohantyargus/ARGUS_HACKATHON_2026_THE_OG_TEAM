"""
LLM Instance registry endpoints.
Agents call GET /internal/llm/by-agent/{name} on startup to discover
which LLM endpoint to use — instead of having hardcoded provider config.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import require_write_auth
from app.models.llm_instance import LlmInstance, AgentLlmAssignment
from app.models.agent_registry import AgentRegistry

router = APIRouter(prefix="/internal/llm", tags=["llm-registry"])


def _row(inst: LlmInstance) -> dict:
    return {
        "id": str(inst.id),
        "name": inst.name,
        "provider": inst.provider,          # "anthropic" | "gemini" | "llamacpp" | "openai_compat"
        "base_url": inst.base_url,
        "model_name": inst.model_name,
        "max_parallel": inst.max_parallel,
        "priority": inst.priority,
        "is_active": inst.is_active,
        "health_endpoint": inst.health_endpoint,
        "api_key_config_key": inst.api_key_config_key,  # key into ConfigService entries
    }


@router.get("/instances")
def list_llm_instances(db: Session = Depends(get_db)):
    """List all LLM instances (active and inactive)."""
    instances = db.query(LlmInstance).order_by(LlmInstance.priority).all()
    return [_row(i) for i in instances]


@router.patch("/instances/{instance_id}")
def update_llm_instance(instance_id: str, payload: dict, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    """Update is_active, priority, or model_name on an LLM instance."""
    import uuid
    try:
        uid = uuid.UUID(instance_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID")

    inst = db.query(LlmInstance).filter(LlmInstance.id == uid).first()
    if not inst:
        raise HTTPException(status_code=404, detail="LLM instance not found")

    allowed = {"is_active", "priority", "model_name", "max_parallel"}
    for k, v in payload.items():
        if k in allowed:
            setattr(inst, k, v)

    db.commit()
    db.refresh(inst)
    return _row(inst)


@router.get("/by-agent/{agent_name}")
def get_llm_for_agent(agent_name: str, db: Session = Depends(get_db)):
    """
    Return active LLM instances assigned to agent, sorted by priority ascending
    (lowest priority number = most preferred).

    Agents should pick index 0, fall back to index 1 on error, etc.
    Returns [] if the agent has no assignments — agent should fall back to its
    local defaults (env vars / config entries).
    """
    agent = (
        db.query(AgentRegistry)
        .filter(AgentRegistry.name == agent_name, AgentRegistry.is_active == True)  # noqa: E712
        .first()
    )
    if not agent:
        # Return empty list rather than 404 so agents degrade gracefully
        return []

    assignments = (
        db.query(AgentLlmAssignment)
        .filter(AgentLlmAssignment.agent_id == agent.id)
        .all()
    )
    if not assignments:
        return []

    llm_ids = [a.llm_instance_id for a in assignments]
    instances = (
        db.query(LlmInstance)
        .filter(LlmInstance.id.in_(llm_ids), LlmInstance.is_active == True)  # noqa: E712
        .order_by(LlmInstance.priority)
        .all()
    )
    return [_row(i) for i in instances]
