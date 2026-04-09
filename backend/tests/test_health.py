"""Basic health and smoke tests."""


def test_root_docs(client):
    """FastAPI docs should be accessible."""
    resp = client.get("/docs")
    assert resp.status_code == 200


def test_zones_empty(client):
    """Zones endpoint returns list."""
    resp = client.get("/zones")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_pdvs_empty(client):
    """PDVs endpoint returns list."""
    resp = client.get("/pdvs")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_routes_empty(client):
    """Routes endpoint returns list."""
    resp = client.get("/routes")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_channels_empty(client):
    """Channels endpoint returns list."""
    resp = client.get("/channels")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_reports_summary(client):
    """Reports summary returns expected structure."""
    resp = client.get("/reports/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert "totalVisits" in data
    assert "coverage" in data
    assert "avgDurationMin" in data
