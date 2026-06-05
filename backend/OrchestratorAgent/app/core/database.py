from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import URL_DATABASE



engine = create_engine(URL_DATABASE)

SessionLocal = sessionmaker(autocommit=False,autoflush=False,bind=engine)


def get_db():
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()