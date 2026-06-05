"""
Role management + user administration endpoints.

Permission matrix:
  admin      — create/delete/edit non-system roles; change non-admin/non-superadmin user roles
  superadmin — everything admin can + change admin user roles; assign admin role to users
               (cannot assign superadmin role or touch other superadmins)
"""
from __future__ import annotations

import logging
import os
from typing import Optional
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.app_database import get_app_db
from app.core.database import get_db
from app.core.auth import require_admin, require_superadmin, get_current_user
from app.models.role import Role
from app.models.user_model import User

logger = logging.getLogger(__name__)

CONFIG_SERVICE_URL = os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")

router = APIRouter(tags=["roles"])

# ── Privileged role names — special-cased throughout ─────────────────────────

_SYSTEM_UNDELETABLE = {"superadmin"}   # nobody can delete superadmin via API
_ADMIN_CANNOT_ASSIGN = {"admin", "superadmin"}
_SUPERADMIN_CANNOT_ASSIGN = {"superadmin"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class RoleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z0-9_]+$")
    label: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    feature_keys: list[str] = Field(
        default_factory=list,
        description="Feature flag keys to enable for this role on creation.",
    )


class RoleUpdate(BaseModel):
    label: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = None


class RoleResponse(BaseModel):
    name: str
    label: str
    description: Optional[str] = None
    is_system: bool
    is_registerable: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserRoleUpdate(BaseModel):
    role: str


class UserAdminResponse(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool = Field(alias="isActive")
    created_at: datetime = Field(alias="createdAt")

    model_config = {"from_attributes": True, "populate_by_name": True}


# ── Role CRUD ─────────────────────────────────────────────────────────────────

@router.get("/v1/roles", response_model=list[RoleResponse])
def list_roles(
    app_db: Session = Depends(get_app_db),
    _user: dict = Depends(get_current_user),
):
    """List all roles. Any authenticated user."""
    return app_db.query(Role).order_by(Role.is_system.desc(), Role.name).all()


@router.post("/v1/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_role(
    body: RoleCreate,
    app_db: Session = Depends(get_app_db),
    caller: dict = Depends(require_admin),
):
    """Create a new role and optionally assign features to it. Admin+."""
    if body.name in ("admin", "superadmin", "user"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role name '{body.name}' is reserved.",
        )
    if app_db.query(Role).filter(Role.name == body.name).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Role '{body.name}' already exists.",
        )

    role = Role(
        name=body.name,
        label=body.label,
        description=body.description,
        is_system=False,
        is_registerable=True,
    )
    app_db.add(role)
    app_db.commit()
    app_db.refresh(role)

    # Assign features — call ConfigService bulk endpoint
    if body.feature_keys:
        await _bulk_assign_role(body.name, body.feature_keys, action="add")

    logger.info("Role '%s' created by %s", body.name, caller.get("username"))
    return role


@router.patch("/v1/roles/{name}", response_model=RoleResponse)
def update_role(
    name: str,
    body: RoleUpdate,
    app_db: Session = Depends(get_app_db),
    _caller: dict = Depends(require_admin),
):
    """Update role label/description. Admin+."""
    role = _get_role_or_404(app_db, name)
    if body.label is not None:
        role.label = body.label
    if body.description is not None:
        role.description = body.description
    app_db.commit()
    app_db.refresh(role)
    return role


@router.delete("/v1/roles/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    name: str,
    app_db: Session = Depends(get_app_db),
    caller: dict = Depends(get_current_user),
):
    """
    Delete a role.
    - Admin: can delete non-system roles only.
    - Superadmin: can also delete the 'admin' system role (but not 'superadmin').
    """
    caller_role = caller.get("role")
    if caller_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")

    if name in _SYSTEM_UNDELETABLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{name}' cannot be deleted.",
        )

    role = _get_role_or_404(app_db, name)

    if role.is_system and caller_role != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"System role '{name}' can only be deleted by superadmin.",
        )

    # Remove role from all feature flags before deleting
    await _bulk_assign_role(name, feature_keys=[], action="remove_all")

    app_db.delete(role)
    app_db.commit()
    logger.info("Role '%s' deleted by %s", name, caller.get("username"))


# ── User administration ───────────────────────────────────────────────────────

@router.get("/v1/users", response_model=list[UserAdminResponse])
def list_users(
    db: Session = Depends(get_db),
    _caller: dict = Depends(require_admin),
):
    """List all users. Admin+."""
    return db.query(User).order_by(User.createdAt.desc()).all()


@router.patch("/v1/users/{user_id}/role", response_model=UserAdminResponse)
def change_user_role(
    user_id: int,
    body: UserRoleUpdate,
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
    caller: dict = Depends(get_current_user),
):
    """
    Change a user's role.

    Admin can:    change non-admin/non-superadmin users to any non-admin/non-superadmin role
    Superadmin:   can change any non-superadmin user to any non-superadmin role (including admin)
    """
    caller_role = caller.get("role")
    if caller_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")

    # Verify target role exists and is assignable
    new_role_name = body.role
    target_role = app_db.query(Role).filter(Role.name == new_role_name).first()
    if not target_role:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Role '{new_role_name}' does not exist.")

    target_user = db.query(User).filter(User.userId == user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    # Enforce hierarchy
    if caller_role == "superadmin":
        if target_user.role == "superadmin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change another superadmin's role.")
        if new_role_name in _SUPERADMIN_CANNOT_ASSIGN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot assign superadmin role.")
    else:  # admin
        if target_user.role in ("admin", "superadmin"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only superadmin can change admin/superadmin roles.")
        if new_role_name in _ADMIN_CANNOT_ASSIGN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin cannot assign admin or superadmin role.")

    old_role = target_user.role
    target_user.role = new_role_name
    db.commit()
    db.refresh(target_user)
    logger.info(
        "User %s role changed %s → %s by %s",
        target_user.username, old_role, new_role_name, caller.get("username"),
    )
    return target_user


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_role_or_404(db: Session, name: str) -> Role:
    role = db.query(Role).filter(Role.name == name).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Role '{name}' not found.")
    return role


async def _bulk_assign_role(role_name: str, feature_keys: list[str], action: str = "add"):
    """
    Call ConfigService to add/remove a role from feature flags.
    action: "add" | "remove" | "remove_all" (remove from every feature)
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{CONFIG_SERVICE_URL}/features/bulk-role-assign",
                json={"role_name": role_name, "feature_keys": feature_keys, "action": action},
            )
    except Exception as exc:
        logger.warning("bulk-role-assign call failed for role '%s': %s", role_name, exc)
