"""
Access Key + Tenant management endpoints. Admin only.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.app_database import get_app_db
from app.core.auth import require_admin
from app.services.audit_service import log_audit
from app.services.access_key_service import (
    create_access_key,
    list_access_keys,
    revoke_access_key,
    get_or_create_tenant,
    list_tenants,
)

router = APIRouter(tags=["access-keys"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class TenantCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    slug: Optional[str] = Field(default=None, max_length=100)


class TenantResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AccessKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    tenant_name: str = Field(..., description="Tenant name — created if it doesn't exist")
    pipeline_ids: list[str] = Field(
        default_factory=list,
        description="Pipeline names this key can invoke (e.g. ['audio_full', 'text_summarise']). Empty = all pipelines.",
    )
    rate_limit_rpm: int = Field(default=60, ge=1, le=10000)
    expires_at: Optional[datetime] = None
    org_id: Optional[UUID] = Field(default=None, description="Optional org this key belongs to")


class AccessKeyResponse(BaseModel):
    id: UUID
    key_prefix: str
    name: str
    tenant_id: UUID
    org_id: Optional[UUID]
    pipeline_ids: list[str]
    rate_limit_rpm: int
    expires_at: Optional[datetime]
    last_used_at: Optional[datetime]
    is_active: bool
    created_by: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class AccessKeyCreated(AccessKeyResponse):
    """Returned only on creation — includes the raw key (shown once, never stored)."""
    raw_key: str


# ─── Tenant routes ─────────────────────────────────────────────────────────────

@router.post("/v1/tenants", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
def create_tenant(
    body: TenantCreate,
    db: Session = Depends(get_app_db),
    _user: dict = Depends(require_admin),
):
    """Create a tenant (or return existing by name). Admin only."""
    tenant = get_or_create_tenant(db, name=body.name, slug=body.slug)
    return tenant


@router.get("/v1/tenants", response_model=list[TenantResponse])
def get_tenants(
    db: Session = Depends(get_app_db),
    _user: dict = Depends(require_admin),
):
    """List all tenants. Admin only."""
    return list_tenants(db)


# ─── Access key routes ─────────────────────────────────────────────────────────

@router.post("/v1/access-keys", response_model=AccessKeyCreated, status_code=status.HTTP_201_CREATED)
def create_key(
    request: Request,
    body: AccessKeyCreate,
    db: Session = Depends(get_app_db),
    user: dict = Depends(require_admin),
):
    """
    Generate a new access key. Admin only.
    The `raw_key` field in the response is shown ONCE and never stored — save it immediately.
    """
    tenant = get_or_create_tenant(db, name=body.tenant_name)
    key, raw = create_access_key(
        db,
        name=body.name,
        tenant_id=tenant.id,
        pipeline_ids=body.pipeline_ids,
        rate_limit_rpm=body.rate_limit_rpm,
        expires_at=body.expires_at,
        created_by=user.get("username"),
        org_id=body.org_id,
    )
    log_audit(
        db,
        actor_type="user",
        action="key.create",
        resource=f"key:{key.key_prefix}",
        user_id=user.get("username"),
        tenant_id=key.tenant_id,
        ip_address=request.client.host if request.client else None,
        detail={"name": key.name, "tenant": body.tenant_name, "pipelines": body.pipeline_ids, "org_id": str(body.org_id) if body.org_id else None},
    )
    return AccessKeyCreated(
        id=key.id,
        key_prefix=key.key_prefix,
        name=key.name,
        tenant_id=key.tenant_id,
        org_id=key.org_id,
        pipeline_ids=key.pipeline_ids or [],
        rate_limit_rpm=key.rate_limit_rpm,
        expires_at=key.expires_at,
        last_used_at=key.last_used_at,
        is_active=key.is_active,
        created_by=key.created_by,
        created_at=key.created_at,
        raw_key=raw,
    )


@router.get("/v1/access-keys", response_model=list[AccessKeyResponse])
def get_keys(
    tenant_id: Optional[UUID] = None,
    db: Session = Depends(get_app_db),
    _user: dict = Depends(require_admin),
):
    """List access keys. Optionally filter by tenant_id. Admin only."""
    return list_access_keys(db, tenant_id=tenant_id)


@router.delete("/v1/access-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_key(
    key_id: UUID,
    request: Request,
    db: Session = Depends(get_app_db),
    user: dict = Depends(require_admin),
):
    """Revoke (deactivate) an access key. Admin only."""
    if not revoke_access_key(db, key_id):
        raise HTTPException(status_code=404, detail="Access key not found")
    log_audit(
        db,
        actor_type="user",
        action="key.revoke",
        resource=f"key:{key_id}",
        user_id=user.get("username"),
        ip_address=request.client.host if request.client else None,
    )
