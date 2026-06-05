"""
Read-mostly sync engine for the civic domain tables.

Same sync SQLAlchemy pattern as OrchestratorAgent app_database.py. Point
QUERY_DB_URL at a read-only role (e.g. civis_ro) in production for defense in
depth; the named-query whitelist is the primary guard either way.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

QUERY_DB_URL = os.getenv("QUERY_DB_URL")

engine = create_engine(QUERY_DB_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
