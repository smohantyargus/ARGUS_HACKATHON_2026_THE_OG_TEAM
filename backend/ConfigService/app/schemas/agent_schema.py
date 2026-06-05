from pydantic import BaseModel
from datetime import datetime


class AgentRegisterRequest(BaseModel):
    name: str
    input_topic: str
    output_topic: str
    input_schema: dict | None = None
    output_schema: dict | None = None
    health_url: str | None = None
    version: str | None = None


class AgentRegistryResponse(BaseModel):
    id: int
    name: str
    input_topic: str
    output_topic: str
    input_schema: dict | None = None
    output_schema: dict | None = None
    health_url: str | None = None
    version: str | None = None
    is_active: bool
    registered_at: datetime

    model_config = {"from_attributes": True}
