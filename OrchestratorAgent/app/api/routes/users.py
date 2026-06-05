import os
import time
import uuid
import requests as _requests
from fastapi import APIRouter, Request, Response, Cookie, status, HTTPException, Depends
from pydantic import BaseModel
from jose import jwt as jose_jwt
from app.core.limiter import limiter
from app.services.auth_service import register_user, login_user
from app.schemas.register import RegisterRequest
from app.schemas.token import TokenRequest
from app.services.user_application_service import create_application_for_user
from app.services.user_application_service import get_user_client_credentials
from app.services.authentik_service import extract_user_from_token
from app.core.database import get_db
from app.core.app_database import get_app_db
from app.core.auth import get_current_user, require_admin
from app.models.role import Role
from app.models.user_model import User
from app.services.auth_service import _hash_password
from app.utils.redis_client import get_redis
from app.services.audit_service import log_audit
from app.services.login_limiter import check_ip, check_user_failures, record_user_failure, clear_user_failures
from app.core.config import CLIENT_ID, CLIENT_SECRET, AUTHENTIK_TOKEN_URL, AUTHENTIK_REVOKE_URL
from sqlalchemy.orm import Session
from pydantic import EmailStr

_JWT_SECRET = os.getenv("JWT_SECRET", "haidoc-dev-secret-change-in-production")
_JWT_ALGORITHM = "HS256"
_MOBILE_JWT_TTL = 60 * 60 * 24 * 7   # 7 days for mobile sessions
_QR_TTL = 300                          # 5 minutes

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.get("/roles", tags=["auth"])
def get_registerable_roles(app_db: Session = Depends(get_app_db)):
    """Public endpoint — returns roles available in the registration dropdown."""
    roles = (
        app_db.query(Role)
        .filter(Role.is_registerable.is_(True))
        .order_by(Role.name)
        .all()
    )
    return [{"name": r.name, "label": r.label, "description": r.description} for r in roles]


@router.post("/register", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(
    request: Request,
    body: RegisterRequest,
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    return register_user(body, db, app_db=app_db)


@router.post("/login")
async def login(
    request: Request,
    response: Response,
    body: LoginRequest,
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    ip = request.client.host if request.client else "unknown"
    r = await get_redis()
    await check_ip(r, ip)
    await check_user_failures(r, body.username)
    try:
        result = login_user(body.username, body.password, db)
        await clear_user_failures(r, body.username)
        
        
        refresh_token = result.get("refresh_token")
        if refresh_token:
            response.set_cookie(
                key="haidoc_refresh_token",
                value=refresh_token,
                httponly=True,
                secure=False,  
                samesite="lax",
                max_age=7 * 24 * 3600,
                path="/"
            )
            
        return {
            "access_token": result["access_token"],
            "token_type": result.get("token_type", "Bearer"),
            "expires_in": result.get("expires_in", 3600),
        }
    except HTTPException as exc:
        await record_user_failure(r, body.username)
        log_audit(
            app_db,
            actor_type="system",
            action="auth.login_failed",
            resource=f"user:{body.username}",
            ip_address=ip,
            detail={"reason": exc.detail},
        )
        raise


@router.post("/{user_id}/application")
def create_user_application(user_id: int):
    return create_application_for_user(user_id)


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


@router.post("/refresh")
@limiter.limit("30/minute")
def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    haidoc_refresh_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db)
):
    """Exchange a refresh token (from Cookie or JSON body) for a new access_token + rotated refresh_token."""
    token = None
    if body and body.refresh_token:
        token = body.refresh_token
    elif haidoc_refresh_token:
        token = haidoc_refresh_token

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh failed — please log in again"
        )

   
    try:
        from jose import jwt, JWTError
        payload = jwt.decode(token, _JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") == "refresh":
            unique_id = payload.get("sub")
            user = db.query(User).filter(User.uniqueId == unique_id).first()
            if not user or not user.isActive:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User inactive or not found"
                )
            
            
            from app.services.auth_service import _issue_jwt
            result = _issue_jwt(user)
            
            
            new_refresh = result.get("refresh_token")
            if new_refresh:
                response.set_cookie(
                    key="haidoc_refresh_token",
                    value=new_refresh,
                    httponly=True,
                    secure=False,
                    samesite="lax",
                    max_age=7 * 24 * 3600,
                    path="/"
                )
            return {
                "access_token": result["access_token"],
                "token_type": "Bearer",
                "expires_in": result.get("expires_in", 3600),
            }
    except JWTError:
        
        pass

    
    if not CLIENT_ID or not AUTHENTIK_TOKEN_URL:
        raise HTTPException(status_code=501, detail="Token refresh not configured")
    r = _requests.post(
        AUTHENTIK_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": token,
        },
        timeout=10,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Refresh failed — please log in again")
    data = r.json()
    
    
    new_refresh = data.get("refresh_token")
    if new_refresh:
        response.set_cookie(
            key="haidoc_refresh_token",
            value=new_refresh,
            httponly=True,
            secure=False,
            samesite="lax",
            max_age=7 * 24 * 3600,
            path="/"
        )

    return {
        "access_token": data["access_token"],
        "token_type": "Bearer",
        "expires_in": data.get("expires_in", 3600),
    }


