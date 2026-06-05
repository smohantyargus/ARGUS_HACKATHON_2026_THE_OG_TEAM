import os
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Literal, Optional
from app.core.database import get_db
from app.core.auth import require_write_auth
from app.models.feature_flag import FeatureFlag

_JWT_SECRET = os.getenv("JWT_SECRET", "haidoc-dev-secret-change-in-production")

router = APIRouter(prefix="/features", tags=["feature-flags"])


class FeatureFlagResponse(BaseModel):
    key: str
    label: str
    enabled: bool
    roles: list[str]
    description: str | None = None

    model_config = {"from_attributes": True}


class FeatureFlagUpdate(BaseModel):
    enabled: bool | None = None
    roles: list[str] | None = None
    label: str | None = None
    description: str | None = None


class BulkRoleAssign(BaseModel):
    role_name: str
    feature_keys: list[str]
    action: Literal["add", "remove", "remove_all"] = "add"


def _role_from_jwt(
    authorization: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None, alias="X-User-Role"),
) -> str:
    """Extract caller role from a verified JWT or fallback to X-User-Role header for internal queries."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        try:
            from jose import jwt as _jwt
            payload = _jwt.decode(token, _JWT_SECRET, algorithms=["HS256"])
            return payload.get("role", "user")
        except Exception:
            pass
    if x_user_role:
        return x_user_role
    return "user"


@router.get("/", response_model=list[FeatureFlagResponse])
def get_features_for_role(
    role: str = Depends(_role_from_jwt),
    db: Session = Depends(get_db),
):
    """Return only flags that are enabled AND include the caller's role.
    Used by the frontend on login to build the feature context."""
    flags = db.query(FeatureFlag).filter(FeatureFlag.enabled.is_(True)).all()
    return [f for f in flags if role in (f.roles or [])]


@router.get("/all", response_model=list[FeatureFlagResponse])
def get_all_features(
    role: str = Depends(_role_from_jwt),
    db: Session = Depends(get_db),
):
    """Return all flags regardless of enabled/role state.
    Used by the admin Feature Flags management page."""
    if role not in ("admin", "superadmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return db.query(FeatureFlag).order_by(FeatureFlag.key).all()


@router.put("/{key}", response_model=FeatureFlagResponse)
def update_feature_flag(
    key: str,
    data: FeatureFlagUpdate,
    role: str = Depends(_role_from_jwt),
    db: Session = Depends(get_db),
):
    """Update a feature flag (toggle enabled, change roles, etc). Admin only."""
    if role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")

    flag = db.query(FeatureFlag).filter(FeatureFlag.key == key).first()
    if not flag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Feature flag '{key}' not found.")

    if data.enabled is not None:
        flag.enabled = data.enabled
    if data.roles is not None:
        flag.roles = data.roles
    if data.label is not None:
        flag.label = data.label
    if data.description is not None:
        flag.description = data.description

    db.commit()
    db.refresh(flag)
    return flag


@router.post("/bulk-role-assign", status_code=status.HTTP_204_NO_CONTENT)
def bulk_role_assign(data: BulkRoleAssign, db: Session = Depends(get_db), _: dict = Depends(require_write_auth)):
    """
    Add or remove a role from multiple feature flags atomically.
    Called internally by the orchestrator role management endpoints.

    action="add"        — add role_name to roles[] on each flag in feature_keys
    action="remove"     — remove role_name from roles[] on each flag in feature_keys
    action="remove_all" — remove role_name from ALL feature flags (used on role deletion)
    """
    if data.action == "remove_all":
        flags = db.query(FeatureFlag).all()
    else:
        flags = db.query(FeatureFlag).filter(FeatureFlag.key.in_(data.feature_keys)).all()

    for flag in flags:
        roles: list[str] = list(flag.roles or [])
        if data.action == "add":
            if data.role_name not in roles:
                roles.append(data.role_name)
        else:  # remove or remove_all
            roles = [r for r in roles if r != data.role_name]
        flag.roles = roles

    db.commit()


@router.get("/all-roles", tags=["feature-flags"])
def get_all_roles_in_use(db: Session = Depends(get_db)):
    """Return all distinct role names currently referenced in any feature flag's roles array.
    Used by the frontend to populate role checkboxes dynamically."""
    flags = db.query(FeatureFlag).all()
    roles: set[str] = set()
    for f in flags:
        roles.update(f.roles or [])
    return sorted(roles)
