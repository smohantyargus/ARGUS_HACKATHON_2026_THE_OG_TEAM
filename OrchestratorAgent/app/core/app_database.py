import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

load_dotenv()

APP_DATABASE_URL = os.getenv("APP_DATABASE_URL")

app_engine = create_engine(APP_DATABASE_URL)
AppSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=app_engine)


class AppBase(DeclarativeBase):
    pass


def get_app_db():
    db = AppSessionLocal()
    try:
        yield db
    finally:
        db.close()
