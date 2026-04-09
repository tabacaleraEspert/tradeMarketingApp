"""CRUD operation tests."""
import bcrypt


def test_create_zone(client):
    resp = client.post("/zones", json={"Name": "Test Zone"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["Name"] == "Test Zone"
    assert data["ZoneId"] > 0


def test_create_channel(client):
    resp = client.post("/channels", json={"Name": "Test Channel"})
    assert resp.status_code == 201
    assert resp.json()["Name"] == "Test Channel"


def test_create_user_and_login(client):
    hashed = bcrypt.hashpw("Test123!".encode(), bcrypt.gensalt()).decode()
    resp = client.post("/users", json={
        "Email": "test@test.com",
        "DisplayName": "Test User",
        "Password": "Test123!",
    })
    assert resp.status_code == 201
    user = resp.json()
    assert user["Email"] == "test@test.com"

    # Login
    resp = client.post("/auth/login", json={"email": "test@test.com", "password": "Test123!"})
    assert resp.status_code == 200
    assert resp.json()["Email"] == "test@test.com"


def test_create_pdv(client):
    # Need a channel first
    ch = client.post("/channels", json={"Name": "Kiosco Test"}).json()

    resp = client.post("/pdvs", json={
        "Name": "PDV Test",
        "ChannelId": ch["ChannelId"],
        "Address": "Test 123",
        "IsActive": True,
    })
    assert resp.status_code == 201
    pdv = resp.json()
    assert pdv["Name"] == "PDV Test"
    assert pdv["PdvId"] > 0

    # Read
    resp = client.get(f"/pdvs/{pdv['PdvId']}")
    assert resp.status_code == 200
    assert resp.json()["Name"] == "PDV Test"

    # Update
    resp = client.patch(f"/pdvs/{pdv['PdvId']}", json={"Name": "PDV Updated"})
    assert resp.status_code == 200
    assert resp.json()["Name"] == "PDV Updated"


def test_create_route_with_pdvs(client):
    resp = client.post("/routes", json={"Name": "Test Route", "IsActive": True})
    assert resp.status_code == 201
    route = resp.json()

    # Add PDV (need one)
    ch = client.post("/channels", json={"Name": "Ch for Route"}).json()
    pdv = client.post("/pdvs", json={"Name": "PDV for Route", "ChannelId": ch["ChannelId"]}).json()

    resp = client.post(f"/routes/{route['RouteId']}/pdvs", json={
        "PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3,
    })
    assert resp.status_code == 201

    # List PDVs
    resp = client.get(f"/routes/{route['RouteId']}/pdvs")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_create_visit(client):
    # Setup
    ch = client.post("/channels", json={"Name": "Ch Visit"}).json()
    pdv = client.post("/pdvs", json={"Name": "PDV Visit", "ChannelId": ch["ChannelId"]}).json()
    user = client.post("/users", json={"Email": "visitor@test.com", "DisplayName": "Visitor", "Password": "Pass123!"}).json()

    resp = client.post("/visits", json={
        "PdvId": pdv["PdvId"],
        "UserId": user["UserId"],
        "Status": "OPEN",
    })
    assert resp.status_code == 201
    visit = resp.json()
    assert visit["Status"] == "OPEN"

    # Close
    resp = client.patch(f"/visits/{visit['VisitId']}", json={"Status": "CLOSED"})
    assert resp.status_code == 200
    assert resp.json()["Status"] == "CLOSED"


def test_reports_endpoints(client):
    """All report endpoints should return 200."""
    for endpoint in ["/reports/summary", "/reports/vendor-ranking", "/reports/channel-coverage", "/reports/perfect-store", "/reports/smart-alerts"]:
        resp = client.get(endpoint)
        assert resp.status_code == 200, f"{endpoint} failed with {resp.status_code}"

    resp = client.get("/reports/trending", params={"months": 3})
    assert resp.status_code == 200
