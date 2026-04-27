"""Tests for visit steps 12, 14, 16, 18 from paso-a-paso document.

Covers:
- Loose cigarettes survey (step 12)
- Visit actions validation (step 14)
- Visit indicators: effectiveness + completeness (step 16)
- Enhanced checkout validation (step 18)
"""
import json
import uuid
import pytest


def _uid():
    return uuid.uuid4().hex[:8]


def _make_channel(client):
    return client.post("/channels", json={"Name": f"Ch_{_uid()}"}).json()


def _make_pdv(client, channel_id, **kwargs):
    return client.post("/pdvs", json={"Name": f"PDV_{_uid()}", "ChannelId": channel_id, **kwargs}).json()


def _make_user(client):
    email = f"u_{_uid()}@test.com"
    return client.post("/users", json={"Email": email, "DisplayName": email, "Password": "Pass123!"}).json()


def _make_visit(client, pdv_id, user_id):
    return client.post("/visits", json={"PdvId": pdv_id, "UserId": user_id, "Status": "OPEN"}).json()


def _make_product(client, name=None, category="Cigarrillos", is_own=True):
    name = name or f"P_{_uid()}"
    return client.post("/products", json={"Name": name, "Category": category, "IsOwn": is_own}).json()


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
def visit(client, pdv, user):
    return _make_visit(client, pdv["PdvId"], user["UserId"])


# ---------------------------------------------------------------------------
# Loose Survey (Step 12)
# ---------------------------------------------------------------------------