@router.post("/logout")
def logout(
    response: Response,
    body: LogoutRequest | None = None,
    haidoc_refresh_token: str | None = Cookie(default=None)
):
    """Revoke the refresh token at Authentik and clear the HttpOnly cookie. Best-effort — always returns 200."""
    token = None
    if body and body.refresh_token:
        token = body.refresh_token
    elif haidoc_refresh_token:
        token = haidoc_refresh_token

    if token and AUTHENTIK_REVOKE_URL and CLIENT_ID:
        try:
            _requests.post(
                AUTHENTIK_REVOKE_URL,
                data={
                    "client_id": CLIENT_ID,
                    "client_secret": CLIENT_SECRET,
                    "token": token,
                },
                timeout=5,
            )
        except Exception:
            pass

    response.delete_cookie(key="haidoc_refresh_token", path="/")
    return {"message": "Logged out"}


@router.post("/client-credentials")
def fetch_client_credentials(request: TokenRequest, db: Session = Depends(get_db)):
    try:
        user_id = extract_user_from_token(request.access_token, db)
        return get_user_client_credentials(user_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── QR Mobile Login ──────────────────────────────────────────────────────────

class QrTokenResponse(BaseModel):
    token: str
    expires_in: int


class QrExchangeRequest(BaseModel):
    token: str


@router.post("/qr-token", response_model=QrTokenResponse)
async def generate_qr_token(user: dict = Depends(get_current_user)):
    """
    Generate a one-time QR login token for the mobile app.
    Valid 5 minutes. Requires an authenticated web session.
    Mobile scans QR → calls /auth/qr-exchange → receives 7-day mobile JWT.
    """
    session_id = str(uuid.uuid4())
    username = user.get("username") or user.get("preferred_username") or ""
    role = user.get("role", "user")

    # Issue a long-lived mobile JWT (7 days)
    mobile_jwt = jose_jwt.encode(
        {
            "sub": user.get("sub"),
            "username": username,
            "role": role,
            "source": "mobile",
            "iat": int(time.time()),
            "exp": int(time.time()) + _MOBILE_JWT_TTL,
        },
        _JWT_SECRET,
        algorithm=_JWT_ALGORITHM,
    )

    r = await get_redis()
    await r.hset(f"qr:{session_id}", mapping={
        "jwt": mobile_jwt,
        "username": username,
        "role": role,
    })
    await r.expire(f"qr:{session_id}", _QR_TTL)

    return {"token": session_id, "expires_in": _QR_TTL}


class AdminCreateUserRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: str | None = None
    role: str = "user"


@router.post("/admin/users", status_code=status.HTTP_201_CREATED)
def admin_create_user(
    request: Request,
    body: AdminCreateUserRequest,
    caller: dict = Depends(require_admin),
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """Admin-only: create a user with any role, bypassing self-registration restrictions."""
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    # Validate role exists
    role_obj = app_db.query(Role).filter(Role.name == body.role).first()
    if not role_obj:
        raise HTTPException(status_code=400, detail=f"Role '{body.role}' does not exist.")

    # Only superadmin can create admin/superadmin users
    caller_role = caller.get("role", "user")
    if body.role in ("admin", "superadmin") and caller_role != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmin can create admin users.")

    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Username already taken.")

    import uuid as _uuid
    new_user = User(
        userId=int(_uuid.uuid4().int >> 96),
        uniqueId=str(_uuid.uuid4()),
        username=body.username,
        isActive=True,
        password_hash=_hash_password(body.password),
        role=body.role,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    log_audit(
        app_db,
        actor_type="user",
        action="user.create",
        resource=f"user:{new_user.username}",
        user_id=caller.get("username"),
        ip_address=request.client.host if request.client else None,
        detail={"role": body.role},
    )
    return {"user_id": new_user.userId, "username": new_user.username, "role": new_user.role}


@router.post("/qr-exchange")
async def exchange_qr_token(body: QrExchangeRequest):
    """
    Exchange a one-time QR token for mobile credentials.
    No auth required — the token itself is the proof.
    Token is deleted after first use (one-time).
    """
    r = await get_redis()
    key = f"qr:{body.token}"
    data = await r.hgetall(key)
    if not data:
        raise HTTPException(status_code=404, detail="QR token expired or already used")
    await r.delete(key)
    return {
        "jwt": data.get("jwt"),
        "username": data.get("username"),
        "role": data.get("role"),
    }
