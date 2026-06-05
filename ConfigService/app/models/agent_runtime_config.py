from sqlalchemy import Column, String, Integer, DateTime
from sqlalchemy.sql import func
from app.core.database import Base


class AgentRuntimeConfig(Base):
    __tablename__ = "agent_runtime_config"

    agent_name = Column(String(100), primary_key=True)
    concurrency = Column(Integer, nullable=False, default=5)
    replica_target = Column(Integer, nullable=False, default=1)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
