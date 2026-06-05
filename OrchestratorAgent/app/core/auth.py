import os
import logging
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import requests
from app.core.config import AUTHENTIK_JWKS_URL
from app.core.app_database import get_app_db
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)

_jwks_cache: dict | None = None

_JWT_SECRET = os.getenv("JWT_SECRET", "haidoc-dev-secret-change-in-production")
_JWT_ALGORITHM = "HS256"


def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        try:
            _jwks_cache = requests.get(AUTHENTIK_JWKS_URL, timeout=10).json()
        except Exception:
            logger.warning("Failed to fetch JWKS from Authentik — RS256 validation unavailable")
            _jwks_cache = {}
    return _jwks_cache


def _decode_token(token: str) -> dict:
    """
    Try HS256 (dashboard JWT) first; fall back to RS256 (Authentik JWKS).
    Raises HTTPException 401 if both fail.
    """
    # Peek at the header to decide which path to try first
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "")
    except JWTError:
        alg = ""

    if alg == "HS256":
        try:
            return jwt.decode(token, _JWT_SECRET, algorithms=["HS256"])
        except JWTError as e:
            logger.warning("HS256 JWT validation failed: %s", e)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # RS256 or unknown — try Authentik JWKS
    jwks = _get_jwks()
    try:
        return jwt.decode(token, jwks, algorithms=["RS256"], options={"verify_aud": False})
    except JWTError as e:
        logger.warning("RS256 JWT validation failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> dict:
    """FastAPI dependency — validates Bearer token from Authorization header."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode_token(credentials.credentials)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency — requires admin OR superadmin role."""
    if user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user


def require_superadmin(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency — requires superadmin role only."""
    if user.get("role") != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin access required.",
        )
    return user


def require_feature(key: str):
    """FastAPI dependency factory — enforces that a feature flag is enabled for the caller's role.

    Usage:
        @router.post("/", dependencies=[Depends(require_feature("audio_job"))])

    Flags are fetched from ConfigService and cached with a 60s TTL, so changes
    propagate within one cache cycle without requiring a restart.
    """
    def _check(user: dict = Depends(get_current_user)) -> dict:
        from app.utils.feature_flags import get_flags_for_role
        role = user.get("role", "user")
        enabled = get_flags_for_role(role)
        if key not in enabled:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Feature '{key}' is not available for your account.",
            )
        return user
    return _check


async def get_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_app_db),
) -> dict:
    """
    Tri-modal auth dependency for job submission endpoints.

    Accepts:
      - HS256 JWT  — dashboard user (role: admin|user)
      - RS256 JWT  — Authentik OAuth2 client
      - mk_...     — pipeline-scoped access key (role: client)

    Returns a normalized principal dict:
      auth_type:            "jwt" | "access_key"
      role:                 "admin" | "user" | "client"
      sub:                  user UUID (JWT) or tenant UUID (access key)
      allowed_pipeline_ids: None = all pipelines, list[str] = restricted set
      access_key_id:        str UUID if access_key auth, else None
      tenant_id:            str UUID if access_key auth, else None
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    raw = credentials.credentials

    if raw.startswith("mk_"):
        # Access key auth
        from app.services.access_key_service import verify_access_key, check_rate_limit, touch_last_used
        key = verify_access_key(db, raw)
        await check_rate_limit(key)
        # Update last_used_at — best effort, non-blocking
        try:
            touch_last_used(db, key.id)
        except Exception:
            pass

        pipeline_ids = key.pipeline_ids or []
        return {
            "auth_type": "access_key",
            "role": "client",
            "sub": str(key.tenant_id),
            "tenant_id": str(key.tenant_id),
            "access_key_id": str(key.id),
            "allowed_pipeline_ids": pipeline_ids if pipeline_ids else None,
        }

    # JWT auth (HS256 or RS256)
    payload = _decode_token(raw)
    payload["auth_type"] = "jwt"
    payload["allowed_pipeline_ids"] = None   # JWT users have no pipeline restriction
    payload["access_key_id"] = None
    payload["tenant_id"] = payload.get("sub")
    return payload


async def get_current_user_from_query(
    token: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_app_db),
) -> dict:
    """
    FastAPI dependency for SSE — accepts token from header or ?token= query param.
    Supports both JWT (HS256/RS256) and mk_ access keys.
    """
    raw = None
    if credentials:
        raw = credentials.credentials
    elif token:
        raw = token

    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if raw.startswith("mk_"):
        from app.services.access_key_service import verify_access_key
        key = verify_access_key(db, raw)
        return {
            "auth_type": "access_key",
            "role": "client",
            "sub": str(key.tenant_id),
            "tenant_id": str(key.tenant_id),
            "access_key_id": str(key.id),
            "allowed_pipeline_ids": key.pipeline_ids or None,
        }

    return _decode_token(raw)
