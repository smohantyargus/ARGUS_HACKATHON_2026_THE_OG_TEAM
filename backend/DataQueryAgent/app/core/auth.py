"""
Auth dependencies for DataQueryAgent REST routes.

Three tiers:
  require_auth          — any valid JWT (authenticated user)
  require_write_auth    — JWT with admin/superadmin role (system-level ops)
  require_domain_access — JWT + DomainMember row for the target domain
                          (superadmin bypasses membership check)

Mirrors ConfigService/app/core/auth.py but adds domain-scoped dependency.
"""
from __future__ import annotations

import logging
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import DomainMember

logger = logging.getLogger(__name__)

_JWT_SECRET = os.getenv("JWT_SECRET", "civis-dev-secret-change-in-production")
_ALGORITHM = "HS256"
_ADMIN_ROLES = {"admin", "superadmin"}

_bearer = HTTPBearer(auto_error=False)


def _claims(creds: HTTPAuthorizationCredentials | None) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    try:
        return jwt.decode(creds.credentials, _JWT_SECRET, algorithms=[_ALGORITHM])
    except JWTError as exc:
        logger.warning("DataQueryAgent auth failed: %s", exc)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


def require_auth(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Any authenticated user."""
    return _claims(creds)


def require_write_auth(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Admin or superadmin role — for system-level operations."""
    c = _claims(creds)
    if c.get("role") not in _ADMIN_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return c


def require_domain_access(level: str):
    """
    Factory returning a FastAPI dependency for domain-scoped access control.

    level = "view"  → DomainMember with any role (or superadmin)
    level = "edit"  → DomainMember with owner/editor role (or superadmin)
    level = "own"   → DomainMember with owner role (or superadmin)

    Usage:
        @router.patch("/{domain_key}/...")
        def handler(domain_key: str, claims = Depends(require_domain_access("edit"))):
            ...
    FastAPI injects domain_key from the path into the dependency automatically.
    """
    def dep(
        domain_key: str,                                            # injected from path
        db: Session = Depends(get_db),
        creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> dict:
        c = _claims(creds)
        if c.get("role") == "superadmin":
            return c
        m = (
            db.query(DomainMember)
            .filter_by(domain_key=domain_key, user_id=c.get("sub"))
            .first()
        )
        if not m:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this domain")
        if level == "edit" and m.role not in ("owner", "editor"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Editor or owner role required")
        if level == "own" and m.role != "owner":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner role required")
        return c

    return dep
