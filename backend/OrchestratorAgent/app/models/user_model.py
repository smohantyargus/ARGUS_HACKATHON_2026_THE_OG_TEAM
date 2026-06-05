from sqlalchemy import Column, Integer, String, Boolean, DateTime, func
from .base import Base


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, index=True)
    userId = Column(Integer, unique=True, index=True,nullable=False)
    username = Column(String ,unique=True, nullable=False)
    uniqueId=Column(String,unique=True, index=True, nullable=False)
    createdAt=Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt=Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    isActive=Column(Boolean, nullable=False)
    password_hash=Column(String, nullable=True)
    role=Column(String(20), nullable=False, server_default="user")
    authentik_id=Column(Integer, nullable=True)

    