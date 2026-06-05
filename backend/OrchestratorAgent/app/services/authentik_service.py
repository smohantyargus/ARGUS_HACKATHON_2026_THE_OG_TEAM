from jose import jwt
import requests
from app.core.config import AUTHENTIK_API_TOKEN, AUTHENTIK_JWKS_URL
from app.models.user_model import User
from sqlalchemy.orm import Session
from fastapi import HTTPException,status

HEADERS = {
    "Authorization": f"Bearer {AUTHENTIK_API_TOKEN}",
    "Content-Type": "application/json",
}

def extract_user_from_token(token: str,db: Session):
    jwks = requests.get(AUTHENTIK_JWKS_URL).json()
    claims = jwt.decode(
        token,
        jwks,
        algorithms=["RS256"],
        options={
            "verify_aud": False,
        },

    )
    user=db.query(User).filter_by(username=claims.get("preferred_username"),isActive=True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in db")


    return user.userId
