"""Tests for Product catalog, PdvProductCategory, VisitCoverage, and VisitPOPItem.

Covers steps 9, 10, 11 from paso-a-paso document.
"""
import uuid
import pytest


def _uid():
    return uuid.uuid4().hex[:8]


def _make_channel(client, name=None):
    name = name or f"Ch_{_uid()}"
    resp = client.post("/channels", json={"Name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_pdv(client, channel_id, name=None):
    name = name or f"PDV_{_uid()}"
    resp = client.post("/pdvs", json={"Name": name, "ChannelId": channel_id})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_user(client):
    email = f"u_{_uid()}@test.com"
    resp = client.post("/users", json={"Email": email, "DisplayName": email, "Password": "Pass123!"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_visit(client, pdv_id, user_id):
    resp = client.post("/visits", json={"PdvId": pdv_id, "UserId": user_id, "Status": "OPEN"})
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
def visit(client, pdv, user):
    return _make_visit(client, pdv["PdvId"], user["UserId"])


# ---------------------------------------------------------------------------
# Products (catalog)
# ---------------------------------------------------------------------------

class TestProducts:
    def test_create_product(self, client):
        resp = client.post("/products", json={
            "Name": "Test Product",
            "Category": "Cigarrillos",
            "Manufacturer": "Espert",
            "IsOwn": True,
        })
        assert resp.status_code == 201
        p = resp.json()
        assert p["Name"] == "Test Product"
        assert p["Category"] == "Cigarrillos"
        assert p["Manufacturer"] == "Espert"
        assert p["IsOwn"] is True

    def test_list_products(self, client):
        client.post("/products", json={"Name": f"P_{_uid()}", "Category": "Tabacos"})
        resp = client.get("/products")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert len(resp.json()) >= 1

    def test_list_products_filter_by_category(self, client):
        uid = _uid()
        client.post("/products", json={"Name": f"Cig_{uid}", "Category": "Cigarrillos"})
        client.post("/products", json={"Name": f"Vap_{uid}", "Category": "Vapers"})
        resp = client.get("/products", params={"category": "Vapers"})
        assert resp.status_code == 200
        for p in resp.json():
            assert p["Category"] == "Vapers"

    def test_update_product(self, client):
        p = client.post("/products", json={"Name": "OldName", "Category": "Papelillos"}).json()
        resp = client.patch(f"/products/{p['ProductId']}", json={"Name": "NewName"})
        assert resp.status_code == 200
        assert resp.json()["Name"] == "NewName"

    def test_delete_product_soft_deletes(self, client):
        p = client.post("/products", json={"Name": f"Del_{_uid()}", "Category": "Cigarrillos"}).json()
        resp = client.delete(f"/products/{p['ProductId']}")
        assert resp.status_code == 204
        # Should be excluded from active list
        resp = client.get("/products", params={"category": "Cigarrillos"})
        ids = [x["ProductId"] for x in resp.json()]
        assert p["ProductId"] not in ids
        # But visible when active_only=false
        resp = client.get("/products", params={"active_only": False})
        ids = [x["ProductId"] for x in resp.json()]
        assert p["ProductId"] in ids

    def test_get_product_by_id(self, client):
        p = client.post("/products", json={"Name": f"Get_{_uid()}", "Category": "Tabacos"}).json()
        resp = client.get(f"/products/{p['ProductId']}")
        assert resp.status_code == 200
        assert resp.json()["ProductId"] == p["ProductId"]

    def test_get_nonexistent_product(self, client):
        resp = client.get("/products/999999")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PDV Product Categories (Step 9)
# ---------------------------------------------------------------------------

class TestPdvProductCategories:
    def test_bulk_upsert_categories(self, client, pdv):
        resp = client.put(f"/pdvs/{pdv['PdvId']}/product-categories", json={
            "categories": [
                {"Category": "Cigarrillos", "Status": "trabaja"},
                {"Category": "Tabacos", "Status": "no_trabaja"},
                {"Category": "Vapers", "Status": "dejo_de_trabajar"},
            ]
        })
        assert resp.status_code == 200
        cats = resp.json()
        assert len(cats) == 3
        status_map = {c["Category"]: c["Status"] for c in cats}
        assert status_map["Cigarrillos"] == "trabaja"
        assert status_map["Tabacos"] == "no_trabaja"
        assert status_map["Vapers"] == "dejo_de_trabajar"

    def test_upsert_updates_existing(self, client, pdv):
        client.put(f"/pdvs/{pdv['PdvId']}/product-categories", json={
            "categories": [{"Category": "Cigarrillos", "Status": "trabaja"}]
        })
        resp = client.put(f"/pdvs/{pdv['PdvId']}/product-categories", json={
            "categories": [{"Category": "Cigarrillos", "Status": "dejo_de_trabajar"}]
        })
        assert resp.status_code == 200
        cats = resp.json()
        cig = [c for c in cats if c["Category"] == "Cigarrillos"][0]
        assert cig["Status"] == "dejo_de_trabajar"

    def test_list_categories(self, client, pdv):
        client.put(f"/pdvs/{pdv['PdvId']}/product-categories", json={
            "categories": [{"Category": "Papelillos", "Status": "trabaja"}]
        })
        resp = client.get(f"/pdvs/{pdv['PdvId']}/product-categories")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_update_single_category(self, client, pdv):
        cats = client.put(f"/pdvs/{pdv['PdvId']}/product-categories", json={
            "categories": [{"Category": "Pouches de nicotina", "Status": "trabaja"}]
        }).json()
        cat_id = cats[0]["PdvProductCategoryId"]
        resp = client.patch(
            f"/pdvs/{pdv['PdvId']}/product-categories/{cat_id}",
            json={"Status": "trabajaba"},
        )
        assert resp.status_code == 200
        assert resp.json()["Status"] == "trabajaba"

    def test_invalid_category_rejected(self, client, pdv):
        resp = client.put(f"/pdvs/{pdv['PdvId']}/product-categories", json={
            "categories": [{"Category": "Invalida", "Status": "trabaja"}]
        })
        assert resp.status_code == 400

    def test_invalid_status_rejected(self, client, pdv):
        resp = client.put(f"/pdvs/{pdv['PdvId']}/product-categories", json={
            "categories": [{"Category": "Cigarrillos", "Status": "invalido"}]
        })
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Visit Coverage (Step 10)
# ---------------------------------------------------------------------------

class TestVisitCoverage:
    def _make_products(self, client):
        p1 = client.post("/products", json={"Name": f"CovP1_{_uid()}", "Category": "Cigarrillos", "IsOwn": True}).json()
        p2 = client.post("/products", json={"Name": f"CovP2_{_uid()}", "Category": "Cigarrillos", "IsOwn": False}).json()
        return p1, p2

    def test_bulk_save_coverage(self, client, visit):
        p1, p2 = self._make_products(client)
        resp = client.put(f"/visits/{visit['VisitId']}/coverage", json={
            "items": [
                {"ProductId": p1["ProductId"], "Works": True, "Price": 1500.50, "Availability": "disponible"},
                {"ProductId": p2["ProductId"], "Works": False},
            ]
        })
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 2
        working = [i for i in items if i["Works"]][0]
        assert float(working["Price"]) == 1500.50
        assert working["Availability"] == "disponible"

    def test_bulk_save_replaces_previous(self, client, visit):
        p1, p2 = self._make_products(client)
        client.put(f"/visits/{visit['VisitId']}/coverage", json={
            "items": [
                {"ProductId": p1["ProductId"], "Works": True, "Price": 1000},
                {"ProductId": p2["ProductId"], "Works": True, "Price": 2000},
            ]
        })
        # Save again with only 1 item
        resp = client.put(f"/visits/{visit['VisitId']}/coverage", json={
            "items": [{"ProductId": p1["ProductId"], "Works": False}]
        })
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_list_coverage(self, client, visit):
        p1, _ = self._make_products(client)
        client.put(f"/visits/{visit['VisitId']}/coverage", json={
            "items": [{"ProductId": p1["ProductId"], "Works": True, "Price": 500}]
        })
        resp = client.get(f"/visits/{visit['VisitId']}/coverage")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_coverage_clears_price_when_not_working(self, client, visit):
        p1, _ = self._make_products(client)
        resp = client.put(f"/visits/{visit['VisitId']}/coverage", json={
            "items": [{"ProductId": p1["ProductId"], "Works": False, "Price": 999, "Availability": "disponible"}]
        })
        item = resp.json()[0]
        assert item["Works"] is False
        assert item["Price"] is None
        assert item["Availability"] is None

    def test_cannot_save_coverage_on_closed_visit(self, client, pdv, user):
        v = _make_visit(client, pdv["PdvId"], user["UserId"])
        client.patch(f"/visits/{v['VisitId']}", json={"Status": "CLOSED"})
        p1, _ = self._make_products(client)
        resp = client.put(f"/visits/{v['VisitId']}/coverage", json={
            "items": [{"ProductId": p1["ProductId"], "Works": True}]
        })
        assert resp.status_code == 400

    def test_coverage_diff_endpoint(self, client, pdv, user):
        p1, p2 = self._make_products(client)
        # First visit - close it
        v1 = _make_visit(client, pdv["PdvId"], user["UserId"])
        client.put(f"/visits/{v1['VisitId']}/coverage", json={
            "items": [
                {"ProductId": p1["ProductId"], "Works": True, "Price": 1000, "Availability": "disponible"},
                {"ProductId": p2["ProductId"], "Works": False},
            ]
        })
        client.patch(f"/visits/{v1['VisitId']}", json={"Status": "CLOSED"})

        # Second visit
        v2 = _make_visit(client, pdv["PdvId"], user["UserId"])
        client.put(f"/visits/{v2['VisitId']}/coverage", json={
            "items": [
                {"ProductId": p1["ProductId"], "Works": True, "Price": 1200, "Availability": "disponible"},
                {"ProductId": p2["ProductId"], "Works": True, "Price": 800, "Availability": "quiebre"},
            ]
        })

        resp = client.get(f"/visits/{v2['VisitId']}/coverage/diff")
        assert resp.status_code == 200
        diffs = resp.json()
        assert len(diffs) == 2
        p1_diff = [d for d in diffs if d["ProductId"] == p1["ProductId"]][0]
        assert float(p1_diff["Price"]) == 1200
        assert float(p1_diff["PrevPrice"]) == 1000
        p2_diff = [d for d in diffs if d["ProductId"] == p2["ProductId"]][0]
        assert p2_diff["Works"] is True
        assert p2_diff["PrevWorks"] is False


# ---------------------------------------------------------------------------
# Visit POP Census (Step 11)
# ---------------------------------------------------------------------------

class TestVisitPOP:
    def test_bulk_save_pop(self, client, visit):
        resp = client.put(f"/visits/{visit['VisitId']}/pop", json={
            "items": [
                {"MaterialType": "primario", "MaterialName": "Cigarrera aérea", "Company": "Espert", "Present": True, "HasPrice": True},
                {"MaterialType": "primario", "MaterialName": "Cigarrera de espalda", "Company": "Massalin", "Present": True, "HasPrice": False},
                {"MaterialType": "secundario", "MaterialName": "Stopper", "Company": "BAT", "Present": False},
            ]
        })
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 3

    def test_bulk_save_replaces_previous(self, client, visit):
        client.put(f"/visits/{visit['VisitId']}/pop", json={
            "items": [
                {"MaterialType": "primario", "MaterialName": "Cigarrera aérea", "Company": "Espert", "Present": True},
                {"MaterialType": "secundario", "MaterialName": "Afiche", "Company": "BAT", "Present": True},
            ]
        })
        resp = client.put(f"/visits/{visit['VisitId']}/pop", json={
            "items": [
                {"MaterialType": "primario", "MaterialName": "Display", "Company": "Espert", "Present": True},
            ]
        })
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_list_pop(self, client, visit):
        client.put(f"/visits/{visit['VisitId']}/pop", json={
            "items": [
                {"MaterialType": "secundario", "MaterialName": "Exhibidor", "Company": "Espert", "Present": True, "HasPrice": True},
            ]
        })
        resp = client.get(f"/visits/{visit['VisitId']}/pop")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["MaterialName"] == "Exhibidor"

    def test_invalid_material_type_rejected(self, client, visit):
        resp = client.put(f"/visits/{visit['VisitId']}/pop", json={
            "items": [
                {"MaterialType": "invalido", "MaterialName": "Test", "Present": False},
            ]
        })
        assert resp.status_code == 400

    def test_cannot_save_pop_on_closed_visit(self, client, pdv, user):
        v = _make_visit(client, pdv["PdvId"], user["UserId"])
        client.patch(f"/visits/{v['VisitId']}", json={"Status": "CLOSED"})
        resp = client.put(f"/visits/{v['VisitId']}/pop", json={
            "items": [{"MaterialType": "primario", "MaterialName": "Test", "Present": True}]
        })
        assert resp.status_code == 400

    def test_pop_item_has_all_fields(self, client, visit):
        resp = client.put(f"/visits/{visit['VisitId']}/pop", json={
            "items": [
                {"MaterialType": "primario", "MaterialName": "Pantalla / Display", "Company": "TABSA", "Present": True, "HasPrice": False},
            ]
        })
        item = resp.json()[0]
        assert "VisitPOPItemId" in item
        assert item["MaterialType"] == "primario"
        assert item["MaterialName"] == "Pantalla / Display"
        assert item["Company"] == "TABSA"
        assert item["Present"] is True
        assert item["HasPrice"] is False