class TestLooseSurvey:
    def test_save_loose_survey(self, client, visit):
        resp = client.put(f"/visits/{visit['VisitId']}/loose-survey", json={
            "SellsLoose": True,
            "ProductsJson": json.dumps([
                {"name": "Milenio Red", "price": 150},
                {"name": "Marlboro", "price": 200},
            ]),
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["SellsLoose"] is True
        assert data["ProductsJson"] is not None

    def test_save_not_selling_clears_products(self, client, visit):
        resp = client.put(f"/visits/{visit['VisitId']}/loose-survey", json={
            "SellsLoose": False,
            "ProductsJson": json.dumps([{"name": "X", "price": 100}]),
        })
        assert resp.status_code == 200
        assert resp.json()["ProductsJson"] is None

    def test_get_loose_survey(self, client, visit):
        client.put(f"/visits/{visit['VisitId']}/loose-survey", json={"SellsLoose": True})
        resp = client.get(f"/visits/{visit['VisitId']}/loose-survey")
        assert resp.status_code == 200
        assert resp.json()["SellsLoose"] is True

    def test_get_nonexistent_returns_null(self, client, visit):
        resp = client.get(f"/visits/{visit['VisitId']}/loose-survey")
        assert resp.status_code == 200
        assert resp.json() is None

    def test_update_replaces_existing(self, client, visit):
        client.put(f"/visits/{visit['VisitId']}/loose-survey", json={"SellsLoose": True})
        resp = client.put(f"/visits/{visit['VisitId']}/loose-survey", json={"SellsLoose": False})
        assert resp.status_code == 200
        assert resp.json()["SellsLoose"] is False

    def test_cannot_save_on_closed_visit(self, client, pdv, user):
        v = _make_visit(client, pdv["PdvId"], user["UserId"])
        client.patch(f"/visits/{v['VisitId']}", json={"Status": "CLOSED"})
        resp = client.put(f"/visits/{v['VisitId']}/loose-survey", json={"SellsLoose": True})
        assert resp.status_code == 400

    def test_save_with_exchange_json(self, client, visit):
        exchange = {
            "capsulado": {
                "product": "Milenio Red",
                "price": 150,
                "modality": "5+1",
                "negotiation": "quiosco_nuevo",
                "startDate": "2026-04-01",
            }
        }
        resp = client.put(f"/visits/{visit['VisitId']}/loose-survey", json={
            "SellsLoose": True,
            "ExchangeJson": json.dumps(exchange),
        })
        assert resp.status_code == 200
        assert resp.json()["ExchangeJson"] is not None


# ---------------------------------------------------------------------------
# Visit Actions (Step 14) — using existing VisitAction with DetailsJson
# ---------------------------------------------------------------------------

class TestVisitActions:
    def test_create_canje_action(self, client, visit):
        details = {
            "modality": "5+1",
            "negotiation": "quiosco_nuevo",
            "vacios": {"Milenio Red": 10, "Milenio Gold": 5},
            "llenos_to_deliver": 3,
            "brand_to_deliver": "Milenio Red",
        }
        resp = client.post(f"/visits/{visit['VisitId']}/actions", json={
            "ActionType": "canje_sueltos",
            "Description": "Canje de vacíos",
            "DetailsJson": json.dumps(details),
            "PhotoRequired": True,
        })
        assert resp.status_code == 201
        assert resp.json()["ActionType"] == "canje_sueltos"

    def test_create_promo_action(self, client, visit):
        details = {
            "promoType": "prueba_producto",
            "product": "Melbourne Caps",
            "gift": "Encendedor",
            "quantity": 5,
        }
        resp = client.post(f"/visits/{visit['VisitId']}/actions", json={
            "ActionType": "promo",
            "Description": "Prueba de producto",
            "DetailsJson": json.dumps(details),
        })
        assert resp.status_code == 201

    def test_create_juego_ludico_action(self, client, visit):
        details = {
            "gameType": "ruleta",
            "prize": "Atado de cigarrillos",
            "condition": "Cobertura de 6 marcas",
        }
        resp = client.post(f"/visits/{visit['VisitId']}/actions", json={
            "ActionType": "juego_ludico",
            "Description": "Ruleta promocional",
            "DetailsJson": json.dumps(details),
        })
        assert resp.status_code == 201
        assert resp.json()["ActionType"] == "juego_ludico"

    def test_create_otra_action(self, client, visit):
        resp = client.post(f"/visits/{visit['VisitId']}/actions", json={
            "ActionType": "otra",
            "Description": "Acuerdo verbal con kiosquero para exhibición",
            "PhotoRequired": False,
        })
        assert resp.status_code == 201

    def test_mark_action_done(self, client, visit):
        action = client.post(f"/visits/{visit['VisitId']}/actions", json={
            "ActionType": "pop",
            "Description": "Colocación de cigarrera",
        }).json()
        resp = client.patch(f"/visits/actions/{action['VisitActionId']}", json={
            "Status": "DONE",
            "PhotoTaken": True,
        })
        assert resp.status_code == 200
        assert resp.json()["Status"] == "DONE"


# ---------------------------------------------------------------------------
# Visit Indicators (Step 16)
# ---------------------------------------------------------------------------

class TestVisitIndicators:
    def test_empty_visit_not_effective(self, client, visit):
        resp = client.get(f"/visits/{visit['VisitId']}/indicators")
        assert resp.status_code == 200
        data = resp.json()
        assert data["effective"] is False
        assert data["completeness"] < 1.0
        assert len(data["missing_for_close"]) > 0

    def test_visit_with_coverage_and_action_is_effective(self, client, pdv, user):
        v = _make_visit(client, pdv["PdvId"], user["UserId"])
        # Add coverage
        p = _make_product(client)
        client.put(f"/visits/{v['VisitId']}/coverage", json={
            "items": [{"ProductId": p["ProductId"], "Works": True, "Price": 1000}]
        })
        # Add action and mark done
        action = client.post(f"/visits/{v['VisitId']}/actions", json={
            "ActionType": "pop",
            "Description": "Cigarrera",
        }).json()
        client.patch(f"/visits/actions/{action['VisitActionId']}", json={"Status": "DONE"})

        resp = client.get(f"/visits/{v['VisitId']}/indicators")
        assert resp.json()["effective"] is True

    def test_completeness_increases_with_steps(self, client, pdv, user):
        v = _make_visit(client, pdv["PdvId"], user["UserId"])

        # Start: nothing done
        resp = client.get(f"/visits/{v['VisitId']}/indicators")
        initial = resp.json()["completeness"]

        # Add coverage
        p = _make_product(client)
        client.put(f"/visits/{v['VisitId']}/coverage", json={
            "items": [{"ProductId": p["ProductId"], "Works": True, "Price": 500}]
        })
        resp = client.get(f"/visits/{v['VisitId']}/indicators")
        after_coverage = resp.json()["completeness"]
        assert after_coverage > initial

        # Add POP
        client.put(f"/visits/{v['VisitId']}/pop", json={
            "items": [{"MaterialType": "primario", "MaterialName": "Cigarrera", "Present": True}]
        })
        resp = client.get(f"/visits/{v['VisitId']}/indicators")
        after_pop = resp.json()["completeness"]
        assert after_pop > after_coverage

    def test_missing_for_close_lists_mandatory(self, client, visit):
        resp = client.get(f"/visits/{visit['VisitId']}/indicators")
        missing = resp.json()["missing_for_close"]
        # Should include coverage and POP as mandatory
        labels = " ".join(missing).lower()
        assert "cobertura" in labels
        assert "pop" in labels

    def test_indicators_steps_structure(self, client, visit):
        resp = client.get(f"/visits/{visit['VisitId']}/indicators")
        steps = resp.json()["steps"]
        assert len(steps) == 6
        names = {s["name"] for s in steps}
        assert {"distributor", "coverage", "pop", "loose", "actions", "news"} == names
        mandatory = [s for s in steps if s["mandatory"]]
        assert len(mandatory) == 3


# ---------------------------------------------------------------------------
# Enhanced Validate-Close (Step 18)
# ---------------------------------------------------------------------------

class TestValidateClose:
    def test_validate_close_missing_coverage(self, client, visit):
        resp = client.post(f"/visits/{visit['VisitId']}/validate-close")
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is False
        labels = [m.get("label", "") for m in data["missing"]]
        assert any("Cobertura" in l for l in labels)

    def test_validate_close_missing_pop(self, client, visit):
        resp = client.post(f"/visits/{visit['VisitId']}/validate-close")
        labels = [m.get("label", "") for m in resp.json()["missing"]]
        assert any("POP" in l for l in labels)

    def test_validate_close_passes_with_all_mandatory(self, client, pdv, user):
        # Create PDV with distributor
        ch = _make_channel(client)
        dist = client.post("/distributors", json={"Name": f"Dist_{_uid()}"}).json()
        pdv2 = client.post("/pdvs", json={
            "Name": f"PDV_{_uid()}", "ChannelId": ch["ChannelId"],
            "DistributorId": dist["DistributorId"],
        }).json()
        v = _make_visit(client, pdv2["PdvId"], user["UserId"])

        # Fill coverage (own + competitor for first visit)
        p_own = _make_product(client, is_own=True)
        p_comp = _make_product(client, is_own=False)
        client.put(f"/visits/{v['VisitId']}/coverage", json={
            "items": [
                {"ProductId": p_own["ProductId"], "Works": True, "Price": 500},
                {"ProductId": p_comp["ProductId"], "Works": True, "Price": 300},
            ]
        })
        # Fill POP
        client.put(f"/visits/{v['VisitId']}/pop", json={
            "items": [{"MaterialType": "primario", "MaterialName": "Cigarrera", "Present": True}]
        })

        resp = client.post(f"/visits/{v['VisitId']}/validate-close")
        data = resp.json()
        assert data["valid"] is True
        assert len(data["missing"]) == 0
