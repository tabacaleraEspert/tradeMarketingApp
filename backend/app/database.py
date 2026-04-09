from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import settings

_db_url = settings.resolved_database_url
_connect_args = {"check_same_thread": False} if "sqlite" in _db_url else {}

engine = create_engine(
    _db_url,
    echo=False,
    connect_args=_connect_args,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def override_engine(new_engine):
    """Override engine and SessionLocal for testing."""
    global engine, SessionLocal
    engine = new_engine
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=new_engine)
