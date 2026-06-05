from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str | None = None
    # Role must be a registerable role — validated against roles table in auth_service
    role: str = "user"
    registration_key: str | None = None
