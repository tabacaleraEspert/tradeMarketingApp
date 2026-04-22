"""Route management tests.

Strategy: `client` fixture is admin-authenticated. All data creation (channels,
PDVs, users, routes) goes through the admin client directly. Role-specific
assertions use explicit per-request token overrides.

Covers:
- Create, read, update, list routes
- Add / remove PDVs from route (PDV exclusivity enforcement)
- Assign forms to route (list, remove)
- AssignedUser propagation to PDVs
- Route days (create, get, list, delete)
- /routes/bejerman-zones and /routes/pdv-assignments
- /routes/map-overview
"""
import uuid
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uid():
    return uuid.uuid4().hex[:8]


def _make_user(client):
    email = f"route_u_{_uid()}@test.com"
    resp = client.post("/users", json={"Email": email, "DisplayName": email, "Password": "Pass123!"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _login(client, email, password="Pass123!"):
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _make_channel(client):
    resp = client.post("/channels", json={"Name": f"RteCh_{_uid()}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_pdv(client, channel_id, name=None):
    name = name or f"RtePDV_{_uid()}"
    resp = client.post("/pdvs", json={"Name": name, "ChannelId": channel_id, "IsActive": True})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_route(client, name=None, is_active=True, assigned_user_id=None):
    name = name or f"Route_{_uid()}"
    payload = {"Name": name, "IsActive": is_active}
    if assigned_user_id is not None:
        payload["AssignedUserId"] = assigned_user_id
    resp = client.post("/routes", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_form(client, name=None):
    name = name or f"Form_{_uid()}"
    resp = client.post("/forms", json={"Name": name, "IsActive": True, "Version": 1})
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture()
def channel(client):
    return _make_channel(client)


@pytest.fixture()
def pdv(client, channel):
    return _make_pdv(client, channel["ChannelId"])


@pytest.fixture()
def user(client):
    return _make_user(client)


@pytest.fixture()
def route(client):
    return _make_route(client)


# ---------------------------------------------------------------------------
# Route CRUD
# ---------------------------------------------------------------------------

class TestRouteCRUD:
    def test_create_route_minimal(self, client):
        r = _make_route(client, "Minimal Route")
        assert r["RouteId"] > 0
        assert r["Name"] == "Minimal Route"
        assert r["IsActive"] is True

    def test_create_route_inactive(self, client):
        r = _make_route(client, is_active=False)
        assert r["IsActive"] is False

    def test_get_route_by_id(self, client, route):
        resp = client.get(f"/routes/{route['RouteId']}")
        assert resp.status_code == 200
        assert resp.json()["RouteId"] == route["RouteId"]

    def test_get_nonexistent_route_returns_404(self, client):
        resp = client.get("/routes/999999")
        assert resp.status_code == 404

    def test_list_routes_returns_list(self, client, route):
        resp = client.get("/routes")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_update_route_name(self, client, route):
        new_name = f"Updated_{_uid()}"
        resp = client.patch(f"/routes/{route['RouteId']}", json={"Name": new_name})
        assert resp.status_code == 200
        assert resp.json()["Name"] == new_name

    def test_update_route_nonexistent(self, client):
        resp = client.patch("/routes/999999", json={"Name": "X"})
        assert resp.status_code == 404

    def test_route_pdv_count_starts_at_zero(self, client, route):
        assert route["PdvCount"] == 0

    def test_create_route_requires_auth(self, client):
        resp = client.post("/routes", json={"Name": "No Auth"}, headers={"Authorization": ""})
        assert resp.status_code == 401

    def test_list_routes_requires_auth(self, client):
        resp = client.get("/routes", headers={"Authorization": ""})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# RoutePdv
# ---------------------------------------------------------------------------

class TestRoutePdv:
    def test_add_pdv_to_route(self, client, route, pdv):
        resp = client.post(
            f"/routes/{route['RouteId']}/pdvs",
            json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3},
        )
        assert resp.status_code == 201
        assert resp.json()["PdvId"] == pdv["PdvId"]

    def test_list_route_pdvs_after_add(self, client, route, pdv):
        client.post(f"/routes/{route['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3})
        resp = client.get(f"/routes/{route['RouteId']}/pdvs")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_pdv_exclusivity_same_pdv_two_routes(self, client, pdv):
        route1 = _make_route(client)
        route2 = _make_route(client)
        client.post(f"/routes/{route1['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3})
        resp = client.post(f"/routes/{route2['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3})
        assert resp.status_code == 409

    def test_add_same_pdv_to_same_route_updates_sort_order(self, client, route, pdv):
        client.post(f"/routes/{route['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3})
        resp = client.post(f"/routes/{route['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 5, "Priority": 2})
        assert resp.status_code == 201
        assert resp.json()["SortOrder"] == 5

    def test_pdv_assignments_endpoint_includes_added_pdv(self, client, route, pdv):
        client.post(f"/routes/{route['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3})
        resp = client.get("/routes/pdv-assignments")
        assert resp.status_code == 200
        pdv_ids = [a["pdvId"] for a in resp.json()]
        assert pdv["PdvId"] in pdv_ids

    def test_assigned_user_propagates_to_pdv_on_add(self, client, user, pdv):
        route = _make_route(client, assigned_user_id=user["UserId"])
        client.post(f"/routes/{route['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3})
        updated_pdv = client.get(f"/pdvs/{pdv['PdvId']}").json()
        assert updated_pdv["AssignedUserId"] == user["UserId"]

    def test_remove_pdv_from_route(self, client, route, pdv):
        client.post(f"/routes/{route['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3})
        resp = client.delete(f"/routes/{route['RouteId']}/pdvs/{pdv['PdvId']}")
        assert resp.status_code == 204

    def test_remove_nonexistent_pdv_from_route_returns_404(self, client, route):
        resp = client.delete(f"/routes/{route['RouteId']}/pdvs/999999")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Route Forms
# ---------------------------------------------------------------------------

class TestRouteForms:
    def test_add_form_to_route(self, client, route):
        form = _make_form(client)
        resp = client.post(f"/routes/{route['RouteId']}/forms", json={"FormId": form["FormId"], "SortOrder": 0})
        assert resp.status_code == 201

    def test_list_route_forms_after_add(self, client, route):
        form = _make_form(client)
        client.post(f"/routes/{route['RouteId']}/forms", json={"FormId": form["FormId"], "SortOrder": 0})
        resp = client.get(f"/routes/{route['RouteId']}/forms")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_remove_form_from_route(self, client, route):
        form = _make_form(client)
        client.post(f"/routes/{route['RouteId']}/forms", json={"FormId": form["FormId"], "SortOrder": 0})
        resp = client.delete(f"/routes/{route['RouteId']}/forms/{form['FormId']}")
        assert resp.status_code == 204

    def test_remove_nonexistent_form_returns_404(self, client, route):
        resp = client.delete(f"/routes/{route['RouteId']}/forms/999999")
        assert resp.status_code == 404

    def test_list_empty_forms_on_new_route(self, client, route):
        resp = client.get(f"/routes/{route['RouteId']}/forms")
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# Bejerman Zones
# ---------------------------------------------------------------------------

class TestBejermanZones:
    def test_list_bejerman_zones_returns_nonempty_list(self, client):
        resp = client.get("/routes/bejerman-zones")
        assert resp.status_code == 200
        data = resp.json()
        assert "zones" in data
        assert isinstance(data["zones"], list)
        assert len(data["zones"]) > 0


# ---------------------------------------------------------------------------
# Route Days
# ---------------------------------------------------------------------------

class TestRouteDays:
    def test_create_route_day(self, client, user, pdv):
        route = _make_route(client, assigned_user_id=user["UserId"])
        client.post(f"/routes/{route['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3})
        resp = client.post(
            f"/routes/{route['RouteId']}/days",
            json={"WorkDate": "2026-04-22", "AssignedUserId": user["UserId"]},
        )
        assert resp.status_code == 201
        day = resp.json()
        assert day["RouteId"] == route["RouteId"]
        assert "RouteDayId" in day

    def test_create_route_day_copies_pdvs_from_route(self, client, user, pdv):
        route = _make_route(client, assigned_user_id=user["UserId"])
        client.post(f"/routes/{route['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3})
        day = client.post(
            f"/routes/{route['RouteId']}/days",
            json={"WorkDate": "2026-04-22", "AssignedUserId": user["UserId"]},
        ).json()
        day_pdvs = client.get(f"/routes/days/{day['RouteDayId']}/pdvs").json()
        assert len(day_pdvs) >= 1

    def test_create_route_day_without_user_fails(self, client):
        route = _make_route(client)
        resp = client.post(f"/routes/{route['RouteId']}/days", json={"WorkDate": "2026-04-22"})
        assert resp.status_code == 400

    def test_list_route_days(self, client, user):
        route = _make_route(client, assigned_user_id=user["UserId"])
        client.post(
            f"/routes/{route['RouteId']}/days",
            json={"WorkDate": "2026-04-22", "AssignedUserId": user["UserId"]},
        )
        resp = client.get(f"/routes/{route['RouteId']}/days")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_get_route_day_by_id(self, client, user):
        route = _make_route(client, assigned_user_id=user["UserId"])
        day = client.post(
            f"/routes/{route['RouteId']}/days",
            json={"WorkDate": "2026-04-22", "AssignedUserId": user["UserId"]},
        ).json()
        resp = client.get(f"/routes/days/{day['RouteDayId']}")
        assert resp.status_code == 200
        assert resp.json()["RouteDayId"] == day["RouteDayId"]

    def test_delete_route_day(self, client, user):
        route = _make_route(client, assigned_user_id=user["UserId"])
        day = client.post(
            f"/routes/{route['RouteId']}/days",
            json={"WorkDate": "2026-04-22", "AssignedUserId": user["UserId"]},
        ).json()
        resp = client.delete(f"/routes/days/{day['RouteDayId']}")
        assert resp.status_code == 204

    def test_get_nonexistent_route_day_returns_404(self, client):
        resp = client.get("/routes/days/999999")
        assert resp.status_code == 404

    def test_map_overview_returns_routes_and_unrouted(self, client):
        resp = client.get("/routes/map-overview")
        assert resp.status_code == 200
        data = resp.json()
        assert "routes" in data
        assert "unroutedPdvs" in data
