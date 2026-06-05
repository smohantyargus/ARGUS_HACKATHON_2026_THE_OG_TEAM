"""
Write-guard for ConfigService mutating routes.

Validates the HS256 JWT forwarded by nginx (Authorization: Bearer <token>).
Only checks that the token is valid and the caller is admin/superadmin.
GET routes (called by containers on startup) remain open.
"""
import os
import logging
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

logger = logging.getLogger(__name__)

_JWT_SECRET = os.getenv("JWT_SECRET", "civis-dev-secret-change-in-production")
_ALGORITHM = "HS256"
_ADMIN_ROLES = {"admin", "superadmin"}

_bearer = HTTPBearer(auto_error=False)


def require_write_auth(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if creds is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        payload = jwt.decode(creds.credentials, _JWT_SECRET, algorithms=[_ALGORITHM])
    except JWTError as exc:
        logger.warning("ConfigService write auth failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    role = payload.get("role", "")
    if role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return payload
