"""Authentication & authorization tests.

Covers:
- Login happy path and failures
- JWT token refresh flow
- Password change
- Role hierarchy enforcement via require_role()
- Inactive user rejection
- /auth/me endpoint
"""
import pytest
import bcrypt
from datetime import datetime, timedelta, timezone

from jose import jwt
from app.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    ROLE_HIERARCHY,
    _role_level,
)
from app.config import settings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(client, email="user@test.com", password="Pass123!", display_name="Test User"):
    """Create a user via the API and return the response JSON."""
    resp = client.post("/users", json={
        "Email": email,
        "DisplayName": display_name,
        "Password": password,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _login(client, email, password):
    return client.post("/auth/login", json={"email": email, "password": password})


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

class TestLogin:
    def test_login_valid_credentials(self, client):
        _make_user(client, email="login_valid@test.com", password="Secure1!")
        resp = _login(client, "login_valid@test.com", "Secure1!")
        assert resp.status_code == 200
        data = resp.json()
        assert data["Email"] == "login_valid@test.com"
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert data["expires_in"] > 0

    def test_login_wrong_password(self, client):
        _make_user(client, email="badpass@test.com", password="Right123!")
        resp = _login(client, "badpass@test.com", "Wrong123!")
        assert resp.status_code == 401

    def test_login_unknown_email(self, client):
        resp = _login(client, "nobody@nowhere.com", "any")
        assert resp.status_code == 401

    def test_login_empty_password(self, client):
        _make_user(client, email="empty@test.com", password="Pass123!")
        resp = _login(client, "empty@test.com", "")
        assert resp.status_code == 401

    def test_login_inactive_user(self, client):
        user = _make_user(client, email="inactive@test.com", password="Pass123!")
        # Deactivate user
        client.patch(f"/users/{user['UserId']}", json={"IsActive": False})
        resp = _login(client, "inactive@test.com", "Pass123!")
        assert resp.status_code == 401

    def test_login_returns_role(self, client):
        _make_user(client, email="role_check@test.com", password="Pass123!")
        resp = _login(client, "role_check@test.com", "Pass123!")
        assert resp.status_code == 200
        # Default role is 'vendedor'
        assert resp.json()["Role"] == "vendedor"

    def test_login_response_has_zone_fields(self, client):
        _make_user(client, email="zone@test.com", password="Pass123!")
        resp = _login(client, "zone@test.com", "Pass123!")
        data = resp.json()
        # ZoneId may be None, but the key must exist
        assert "ZoneId" in data
        assert "ZoneName" in data


# ---------------------------------------------------------------------------
# Token creation and validation (unit level)
# ---------------------------------------------------------------------------

class TestTokenUnit:
    def test_create_access_token_payload(self):
        token = create_access_token(subject=42, role="vendedor")
        payload = decode_token(token)
        assert payload["sub"] == "42"
        assert payload["role"] == "vendedor"
        assert payload["type"] == "access"

    def test_create_refresh_token_payload(self):
        token = create_refresh_token(subject=99)
        payload = decode_token(token)
        assert payload["sub"] == "99"
        assert payload["type"] == "refresh"

    def test_decode_invalid_token_raises_401(self, client):
        resp = client.get("/auth/me", headers={"Authorization": "Bearer not.a.real.token"})
        assert resp.status_code == 401

    def test_access_token_with_extra_claims(self):
        token = create_access_token(subject=1, role="admin", extra={"custom": "value"})
        payload = decode_token(token)
        assert payload.get("custom") == "value"

    def test_expired_access_token_rejected(self, client):
        # Forge a token that already expired
        now = datetime.now(timezone.utc)
        payload = {
            "sub": "1",
            "role": "vendedor",
            "type": "access",
            "iat": int((now - timedelta(hours=2)).timestamp()),
            "exp": int((now - timedelta(hours=1)).timestamp()),
        }
        expired = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
        resp = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})
        assert resp.status_code == 401

    def test_refresh_token_rejected_as_access(self, client):
        """A refresh token must not be accepted on auth-protected endpoints."""
        _make_user(client, email="rtcheck@test.com", password="Pass123!")
        login = _login(client, "rtcheck@test.com", "Pass123!").json()
        resp = client.get("/auth/me", headers={"Authorization": f"Bearer {login['refresh_token']}"})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------

class TestTokenRefresh:
    def test_refresh_issues_new_access_token(self, client):
        _make_user(client, email="refresh@test.com", password="Pass123!")
        login = _login(client, "refresh@test.com", "Pass123!").json()
        resp = client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        # Token must be a valid JWT string
        assert data["access_token"].count(".") == 2
        assert data["token_type"] == "bearer"
        assert data["expires_in"] > 0

    def test_refresh_with_invalid_token(self, client):
        resp = client.post("/auth/refresh", json={"refresh_token": "totally.invalid"})
        assert resp.status_code == 401

    def test_refresh_with_access_token_fails(self, client):
        _make_user(client, email="wrongtype@test.com", password="Pass123!")
        login = _login(client, "wrongtype@test.com", "Pass123!").json()
        # Try to refresh using the access token (wrong type)
        resp = client.post("/auth/refresh", json={"refresh_token": login["access_token"]})
        assert resp.status_code == 401

    def test_new_access_token_from_refresh_is_usable(self, client):
        _make_user(client, email="userefresh@test.com", password="Pass123!")
        login = _login(client, "userefresh@test.com", "Pass123!").json()
        new_tokens = client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]}).json()
        # Use newly issued access token to hit /auth/me
        resp = client.get("/auth/me", headers=_auth_header(new_tokens["access_token"]))
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Change password
# ---------------------------------------------------------------------------

