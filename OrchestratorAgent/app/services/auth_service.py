import os
import hmac
import logging
import bcrypt
import requests as _requests
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, status
from jose import jwt
from authentik_client.api.core_api import CoreApi
from authentik_client.models.user_request import UserRequest
from authentik_client.models.user_password_set_request import UserPasswordSetRequest
from app.models.user_model import User
from app.models.role import Role
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.services.user_application_service import create_application_for_user
from app.utils.feature_flags import get_flags_for_role
from app.core.config import (
    AUTHENTIK_HOST_URL, AUTHENTIK_API_TOKEN, ADMIN_REGISTRATION_KEY,
    CLIENT_ID, CLIENT_SECRET, AUTHENTIK_TOKEN_URL,
)
from authentik_client.configuration import Configuration
from authentik_client.api_client import ApiClient

logger = logging.getLogger(__name__)

# HS256 kept ONLY for QR mobile tokens and seeded-user fallback
_JWT_SECRET = os.getenv("JWT_SECRET", "haidoc-dev-secret-change-in-production")
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

_AUTHENTIK_SCOPE = "openid profile haidoc_role offline_access"


def get_authentik_client() -> ApiClient:
    config = Configuration(host=AUTHENTIK_HOST_URL, access_token=AUTHENTIK_API_TOKEN)
    return ApiClient(config)


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _verify_admin_key(provided: str | None) -> bool:
    if not ADMIN_REGISTRATION_KEY:
        return False
    if not provided:
        return False
    return hmac.compare_digest(ADMIN_REGISTRATION_KEY.encode(), provided.encode())


