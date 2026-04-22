"""Reports endpoint tests.

Strategy: `client` fixture is admin-authenticated. All data creation uses the
admin client directly.

Covers:
- /reports/summary KPI structure, empty-DB baseline, live-data coverage increase
- /reports/vendor-ranking structure
- /reports/channel-coverage structure
- /reports/perfect-store structure
- /reports/smart-alerts structure
- /reports/trending with months param
- Date range filtering (year/month params)
- All endpoints require authentication
"""
import uuid
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uid():
    return uuid.uuid4().hex[:8]


def _make_user(client):
    email = f"rep_{_uid()}@test.com"
    resp = client.post("/users", json={"Email": email, "DisplayName": email, "Password": "Pass123!"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _login(client, email, password="Pass123!"):
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# Summary KPI
# ---------------------------------------------------------------------------

class TestReportSummary:
    def test_summary_returns_200(self, client):
        resp = client.get("/reports/summary")
        assert resp.status_code == 200

    def test_summary_has_all_required_keys(self, client):
        resp = client.get("/reports/summary")
        data = resp.json()
        required_keys = {
            "year", "month", "totalVisits", "closedVisits", "totalPdvs",
            "pdvsVisited", "coverage", "visitsWithGps", "visitsWithPhoto", "avgDurationMin",
        }
        for key in required_keys:
            assert key in data, f"Key '{key}' missing from summary response"

    def test_summary_with_year_month_params(self, client):
        resp = client.get("/reports/summary", params={"year": 2026, "month": 1})
        assert resp.status_code == 200
        data = resp.json()
        assert data["year"] == 2026
        assert data["month"] == 1

    def test_summary_coverage_is_valid_percentage(self, client):
        resp = client.get("/reports/summary")
        coverage = resp.json()["coverage"]
        assert 0 <= coverage <= 100

    def test_summary_avg_duration_is_non_negative(self, client):
        resp = client.get("/reports/summary")
        assert resp.json()["avgDurationMin"] >= 0

    def test_summary_coverage_increases_after_closed_visit(self, client):
        """Closed visit in current month should drive coverage > 0 when PDVs exist."""
        ch = client.post("/channels", json={"Name": f"RepCh_{_uid()}"}).json()
        pdv = client.post("/pdvs", json={"Name": f"RepPDV_{_uid()}", "ChannelId": ch["ChannelId"], "IsActive": True}).json()
        user = _make_user(client)
        user_token = _login(client, user["Email"])

        # Create and close a visit using vendedor's token (so ownership passes)
        visit = client.post(
            "/visits",
            json={"PdvId": pdv["PdvId"], "UserId": user["UserId"], "Status": "OPEN"},
            headers={"Authorization": f"Bearer {user_token}"},
        ).json()
        client.patch(
            f"/visits/{visit['VisitId']}",
            json={"Status": "CLOSED"},
            headers={"Authorization": f"Bearer {user_token}"},
        )

        resp = client.get("/reports/summary")
        data = resp.json()
        assert data["totalVisits"] >= 1
        assert data["closedVisits"] >= 1
        assert data["coverage"] > 0

    def test_summary_requires_auth(self, client):
        resp = client.get("/reports/summary", headers={"Authorization": ""})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Vendor Ranking
# ---------------------------------------------------------------------------

class TestVendorRanking:
    def test_vendor_ranking_returns_200(self, client):
        resp = client.get("/reports/vendor-ranking")
        assert resp.status_code == 200

    def test_vendor_ranking_returns_list(self, client):
        resp = client.get("/reports/vendor-ranking")
        assert isinstance(resp.json(), list)

    def test_vendor_ranking_with_date_params(self, client):
        resp = client.get("/reports/vendor-ranking", params={"year": 2026, "month": 4})
        assert resp.status_code == 200

    def test_vendor_ranking_requires_auth(self, client):
        resp = client.get("/reports/vendor-ranking", headers={"Authorization": ""})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Channel Coverage
# ---------------------------------------------------------------------------

class TestChannelCoverage:
    def test_channel_coverage_returns_200(self, client):
        resp = client.get("/reports/channel-coverage")
        assert resp.status_code == 200

    def test_channel_coverage_returns_list(self, client):
        resp = client.get("/reports/channel-coverage")
        assert isinstance(resp.json(), list)

    def test_channel_coverage_requires_auth(self, client):
        resp = client.get("/reports/channel-coverage", headers={"Authorization": ""})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Perfect Store
# ---------------------------------------------------------------------------

class TestPerfectStore:
    def test_perfect_store_returns_200(self, client):
        resp = client.get("/reports/perfect-store")
        assert resp.status_code == 200

    def test_perfect_store_requires_auth(self, client):
        resp = client.get("/reports/perfect-store", headers={"Authorization": ""})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Smart Alerts
# ---------------------------------------------------------------------------

class TestSmartAlerts:
    def test_smart_alerts_returns_200(self, client):
        resp = client.get("/reports/smart-alerts")
        assert resp.status_code == 200

    def test_smart_alerts_requires_auth(self, client):
        resp = client.get("/reports/smart-alerts", headers={"Authorization": ""})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Trending
# ---------------------------------------------------------------------------

class TestTrending:
    def test_trending_with_months_param(self, client):
        resp = client.get("/reports/trending", params={"months": 3})
        assert resp.status_code == 200

    def test_trending_without_params(self, client):
        resp = client.get("/reports/trending")
        assert resp.status_code == 200

    def test_trending_min_months_boundary(self, client):
        # months has ge=2 — exactly 2 should work, 1 should return 422
        resp_valid = client.get("/reports/trending", params={"months": 2})
        assert resp_valid.status_code == 200
        resp_invalid = client.get("/reports/trending", params={"months": 1})
        assert resp_invalid.status_code == 422

    def test_trending_requires_auth(self, client):
        resp = client.get("/reports/trending", headers={"Authorization": ""})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Regression smoke: all report endpoints return 200
# ---------------------------------------------------------------------------

class TestAllReportEndpoints:
    ENDPOINTS = [
        "/reports/summary",
        "/reports/vendor-ranking",
        "/reports/channel-coverage",
        "/reports/perfect-store",
        "/reports/smart-alerts",
    ]

    def test_all_report_endpoints_return_200(self, client):
        for endpoint in self.ENDPOINTS:
            resp = client.get(endpoint)
            assert resp.status_code == 200, f"{endpoint} returned {resp.status_code}: {resp.text}"
