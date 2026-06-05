from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import require_write_auth
from app.schemas.config_schema import ConfigEntryCreate, ConfigEntryUpdate, ConfigEntryResponse
from app.services import config_service

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/{agent_name}", response_model=list[ConfigEntryResponse])
def get_agent_config(agent_name: str, db: Session = Depends(get_db)):
    """Returns merged config for an agent (global + agent-specific).
    Secret values are redacted unless ?reveal_secrets=true."""
    entries = config_service.get_agent_config(db, agent_name)
    return entries


@router.get("/{agent_name}/{key}", response_model=ConfigEntryResponse)
def get_config_key(agent_name: str, key: str, db: Session = Depends(get_db)):
    entry = config_service.get_config_by_key(db, agent_name, key)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Config key '{key}' not found")
    return entry


@router.put("/{agent_name}/{key}", response_model=ConfigEntryResponse)
def update_config_key(agent_name: str, key: str, data: ConfigEntryUpdate, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    # Treat "global" as NULL agent_name
    resolved_agent = None if agent_name == "global" else agent_name
    entry = config_service.update_config(db, resolved_agent, key, data)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Config key '{key}' not found")
    return entry


@router.post("/", response_model=ConfigEntryResponse, status_code=status.HTTP_201_CREATED)
def create_config(data: ConfigEntryCreate, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    return config_service.upsert_config(db, data)


@router.delete("/{agent_name}/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_config_key(agent_name: str, key: str, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    resolved_agent = None if agent_name == "global" else agent_name
    deleted = config_service.delete_config(db, resolved_agent, key)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Config key '{key}' not found")
