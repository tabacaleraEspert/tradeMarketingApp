from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import settings

_db_url = settings.resolved_database_url
_is_sqlite = "sqlite" in _db_url
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

# Pool config:
#   SQLite no soporta pool real (usa StaticPool internamente).
#   Para Azure SQL con 40 usuarios concurrentes:
#     - pool_size=15:     conexiones permanentes listas para usar
#     - max_overflow=10:  hasta 10 más en picos (total 25)
#     - pool_pre_ping:    verifica que la conexión siga viva antes de usarla
#                         (Azure SQL mata conexiones idle después de ~30min)
#     - pool_recycle=1800: recicla conexiones cada 30min para evitar stale connections
_pool_kwargs = {} if _is_sqlite else {
    "pool_size": 15,
    "max_overflow": 10,
    "pool_pre_ping": True,
    "pool_recycle": 1800,
}

engine = create_engine(
    _db_url,
    echo=False,
    connect_args=_connect_args,
    **_pool_kwargs,
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
