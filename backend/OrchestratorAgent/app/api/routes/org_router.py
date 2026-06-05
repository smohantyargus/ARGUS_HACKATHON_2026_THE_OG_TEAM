"""
Organisation management endpoints. Admin + superadmin.

Orgs are grouping labels for mk_ access keys.
Keys are created/managed via /v1/access-keys with an org_id field.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.app_database import get_app_db
from app.core.auth import require_admin
from app.services import org_service

router = APIRouter(tags=["organisations"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class OrgCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class OrgUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)


class OrgResponse(BaseModel):
    id: UUID
    name: str
    is_active: bool
    created_by: Optional[str]
    created_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_ext(cls, org) -> "OrgResponse":
        return cls(
            id=org.id,
            name=org.name,
            is_active=org.is_active,
            created_by=org.created_by,
            created_at=org.created_at.isoformat() if org.created_at else "",
        )


class KeySummary(BaseModel):
    id: UUID
    key_prefix: str
    name: str
    pipeline_ids: list[str]
    rate_limit_rpm: int
    is_active: bool
    created_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_ext(cls, key) -> "KeySummary":
        return cls(
            id=key.id,
            key_prefix=key.key_prefix,
            name=key.name,
            pipeline_ids=key.pipeline_ids or [],
            rate_limit_rpm=key.rate_limit_rpm,
            is_active=key.is_active,
            created_at=key.created_at.isoformat() if key.created_at else "",
        )


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/admin/v1/orgs/", status_code=status.HTTP_201_CREATED)
def create_org(
    body: OrgCreate,
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_app_db),
):
    org = org_service.create_org(
        db,
        name=body.name,
        created_by=admin.get("username") or admin.get("sub"),
    )
    return OrgResponse.from_orm_ext(org)


@router.get("/admin/v1/orgs/")
def list_orgs(
    _: dict = Depends(require_admin),
    db: Session = Depends(get_app_db),
):
    return [OrgResponse.from_orm_ext(o) for o in org_service.list_orgs(db)]


@router.get("/admin/v1/orgs/{org_id}")
def get_org(
    org_id: str,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_app_db),
):
    org = org_service.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    keys = org_service.list_keys_for_org(db, org_id)
    return {
        "org": OrgResponse.from_orm_ext(org),
        "keys": [KeySummary.from_orm_ext(k) for k in keys],
    }


@router.patch("/admin/v1/orgs/{org_id}")
def update_org(
    org_id: str,
    body: OrgUpdate,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_app_db),
):
    org = org_service.update_org(db, org_id, name=body.name)
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    return OrgResponse.from_orm_ext(org)


@router.delete("/admin/v1/orgs/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_org(
    org_id: str,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_app_db),
):
    if not org_service.deactivate_org(db, org_id):
        raise HTTPException(status_code=404, detail="Organisation not found")


@router.post("/admin/v1/orgs/{org_id}/activate")
def activate_org(
    org_id: str,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_app_db),
):
    if not org_service.activate_org(db, org_id):
        raise HTTPException(status_code=404, detail="Organisation not found")
    return {"status": "activated"}


@router.get("/admin/v1/orgs/{org_id}/keys")
def list_org_keys(
    org_id: str,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_app_db),
):
    org = org_service.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found")
    keys = org_service.list_keys_for_org(db, org_id)
    return [KeySummary.from_orm_ext(k) for k in keys]
