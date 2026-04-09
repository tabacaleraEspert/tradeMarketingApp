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

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c
