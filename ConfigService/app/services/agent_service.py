from sqlalchemy.orm import Session
from app.models.agent_registry import AgentRegistry
from app.schemas.agent_schema import AgentRegisterRequest


def register_agent(db: Session, data: AgentRegisterRequest) -> AgentRegistry:
    """Register or update an agent in the registry."""
    existing = db.query(AgentRegistry).filter(AgentRegistry.name == data.name).first()
    if existing:
        existing.input_topic = data.input_topic
        existing.output_topic = data.output_topic
        existing.input_schema = data.input_schema
        existing.output_schema = data.output_schema
        existing.health_url = data.health_url
        existing.version = data.version
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return existing

    agent = AgentRegistry(
        name=data.name,
        input_topic=data.input_topic,
        output_topic=data.output_topic,
        input_schema=data.input_schema,
        output_schema=data.output_schema,
        health_url=data.health_url,
        version=data.version,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def list_agents(db: Session, active_only: bool = True) -> list[AgentRegistry]:
    q = db.query(AgentRegistry)
    if active_only:
        q = q.filter(AgentRegistry.is_active.is_(True))
    return q.order_by(AgentRegistry.name).all()


def get_agent(db: Session, name: str) -> AgentRegistry | None:
    return db.query(AgentRegistry).filter(AgentRegistry.name == name).first()


def deactivate_agent(db: Session, name: str) -> bool:
    agent = db.query(AgentRegistry).filter(AgentRegistry.name == name).first()
    if not agent:
        return False
    agent.is_active = False
    db.commit()
    return True
