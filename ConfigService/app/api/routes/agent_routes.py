from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import require_write_auth
from app.schemas.agent_schema import AgentRegisterRequest, AgentRegistryResponse
from app.services import agent_service

router = APIRouter(prefix="/internal/agents", tags=["agent-registry"])


@router.post("/register", response_model=AgentRegistryResponse, status_code=status.HTTP_201_CREATED)
def register_agent(data: AgentRegisterRequest, db: Session = Depends(get_db)):
    """Register or update an agent in the registry."""
    return agent_service.register_agent(db, data)


@router.get("/", response_model=list[AgentRegistryResponse])
def list_agents(db: Session = Depends(get_db)):
    return agent_service.list_agents(db)


@router.get("/{name}", response_model=AgentRegistryResponse)
def get_agent(name: str, db: Session = Depends(get_db)):
    agent = agent_service.get_agent(db, name)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
    return agent


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_agent(name: str, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    if not agent_service.deactivate_agent(db, name):
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