def _issue_jwt(user: User) -> dict:
    """HS256 — used ONLY for QR mobile tokens and seeded-user fallback when Authentik is down."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.uniqueId),
        "user_id": user.userId,
        "username": user.username,
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(hours=_JWT_EXPIRE_HOURS),
    }
    token = jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)
    
   
    refresh_payload = {
        "sub": str(user.uniqueId),
        "type": "refresh",
        "iat": now,
        "exp": now + timedelta(days=7),
    }
    refresh_token = jwt.encode(refresh_payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)
    
    return {
        "access_token": token,
        "refresh_token": refresh_token,
        "token_type": "Bearer",
        "expires_in": _JWT_EXPIRE_HOURS * 3600,
    }


def _authentik_ropc(username: str, password: str) -> tuple[str, dict | str | None]:
    """
    POST username/password to Authentik ROPC endpoint.
    
    Returns:
        ("success", token_dict) — user authenticated via Authentik
        ("rejected", reason_str) — Authentik explicitly rejected (401, 403, etc.)
        ("unavailable", reason_str) — Authentik unreachable (network error, timeout)
        ("fallback", None) — Authentik not configured; fallback allowed
    
    SECURITY: Distinguishes between rejection (never fall back) and unavailability (allow seeded users).
    """
    if not CLIENT_ID or not AUTHENTIK_TOKEN_URL:
        # Authentik not configured — allow fallback for seeded users
        logger.debug("Authentik not configured for user=%s — fallback allowed", username)
        return ("fallback", None)
    
    try:
        r = _requests.post(
            AUTHENTIK_TOKEN_URL,
            data={
                "grant_type": "password",
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "username": username,
                "password": password,
                "scope": _AUTHENTIK_SCOPE,
            },
            timeout=10,
        )
        if r.status_code == 200:
            data = r.json()
            logger.info("Authentik ROPC success for user=%s", username)
            return ("success", {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token"),
                "token_type": "Bearer",
                "expires_in": data.get("expires_in", 3600),
            })
        
        if r.status_code in [500, 502, 503, 504]:
            reason = f"Authentik {r.status_code}: {r.text[:200]}"
            logger.error("Authentik server error for user=%s: %s", username, reason)
            return ("unavailable", f"Authentik server error: {r.status_code}")
            
        # Authentik explicitly rejected the user (401, 403, 429, etc.)
        # NEVER fall back in this case
        reason = f"Authentik {r.status_code}: {r.text[:200]}"
        logger.warning("Authentik rejected user=%s: %s", username, reason)
        return ("rejected", reason)
        
    except _requests.Timeout:
        # Network timeout — could be temporary (e.g., Authentik overloaded)
        logger.error("Authentik ROPC timeout for user=%s", username)
        return ("unavailable", "Authentik timeout")
    except _requests.ConnectionError as e:
        # Cannot reach Authentik (e.g., service down, network partition)
        logger.error("Authentik unreachable for user=%s: %s", username, e)
        return ("unavailable", f"Authentik unreachable: {e}")
    except Exception as e:
        # Unexpected error (e.g., JSON decode error)
        logger.error("Authentik ROPC error for user=%s: %s", username, e)
        return ("unavailable", str(e))


def login_user(username: str, password: str, db: Session) -> dict:
    """
    Authenticate user. Tries Authentik first; falls back to local DB ONLY for seeded users
    if the feature flag 'allow_local_fallback' is enabled.
    
    SECURITY:
    - If Authentik explicitly rejects (401, 403, etc.), NEVER fall back.
    - If Authentik is unavailable AND allow_local_fallback flag is enabled, 
      only allow seeded users (authentik_id=None).
    - Regular users (authentik_id != None) cannot log in if Authentik is down.
    - If allow_local_fallback is disabled, any Authentik failure blocks login.
    
    Args:
        username: Username to authenticate
        password: Password to verify
        db: Database session
        
    Returns:
        dict with access_token, refresh_token, token_type, expires_in
        
    Raises:
        HTTPException: 401 (invalid creds), 403 (disabled), 503 (Authentik down)
    """
    status_code, result = _authentik_ropc(username, password)
    
    if status_code == "success":
        # User authenticated via Authentik
        logger.info("User %s authenticated via Authentik", username)
        return result
    
    if status_code == "rejected":
        # Authentik explicitly said no (MFA required, account suspended, rate limited, etc.)
        # NEVER fall back to local DB — this is a security decision by Authentik
        logger.warning("Authentik rejected user=%s (do not fall back): %s", username, result)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed. Check your credentials or contact your administrator."
        )
    
    if status_code == "unavailable":
        # Authentik is temporarily down (timeout, network error, etc.)
        # First, find the user to get their role
        user = db.query(User).filter(
            func.lower(User.username) == username.lower()
        ).first()
        
        if not user:
            # User doesn't exist in DB
            logger.warning("User %s not found in DB; cannot authenticate when Authentik is down", username)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service temporarily unavailable. Please try again later."
            )
        
        # Check if this is a seeded user (authentik_id=None)
        if user.authentik_id is not None:
            # Regular user (Authentik-managed) — cannot log in without Authentik
            logger.error("User %s is Authentik-managed; cannot log in without Authentik", username)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service temporarily unavailable. Please try again later."
            )
        
        # This is a seeded user (authentik_id=None)
        # Check if fallback is allowed for this user's role
        user_role = user.role or "user"
        flags_for_role = get_flags_for_role(user_role)
        fallback_allowed = "allow_local_fallback" in flags_for_role
        
        logger.warning("Authentik unavailable for seeded user=%s (role=%s, fallback_allowed=%s)", 
                      username, user_role, fallback_allowed)
        
        if not fallback_allowed:
            # Fallback disabled for this role — block login
            logger.error("User %s cannot log in: Authentik unavailable and fallback not allowed for role=%s", 
                        username, user_role)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service temporarily unavailable. Please try again later."
            )
        
        # Fallback is allowed — verify password
        logger.info("Allowing seeded user %s to log in via local fallback (Authentik unavailable)", username)
        
        if not user.password_hash or not _verify_password(password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        if not user.isActive:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled"
            )
        return _issue_jwt(user)
    
    if status_code == "fallback":
        # Authentik not configured (dev/test environment)
        # Allow any local user to log in
        logger.debug("Authentik not configured; using local DB for user=%s", username)
        
        user = db.query(User).filter(
            func.lower(User.username) == username.lower()
        ).first()
        
        if not user or not user.password_hash or not _verify_password(password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        if not user.isActive:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled"
            )
        return _issue_jwt(user)


def _register_in_authentik(request) -> tuple[int | None, str | None, str | None]:
    """Try to create user in Authentik. Returns (pk, uuid_str, username) or (None, None, None)."""
    try:
        client = get_authentik_client()
        core_api = CoreApi(client)
        ak_user = core_api.core_users_create(
            UserRequest(
                username=request.username,
                email=request.email,
                name=request.full_name or request.username,
                is_active=True,
                attributes={"role": request.role},
            )
        )
        core_api.core_users_set_password_create(
            id=ak_user.pk,
            user_password_set_request=UserPasswordSetRequest(password=request.password),
        )
        return ak_user.pk, str(ak_user.uuid), ak_user.username
    except Exception:
        logger.warning("Authentik unavailable during registration for %s — using local fallback", request.username)
        return None, None, None


def register_user(request, db: Session, app_db: Session | None = None):
    try:
        if db.query(User).filter(func.lower(User.username) == request.username.lower()).first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Username '{request.username}' already exists.",
            )

        if request.role == "admin":
            if not getattr(request, "registration_key", None) or not _verify_admin_key(request.registration_key):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid or missing registration key for admin registration.",
                )
        elif app_db is not None:
            role_obj = app_db.query(Role).filter(Role.name == request.role).first()
            if not role_obj:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Role '{request.role}' does not exist.",
                )
            if not role_obj.is_registerable:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Role '{request.role}' cannot be self-registered.",
                )
        else:
            if request.role in ("admin", "superadmin"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Role '{request.role}' cannot be self-registered.",
                )

        import uuid as _uuid
        ak_pk, ak_uuid, ak_username = _register_in_authentik(request)

        # Local fallback: generate IDs if Authentik was unreachable
        local_uuid = ak_uuid or str(_uuid.uuid4())
        # Use a large negative int as userId when Authentik didn't assign one
        local_user_id = ak_pk if ak_pk is not None else (
            -(abs(hash(local_uuid)) % (10 ** 9))
        )

        user = User(
            userId=local_user_id,
            uniqueId=local_uuid,
            username=request.username.lower(),
            isActive=True,
            password_hash=_hash_password(request.password),
            role=request.role,
            authentik_id=ak_pk,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        if ak_pk is not None:
            try:
                create_application_for_user(user.userId)
            except Exception:
                logger.warning("Could not create Authentik application for user %s", user.userId)

        return {
            "message": "User registered successfully",
            "user_id": user.userId,
            "username": user.username,
            "unique_id": user.uniqueId,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Unexpected error during registration for username=%s", request.username)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration failed: {e}",
        )


# ── Seeded users ───────────────────────────────────────────────────────────────

_SEED_ADMIN_USERNAME = "admin"
_SEED_ADMIN_PASSWORD = os.getenv("SEED_ADMIN_PASSWORD", "12345678")
_SEED_SUPERADMIN_USERNAME = "superadmin"
_SEED_SUPERADMIN_PASSWORD = os.getenv("SEED_SUPERADMIN_PASSWORD", "superadmin123")
_SEED_ADMIN_USER_ID = 0
_SEED_ADMIN_UNIQUE_ID = "00000000-0000-0000-0000-000000000001"
_SEED_SUPERADMIN_USER_ID = -1
_SEED_SUPERADMIN_UNIQUE_ID = "00000000-0000-0000-0000-000000000002"


def _seed_user_in_authentik(username: str, password: str, role: str, email: str) -> tuple[int | None, str | None]:
    """Create user in Authentik. Returns (pk, uuid_str) or (None, None) on failure."""
    try:
        client = get_authentik_client()
        core_api = CoreApi(client)
        # Check if user already exists
        existing = core_api.core_users_list(username=username)
        if existing.results:
            u = existing.results[0]
            return u.pk, str(u.uuid)
        ak_user = core_api.core_users_create(UserRequest(
            username=username,
            email=email,
            name=username.capitalize(),
            is_active=True,
            attributes={"role": role},
        ))
        core_api.core_users_set_password_create(
            id=ak_user.pk,
            user_password_set_request=UserPasswordSetRequest(password=password),
        )
        return ak_user.pk, str(ak_user.uuid)
    except Exception:
        logger.warning("Could not create %s in Authentik — local fallback will be used", username)
        return None, None


def seed_roles(app_db: Session) -> None:
    system_roles = [
        {"name": "superadmin", "label": "Super Admin",
         "description": "Full system access.", "is_system": True, "is_registerable": False},
        {"name": "admin", "label": "Admin",
         "description": "Administrative access.", "is_system": True, "is_registerable": False},
        {"name": "user", "label": "User",
         "description": "Standard user access.", "is_system": True, "is_registerable": True},
    ]
    for r in system_roles:
        if not app_db.query(Role).filter(Role.name == r["name"]).first():
            app_db.add(Role(**r))
    try:
        app_db.commit()
        logger.info("System roles seeded")
    except Exception:
        app_db.rollback()
        logger.warning("Role seeding failed (may already exist)")


def seed_admin_user(db: Session) -> None:
    if db.query(User).filter(User.username == _SEED_ADMIN_USERNAME).first():
        return
    ak_pk, ak_uuid = _seed_user_in_authentik(
        _SEED_ADMIN_USERNAME, _SEED_ADMIN_PASSWORD, "admin", "admin@haidoc.local"
    )
    admin = User(
        userId=ak_pk or _SEED_ADMIN_USER_ID,
        uniqueId=ak_uuid or _SEED_ADMIN_UNIQUE_ID,
        username=_SEED_ADMIN_USERNAME,
        isActive=True,
        password_hash=_hash_password(_SEED_ADMIN_PASSWORD),
        role="admin",
        authentik_id=ak_pk,
    )
    db.add(admin)
    db.commit()
    logger.info("Seeded default admin user '%s'", _SEED_ADMIN_USERNAME)


def seed_superadmin_user(db: Session) -> None:
    if db.query(User).filter(User.username == _SEED_SUPERADMIN_USERNAME).first():
        return
    ak_pk, ak_uuid = _seed_user_in_authentik(
        _SEED_SUPERADMIN_USERNAME, _SEED_SUPERADMIN_PASSWORD, "superadmin", "superadmin@haidoc.local"
    )
    superadmin = User(
        userId=ak_pk or _SEED_SUPERADMIN_USER_ID,
        uniqueId=ak_uuid or _SEED_SUPERADMIN_UNIQUE_ID,
        username=_SEED_SUPERADMIN_USERNAME,
        isActive=True,
        password_hash=_hash_password(_SEED_SUPERADMIN_PASSWORD),
        role="superadmin",
        authentik_id=ak_pk,
    )
    db.add(superadmin)
    db.commit()
    logger.info("Seeded default superadmin user '%s'", _SEED_SUPERADMIN_USERNAME)


# ── Authentik property mapping setup ──────────────────────────────────────────

def setup_role_claim_mapping() -> None:
    """
    Idempotent: ensure Authentik has a scope property mapping that injects
    'role' and 'username' into RS256 tokens. Bound to scope 'haidoc_role'.
    Called on orchestrator startup — safe to fail if Authentik not yet up.
    """
    if not AUTHENTIK_API_TOKEN or not AUTHENTIK_HOST_URL:
        return
    headers = {
        "Authorization": f"Bearer {AUTHENTIK_API_TOKEN}",
        "Content-Type": "application/json",
    }
    base = AUTHENTIK_HOST_URL  # e.g. http://server:9000/api/v3

    try:
        # 1. Find or create the scope property mapping
        r = _requests.get(
            f"{base}/propertymappings/scope/",
            headers=headers,
            params={"scope_name": "haidoc_role"},
            timeout=10,
        )
        results = r.json().get("results", [])

        if results:
            mapping_pk = results[0]["pk"]
            logger.info("Authentik: haidoc_role property mapping already exists (pk=%s)", mapping_pk)
        else:
            cr = _requests.post(
                f"{base}/propertymappings/scope/",
                headers=headers,
                json={
                    "name": "haidoc-role-claim",
                    "scope_name": "haidoc_role",
                    "description": "Injects haidoc RBAC role and username into JWT tokens",
                    "expression": (
                        "return {\n"
                        "    'role': user.attributes.get('role', 'user'),\n"
                        "    'username': user.username,\n"
                        "}"
                    ),
                },
                timeout=10,
            )
            cr.raise_for_status()
            mapping_pk = cr.json()["pk"]
            logger.info("Authentik: created haidoc_role property mapping (pk=%s)", mapping_pk)

        # 2. Find provider via application slug "haidoc"
        app_r = _requests.get(f"{base}/core/applications/haidoc/", headers=headers, timeout=10)
        if app_r.status_code != 200:
            logger.warning("Authentik: could not find 'haidoc' application — skipping mapping bind")
            return
        provider_id = app_r.json().get("provider")
        if not provider_id:
            logger.warning("Authentik: 'haidoc' application has no provider")
            return

        # 3. Patch provider to include our mapping
        prov_r = _requests.get(f"{base}/providers/oauth2/{provider_id}/", headers=headers, timeout=10)
        prov_r.raise_for_status()
        current = prov_r.json().get("property_mappings", [])
        if mapping_pk in current:
            logger.info("Authentik: haidoc_role mapping already bound to provider %s", provider_id)
            return
        patch_r = _requests.patch(
            f"{base}/providers/oauth2/{provider_id}/",
            headers=headers,
            json={"property_mappings": current + [mapping_pk]},
            timeout=10,
        )
        patch_r.raise_for_status()
        logger.info("Authentik: bound haidoc_role mapping to provider %s", provider_id)

    except Exception:
        logger.warning("Authentik role claim mapping setup failed — tokens may lack 'role' claim")
