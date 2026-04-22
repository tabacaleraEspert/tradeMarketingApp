"""Visit lifecycle tests.

Strategy:
- `client` fixture from conftest provides an admin-authenticated client.
- Use admin client to create all prerequisite data (channels, PDVs, users).
- For role-specific tests (ownership, vendedor restrictions), create a separate
  vendedor user and make requests using their token explicitly.
- Each fixture uses unique names to avoid cross-test conflicts in the shared DB.

Covers:
- Create visit (OPEN / IN_PROGRESS)
- State transitions (OPEN → IN_PROGRESS → CLOSED/COMPLETED, terminal enforcement)
- Duplicate open visit prevention
- Form answers (submit, re-submit, closed visit rejection)
- GPS check-in/check-out validation
- Visit ownership enforcement (vendedor vs admin)
- List visits with filters (user_id, pdv_id, status)
- Delete visit (admin only)
- validate-close endpoint
"""
import uuid
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uid():
    """Short unique suffix to avoid name collisions across tests."""
    return uuid.uuid4().hex[:8]


def _make_user(client, email=None, password="Pass123!", role=None):
    """Create a user (as admin) and optionally assign a role."""
    if email is None:
        email = f"user_{_uid()}@test.com"
    resp = client.post("/users", json={"Email": email, "DisplayName": email, "Password": password})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _login(client, email, password="Pass123!"):
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _make_channel(client, name=None):
    """Create a channel using the admin client."""
    name = name or f"Ch_{_uid()}"
    resp = client.post("/channels", json={"Name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_pdv(client, channel_id, name=None, is_active=True):
    """Create a PDV using the admin client."""
    name = name or f"PDV_{_uid()}"
    resp = client.post("/pdvs", json={"Name": name, "ChannelId": channel_id, "IsActive": is_active})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_visit(client, pdv_id, user_id, status="OPEN", token=None):
    """Create a visit. Uses admin client by default; pass token to use a different user."""
    headers = _auth(token) if token else {}
    resp = client.post(
        "/visits",
        json={"PdvId": pdv_id, "UserId": user_id, "Status": status},
        headers=headers,
    )
    return resp


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def channel(client):
    return _make_channel(client)


@pytest.fixture()
def pdv(client, channel):
    return _make_pdv(client, channel["ChannelId"])


@pytest.fixture()
def inactive_pdv(client, channel):
    return _make_pdv(client, channel["ChannelId"], is_active=False)


@pytest.fixture()
def vendedor(client):
    """A regular vendedor user with their login token."""
    user = _make_user(client)
    tokens = _login(client, user["Email"])
    return {"user": user, "token": tokens["access_token"]}


@pytest.fixture()
def open_visit(client, pdv, vendedor):
    """An open visit created by the vendedor (using admin client but for their user ID)."""
    resp = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"])
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Create visit
# ---------------------------------------------------------------------------

class TestCreateVisit:
    def test_create_visit_open_status(self, client, pdv, vendedor):
        resp = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"])
        assert resp.status_code == 201
        data = resp.json()
        assert data["Status"] == "OPEN"
        assert data["PdvId"] == pdv["PdvId"]
        assert data["UserId"] == vendedor["user"]["UserId"]
        assert data["VisitId"] > 0

    def test_create_visit_in_progress_status(self, client, pdv, vendedor):
        resp = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"], status="IN_PROGRESS")
        assert resp.status_code == 201
        assert resp.json()["Status"] == "IN_PROGRESS"

    def test_create_visit_on_inactive_pdv_rejected(self, client, inactive_pdv, vendedor):
        resp = _make_visit(client, inactive_pdv["PdvId"], vendedor["user"]["UserId"])
        assert resp.status_code == 400

    def test_create_visit_directly_as_closed_rejected(self, client, pdv, vendedor):
        resp = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"], status="CLOSED")
        assert resp.status_code == 400

    def test_create_visit_directly_as_completed_rejected(self, client, pdv, vendedor):
        resp = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"], status="COMPLETED")
        assert resp.status_code == 400

    def test_create_visit_with_invalid_status_rejected(self, client, pdv, vendedor):
        resp = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"], status="BOGUS")
        assert resp.status_code == 400

    def test_duplicate_open_visit_rejected(self, client, pdv, vendedor):
        _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"])
        resp = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"])
        assert resp.status_code == 409

    def test_vendedor_cannot_create_visit_for_other_user(self, client, pdv, vendedor):
        other = _make_user(client)
        # Vendedor sends request with their own token but for another user's ID
        resp = _make_visit(client, pdv["PdvId"], other["UserId"], token=vendedor["token"])
        assert resp.status_code == 403

    def test_create_visit_requires_auth(self, client, pdv, vendedor):
        resp = client.post(
            "/visits",
            json={"PdvId": pdv["PdvId"], "UserId": vendedor["user"]["UserId"]},
            headers={"Authorization": ""},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Get & List visits
# ---------------------------------------------------------------------------

class TestListVisits:
    def test_get_visit_by_id(self, client, open_visit):
        resp = client.get(f"/visits/{open_visit['VisitId']}")
        assert resp.status_code == 200
        assert resp.json()["VisitId"] == open_visit["VisitId"]

    def test_get_nonexistent_visit_returns_404(self, client):
        resp = client.get("/visits/999999")
        assert resp.status_code == 404

    def test_list_visits_returns_list(self, client, open_visit):
        resp = client.get("/visits")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_visits_filter_by_user_id(self, client, open_visit, vendedor):
        resp = client.get("/visits", params={"user_id": vendedor["user"]["UserId"]})
        assert resp.status_code == 200
        for v in resp.json():
            assert v["UserId"] == vendedor["user"]["UserId"]

    def test_list_visits_filter_by_pdv_id(self, client, open_visit, pdv):
        resp = client.get("/visits", params={"pdv_id": pdv["PdvId"]})
        assert resp.status_code == 200
        for v in resp.json():
            assert v["PdvId"] == pdv["PdvId"]

    def test_list_visits_filter_by_status(self, client, open_visit):
        resp = client.get("/visits", params={"status": "OPEN"})
        assert resp.status_code == 200
        for v in resp.json():
            assert v["Status"] == "OPEN"


# ---------------------------------------------------------------------------
# State transitions
# ---------------------------------------------------------------------------

class TestVisitStatusTransitions:
    def test_open_to_in_progress(self, client, open_visit):
        resp = client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "IN_PROGRESS"})
        assert resp.status_code == 200
        assert resp.json()["Status"] == "IN_PROGRESS"

    def test_in_progress_to_closed(self, client, pdv, vendedor):
        visit = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"], "IN_PROGRESS").json()
        resp = client.patch(f"/visits/{visit['VisitId']}", json={"Status": "CLOSED"})
        assert resp.status_code == 200
        assert resp.json()["Status"] == "CLOSED"

    def test_closed_visit_sets_closed_at(self, client, open_visit):
        resp = client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "CLOSED"})
        assert resp.status_code == 200
        assert resp.json()["ClosedAt"] is not None

    def test_closed_visit_cannot_change_status(self, client, open_visit):
        client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "CLOSED"})
        resp = client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "OPEN"})
        assert resp.status_code == 409

    def test_completed_visit_is_terminal(self, client, open_visit):
        client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "COMPLETED"})
        resp = client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "OPEN"})
        assert resp.status_code == 409

    def test_invalid_status_value_rejected(self, client, open_visit):
        resp = client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "INVALID_STATE"})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Visit ownership (vendedor vs admin)
