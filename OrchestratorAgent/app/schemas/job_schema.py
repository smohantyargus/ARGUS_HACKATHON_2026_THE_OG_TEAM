from pydantic import BaseModel
from typing import Any, Optional
from datetime import datetime
from uuid import UUID


class JobCreateRequest(BaseModel):
    job: list[str]
    action: Optional[list[str]] = None
    text: Optional[str] = None
    model_name: str = "whisperx"
    target_lang: Optional[str] = "en"


class JobResponse(BaseModel):
    job_id: UUID
    status: str
    pipeline: list[str]
    pipeline_id: Optional[UUID] = None
    pipeline_name: Optional[str] = None
    current_step: Optional[str]
    input_meta: Optional[dict]
    result: Optional[Any]
    error: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class JobListResponse(BaseModel):
    items: list[JobResponse]
    total: int
    failed_count: int


class JobStepResponse(BaseModel):
    id: int
    job_id: UUID
    step_name: str
    agent_name: Optional[str]
    status: str
    output: Optional[Any]
    error: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class JobCreatedResponse(BaseModel):
    job_id: UUID
    status: str
    message: str


class FeedbackRequest(BaseModel):
    output_type: str
    field: Optional[str] = None
    rating: int
    correction: Optional[str] = None

    model_config = {"json_schema_extra": {"examples": [{"output_type": "soap", "rating": 4}]}}
