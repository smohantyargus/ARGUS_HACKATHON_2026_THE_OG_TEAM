from pydantic import BaseModel, field_validator
from typing import Optional, Any
from datetime import datetime
import json


class PromptTemplateCreate(BaseModel):
    action: str
    system_prompt: str
    user_prompt: str
    input_variables: Optional[list[str]] = None
    output_schema: Optional[dict[str, Any]] = None


class PromptTemplateUpdate(BaseModel):
    system_prompt: str
    user_prompt: str
    input_variables: Optional[list[str]] = None
    output_schema: Optional[dict[str, Any]] = None


class PromptTemplateResponse(BaseModel):
    id: int
    action: str
    system_prompt: str
    user_prompt: str
    input_variables: Optional[list[str]] = None
    output_schema: Optional[dict[str, Any]] = None
    version: int
    is_active: bool
    created_at: datetime

    @field_validator("input_variables", mode="before")
    @classmethod
    def parse_input_variables(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return None
        return v

    @field_validator("output_schema", mode="before")
    @classmethod
    def parse_output_schema(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return None
        return v

    model_config = {"from_attributes": True}