class TestChangePassword:
    def test_change_password_success(self, client):
        _make_user(client, email="chpw@test.com", password="OldPass1!")
        login = _login(client, "chpw@test.com", "OldPass1!").json()
        resp = client.post(
            "/auth/change-password",
            json={"current_password": "OldPass1!", "new_password": "NewPass2@"},
            headers=_auth_header(login["access_token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_changed_password_allows_login(self, client):
        _make_user(client, email="chpw2@test.com", password="OldPass1!")
        login = _login(client, "chpw2@test.com", "OldPass1!").json()
        client.post(
            "/auth/change-password",
            json={"current_password": "OldPass1!", "new_password": "NewPass2@"},
            headers=_auth_header(login["access_token"]),
        )
        resp = _login(client, "chpw2@test.com", "NewPass2@")
        assert resp.status_code == 200

    def test_wrong_current_password_rejected(self, client):
        _make_user(client, email="chpwfail@test.com", password="Pass123!")
        login = _login(client, "chpwfail@test.com", "Pass123!").json()
        resp = client.post(
            "/auth/change-password",
            json={"current_password": "WrongOld!", "new_password": "NewPass2@"},
            headers=_auth_header(login["access_token"]),
        )
        assert resp.status_code == 400

    def test_new_password_too_short_rejected(self, client):
        _make_user(client, email="shortpw@test.com", password="Pass123!")
        login = _login(client, "shortpw@test.com", "Pass123!").json()
        resp = client.post(
            "/auth/change-password",
            json={"current_password": "Pass123!", "new_password": "short"},
            headers=_auth_header(login["access_token"]),
        )
        assert resp.status_code == 400

    def test_same_password_rejected(self, client):
        _make_user(client, email="samepw@test.com", password="Pass123!")
        login = _login(client, "samepw@test.com", "Pass123!").json()
        resp = client.post(
            "/auth/change-password",
            json={"current_password": "Pass123!", "new_password": "Pass123!"},
            headers=_auth_header(login["access_token"]),
        )
        assert resp.status_code == 400

    def test_change_password_requires_auth(self, client):
        # Send request WITHOUT the Authorization header to test the 401 path
        resp = client.post(
            "/auth/change-password",
            json={"current_password": "x", "new_password": "y"},
            headers={"Authorization": ""},  # override: no token
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /auth/me
# ---------------------------------------------------------------------------

class TestMe:
    def test_me_returns_current_user(self, client):
        user = _make_user(client, email="me@test.com", password="Pass123!")
        login = _login(client, "me@test.com", "Pass123!").json()
        resp = client.get("/auth/me", headers=_auth_header(login["access_token"]))
        assert resp.status_code == 200
        data = resp.json()
        assert data["UserId"] == user["UserId"]
        assert data["Email"] == "me@test.com"
        assert "Role" in data

    def test_me_without_token_returns_401(self, client):
        # Send request WITHOUT the Authorization header (override the fixture default)
        resp = client.get("/auth/me", headers={"Authorization": ""})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Role hierarchy (unit level)
# ---------------------------------------------------------------------------

class TestRoleHierarchy:
    def test_admin_has_highest_level(self):
        assert _role_level("admin") == ROLE_HIERARCHY["admin"]
        assert _role_level("admin") > _role_level("regional_manager")
        assert _role_level("admin") > _role_level("territory_manager")
        assert _role_level("admin") > _role_level("ejecutivo")
        assert _role_level("admin") > _role_level("vendedor")

    def test_vendedor_has_lowest_level(self):
        for role in ("ejecutivo", "territory_manager", "regional_manager", "admin"):
            assert _role_level(role) > _role_level("vendedor")

    def test_unknown_role_returns_zero(self):
        assert _role_level("nonexistent") == 0

    def test_supervisor_alias_equals_territory_manager(self):
        assert _role_level("supervisor") == _role_level("territory_manager")

    def test_role_level_case_insensitive(self):
        assert _role_level("Admin") == _role_level("admin")
        assert _role_level("VENDEDOR") == _role_level("vendedor")


# ---------------------------------------------------------------------------
# Protected endpoint rejects unauthenticated / wrong role
# ---------------------------------------------------------------------------

class TestRequireRole:
    def test_unauthenticated_request_to_protected_endpoint(self, client):
        # Override the default admin header with an empty one (unauthenticated)
        resp = client.get("/users", headers={"Authorization": ""})
        assert resp.status_code == 401

    def test_authenticated_user_can_access_basic_endpoint(self, client):
        _make_user(client, email="can_access@test.com", password="Pass123!")
        login = _login(client, "can_access@test.com", "Pass123!").json()
        resp = client.get("/zones", headers=_auth_header(login["access_token"]))
        assert resp.status_code == 200
