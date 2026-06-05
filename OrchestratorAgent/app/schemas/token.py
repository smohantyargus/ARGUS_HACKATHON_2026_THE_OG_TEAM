from pydantic import BaseModel

class TokenRequest(BaseModel):
    access_token: str