"""Test config — uses a temp SQLite file for test isolation."""
import os
import tempfile

# Create temp DB file BEFORE any app imports
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"
os.environ["USE_SQLITE"] = "false"
os.environ["DATABASE_USER"] = ""
os.environ["DATABASE_PASSWORD"] = ""

import bcrypt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.main import app
from app.database import engine, Base, get_db
from app.models import User as UserModel, Role as RoleModel, UserRole as UserRoleModel
from app.auth import create_access_token

# ------------------------------------------------------------------
# Admin seed constants
# ------------------------------------------------------------------
ADMIN_EMAIL = "admin@test.com"
ADMIN_PASSWORD = "Admin123!"


def _seed_admin(db: Session) -> UserModel:
    """Create the admin user + role if not already present."""
    user = db.query(UserModel).filter(UserModel.Email == ADMIN_EMAIL).first()
    if not user:
        hashed = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
        user = UserModel(
            Email=ADMIN_EMAIL,
            DisplayName="Test Admin",
            PasswordHash=hashed,
            IsActive=True,
        )
        db.add(user)
        db.flush()

    role = db.query(RoleModel).filter(RoleModel.Name == "admin").first()
    if not role:
        role = RoleModel(Name="admin")
        db.add(role)
        db.flush()

    ur = db.query(UserRoleModel).filter(UserRoleModel.UserId == user.UserId).first()
    if not ur:
        db.add(UserRoleModel(UserId=user.UserId, RoleId=role.RoleId))

    db.commit()
    db.refresh(user)
    return user


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture(scope="session")
def _db_session():
    """Session-scoped DB session used only for seeding."""
    Base.metadata.create_all(bind=engine)
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="session")
def admin_user(_db_session):
    """The seeded admin user (session-scoped — created once)."""
    return _seed_admin(_db_session)


@pytest.fixture(scope="session")
def admin_token(admin_user):
    """A valid JWT access token for the admin user (session-scoped)."""
    return create_access_token(subject=admin_user.UserId, role="admin")


@pytest.fixture()
def client(admin_user):
    """
    TestClient pre-configured with an admin Authorization header.

    All tests that call endpoints via `client` will be authenticated
    as admin (the highest-privilege role), which is the correct approach
    for integration tests that need to seed data freely.

    For role-specific tests (e.g. 'vendedor cannot delete'), create
    a subordinate user and call endpoints with their token explicitly.
    """
    # Re-generate token each test (short TTL doesn't matter here; admin_user
    # is session-scoped so UserId is stable across the session).
    token = create_access_token(subject=admin_user.UserId, role="admin")
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app, headers=headers) as c:
        yield c
