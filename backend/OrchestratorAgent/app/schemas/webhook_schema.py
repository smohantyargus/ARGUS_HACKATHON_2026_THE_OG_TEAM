from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID


class WebhookCreate(BaseModel):
    url: str
    events: list[str] = ["job.completed", "job.failed"]
    tenant_id: Optional[UUID] = None  # None = global (fires for all tenants)


class WebhookResponse(BaseModel):
    id: int
    tenant_id: Optional[UUID] = None
    url: str
    events: list[str]
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class WebhookCreateResponse(WebhookResponse):
    """Returned only at creation — secret shown exactly once."""
    secret: str


class WebhookRotateResponse(BaseModel):
    id: int
    secret: str  # new secret — shown exactly once


class WebhookDeliveryResponse(BaseModel):
    id: int
    webhook_id: int
    job_id: Optional[str] = None
    event: str
    attempt: int
    status: str
    response_status: Optional[int] = None
    error: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