# ---------------------------------------------------------------------------

class TestVisitOwnership:
    def test_non_owner_vendedor_cannot_update_visit(self, client, pdv, vendedor):
        """Visit owned by vendedor A; vendedor B (intruder) should get 403."""
        visit = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"]).json()
        # Create a second vendedor
        intruder = _make_user(client)
        intruder_tokens = _login(client, intruder["Email"])
        resp = client.patch(
            f"/visits/{visit['VisitId']}",
            json={"Status": "IN_PROGRESS"},
            headers=_auth(intruder_tokens["access_token"]),
        )
        assert resp.status_code == 403

    def test_owner_can_update_own_visit(self, client, pdv, vendedor):
        visit = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"]).json()
        resp = client.patch(
            f"/visits/{visit['VisitId']}",
            json={"Status": "IN_PROGRESS"},
            headers=_auth(vendedor["token"]),
        )
        assert resp.status_code == 200

    def test_admin_can_update_any_visit(self, client, open_visit):
        """Admin token (from client fixture) can update any visit."""
        resp = client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "IN_PROGRESS"})
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Form answers
# ---------------------------------------------------------------------------

class TestVisitAnswers:
    def test_submit_answers_to_open_visit(self, client, open_visit):
        resp = client.post(
            f"/visits/{open_visit['VisitId']}/answers",
            json={"answers": [{"QuestionId": 1, "ValueText": "hello"}]},
        )
        assert resp.status_code == 201
        assert isinstance(resp.json(), list)

    def test_re_submit_answers_replaces_previous(self, client, open_visit):
        client.post(
            f"/visits/{open_visit['VisitId']}/answers",
            json={"answers": [{"QuestionId": 1, "ValueText": "first"}]},
        )
        resp = client.post(
            f"/visits/{open_visit['VisitId']}/answers",
            json={"answers": [{"QuestionId": 1, "ValueText": "second"}]},
        )
        assert resp.status_code == 201
        answers = client.get(f"/visits/{open_visit['VisitId']}/answers").json()
        assert len(answers) == 1
        assert answers[0]["ValueText"] == "second"

    def test_submit_answers_to_closed_visit_rejected(self, client, open_visit):
        client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "CLOSED"})
        resp = client.post(
            f"/visits/{open_visit['VisitId']}/answers",
            json={"answers": [{"QuestionId": 1, "ValueText": "too late"}]},
        )
        assert resp.status_code == 409

    def test_list_answers_returns_empty_for_new_visit(self, client, open_visit):
        resp = client.get(f"/visits/{open_visit['VisitId']}/answers")
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# GPS Checks
# ---------------------------------------------------------------------------

