from pydantic import BaseModel
from typing import Any, Optional
from datetime import datetime


class ConfigEntryCreate(BaseModel):
    agent_name: Optional[str] = None
    key: str
    value: Any
    is_secret: bool = False
    description: Optional[str] = None


class ConfigEntryUpdate(BaseModel):
    value: Any
    is_secret: Optional[bool] = None
    description: Optional[str] = None


class ConfigEntryResponse(BaseModel):
    id: int
    agent_name: Optional[str]
    key: str
    value: Any
    is_secret: bool
    description: Optional[str]
    updated_at: datetime

    model_config = {"from_attributes": True}