class TestGpsChecks:
    def test_check_in(self, client, open_visit):
        resp = client.post(
            f"/visits/{open_visit['VisitId']}/checks",
            json={"CheckType": "IN", "Lat": -34.6, "Lon": -58.4},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["CheckType"] == "IN"
        assert abs(data["Lat"] - (-34.6)) < 0.001

    def test_check_out(self, client, open_visit):
        resp = client.post(
            f"/visits/{open_visit['VisitId']}/checks",
            json={"CheckType": "OUT", "Lat": -34.6, "Lon": -58.4},
        )
        assert resp.status_code == 201
        assert resp.json()["CheckType"] == "OUT"

    def test_invalid_check_type_rejected(self, client, open_visit):
        resp = client.post(
            f"/visits/{open_visit['VisitId']}/checks",
            json={"CheckType": "MIDDLE"},
        )
        assert resp.status_code == 400

    def test_invalid_latitude_rejected(self, client, open_visit):
        resp = client.post(
            f"/visits/{open_visit['VisitId']}/checks",
            json={"CheckType": "IN", "Lat": 200, "Lon": -58.4},
        )
        assert resp.status_code == 400

    def test_invalid_longitude_rejected(self, client, open_visit):
        resp = client.post(
            f"/visits/{open_visit['VisitId']}/checks",
            json={"CheckType": "IN", "Lat": -34.6, "Lon": 300},
        )
        assert resp.status_code == 400

    def test_check_in_on_closed_visit_rejected(self, client, open_visit):
        client.patch(f"/visits/{open_visit['VisitId']}", json={"Status": "CLOSED"})
        resp = client.post(
            f"/visits/{open_visit['VisitId']}/checks",
            json={"CheckType": "IN", "Lat": -34.6, "Lon": -58.4},
        )
        assert resp.status_code == 409

    def test_list_checks_empty_initially(self, client, open_visit):
        resp = client.get(f"/visits/{open_visit['VisitId']}/checks")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_checks_after_check_in(self, client, open_visit):
        client.post(
            f"/visits/{open_visit['VisitId']}/checks",
            json={"CheckType": "IN", "Lat": -34.6, "Lon": -58.4},
        )
        checks = client.get(f"/visits/{open_visit['VisitId']}/checks").json()
        assert len(checks) == 1
        assert checks[0]["CheckType"] == "IN"


# ---------------------------------------------------------------------------
# Delete visit
# ---------------------------------------------------------------------------

class TestDeleteVisit:
    def test_vendedor_cannot_delete_visit(self, client, open_visit, vendedor):
        resp = client.delete(
            f"/visits/{open_visit['VisitId']}",
            headers=_auth(vendedor["token"]),
        )
        assert resp.status_code == 403

    def test_admin_can_delete_visit(self, client, pdv, vendedor):
        visit = _make_visit(client, pdv["PdvId"], vendedor["user"]["UserId"]).json()
        resp = client.delete(f"/visits/{visit['VisitId']}")
        assert resp.status_code == 204

    def test_delete_nonexistent_visit_returns_404(self, client):
        resp = client.delete("/visits/999999")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Validate-close
# ---------------------------------------------------------------------------

class TestValidateClose:
    def test_validate_close_returns_structure(self, client, open_visit):
        resp = client.post(f"/visits/{open_visit['VisitId']}/validate-close")
        assert resp.status_code == 200
        data = resp.json()
        assert "valid" in data
        assert "missing" in data

    def test_validate_close_for_nonexistent_visit(self, client):
        resp = client.post("/visits/999999/validate-close")
        assert resp.status_code == 404
