"""Visita corta por usuario (2026-10-19): User.VisitFlow + GET /routes/my-forms.

VisitFlow: "full" (7 pasos, default) | "short" (check-in → formulario → resumen).
/routes/my-forms: forms activos de las rutas VIGENTES asignadas al usuario actual,
sin filtro por creador (un vendedor ve los forms que armó el admin), sin duplicados.
"""
import uuid
from datetime import timedelta

from app.models.route import today_ar


def _uid():
    return uuid.uuid4().hex[:8]


def _login(client, email, password="Pass123!"):
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _headers(login_json):
    return {"Authorization": f"Bearer {login_json['access_token']}"}


def _user(client, role="vendedor", **extra):
    email = f"vf_{role}_{_uid()}@test.com"
    payload = {"Email": email, "DisplayName": email, "Password": "Pass123!", "RoleName": role, **extra}
    resp = client.post("/users", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _form(client, name=None, is_active=True):
    resp = client.post("/forms", json={"Name": name or f"F_{_uid()}", "IsActive": is_active, "Version": 1})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _route(client, assigned, route_type="regular", end=None, is_active=True):
    payload = {"Name": f"R_{_uid()}", "IsActive": is_active, "AssignedUserId": assigned, "RouteType": route_type}
    if end is not None:
        payload["EndDate"] = end.isoformat()
    resp = client.post("/routes", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _link(client, route, form, sort_order=0):
    resp = client.post(f"/routes/{route['RouteId']}/forms", json={"FormId": form["FormId"], "SortOrder": sort_order})
    assert resp.status_code == 201, resp.text


TODAY = today_ar()


# ---------------------------------------------------------------------------
# User.VisitFlow
# ---------------------------------------------------------------------------

class TestVisitFlowField:
    def test_default_is_full(self, client):
        u = _user(client)
        assert u["VisitFlow"] == "full"
        assert client.get(f"/users/{u['UserId']}").json()["VisitFlow"] == "full"

    def test_create_with_short(self, client):
        u = _user(client, VisitFlow="short")
        assert u["VisitFlow"] == "short"

    def test_update_to_short_and_back(self, client):
        u = _user(client)
        r = client.patch(f"/users/{u['UserId']}", json={"VisitFlow": "short"})
        assert r.status_code == 200, r.text
        assert r.json()["VisitFlow"] == "short"
        # Un PATCH que no manda VisitFlow no lo pisa
        r = client.patch(f"/users/{u['UserId']}", json={"DisplayName": "Otro nombre"})
        assert r.json()["VisitFlow"] == "short"
        r = client.patch(f"/users/{u['UserId']}", json={"VisitFlow": "full"})
        assert r.json()["VisitFlow"] == "full"

    def test_invalid_value_rejected(self, client):
        u = _user(client)
        assert client.patch(f"/users/{u['UserId']}", json={"VisitFlow": "medium"}).status_code == 422
        assert client.post("/users", json={
            "Email": f"vf_bad_{_uid()}@test.com", "DisplayName": "x", "Password": "Pass123!", "VisitFlow": "x",
        }).status_code == 422

    def test_listed_in_users_list(self, client):
        u = _user(client, VisitFlow="short")
        listed = {x["UserId"]: x for x in client.get("/users").json()}
        assert listed[u["UserId"]]["VisitFlow"] == "short"

    def test_login_and_me_expose_visit_flow(self, client):
        u = _user(client, VisitFlow="short")
        login = _login(client, u["Email"])
        assert login["VisitFlow"] == "short"
        me = client.get("/auth/me", headers=_headers(login))
        assert me.status_code == 200
        assert me.json()["VisitFlow"] == "short"
        # /users/{id}/role también lo expone (el front refresca la sesión cacheada desde ahí)
        assert client.get(f"/users/{u['UserId']}/role").json()["visitFlow"] == "short"

    def test_login_default_full(self, client):
        u = _user(client)
        login = _login(client, u["Email"])
        assert login["VisitFlow"] == "full"
        assert client.get("/auth/me", headers=_headers(login)).json()["VisitFlow"] == "full"


# ---------------------------------------------------------------------------
# GET /routes/my-forms
# ---------------------------------------------------------------------------

class TestMyForms:
    def test_only_forms_of_live_routes_assigned_to_me(self, client):
        me, other = _user(client, VisitFlow="short"), _user(client)
        f_live, f_campaign, f_expired, f_other, f_inactive_route, f_inactive_form = (
            _form(client, f"live_{_uid()}"), _form(client, f"camp_{_uid()}"), _form(client, f"exp_{_uid()}"),
            _form(client, f"other_{_uid()}"), _form(client, f"inroute_{_uid()}"), _form(client, f"inform_{_uid()}", is_active=False),
        )
        # Regular vigente sin fecha de fin
        _link(client, _route(client, me["UserId"]), f_live, sort_order=5)
        # Campaña vigente (vence en un mes) — creada por admin, la ve el vendedor igual
        _link(client, _route(client, me["UserId"], "campaign", end=TODAY + timedelta(days=30)), f_campaign, sort_order=1)
        # Vencida por EndDate → NO
        _link(client, _route(client, me["UserId"], "campaign", end=TODAY - timedelta(days=1)), f_expired)
        # De otro usuario → NO
        _link(client, _route(client, other["UserId"]), f_other)
        # Ruta inactiva → NO
        _link(client, _route(client, me["UserId"], is_active=False), f_inactive_route)
        # Form inactivo en ruta vigente → NO
        _link(client, _route(client, me["UserId"]), f_inactive_form)

        resp = client.get("/routes/my-forms", headers=_headers(_login(client, me["Email"])))
        assert resp.status_code == 200, resp.text
        ids = [f["FormId"] for f in resp.json()]
        # Orden por SortOrder (campaña=1 antes que live=5)
        assert ids == [f_campaign["FormId"], f_live["FormId"]]
        names = {f["Name"] for f in resp.json()}
        assert names == {f_live["Name"], f_campaign["Name"]}
        assert resp.json()[0]["IsActive"] is True

    def test_no_duplicates_when_form_in_several_routes(self, client):
        me = _user(client)
        f = _form(client)
        _link(client, _route(client, me["UserId"]), f)
        _link(client, _route(client, me["UserId"], "campaign", end=TODAY + timedelta(days=10)), f)
        resp = client.get("/routes/my-forms", headers=_headers(_login(client, me["Email"])))
        assert [x["FormId"] for x in resp.json()] == [f["FormId"]]

    def test_empty_when_no_routes(self, client):
        me = _user(client)
        resp = client.get("/routes/my-forms", headers=_headers(_login(client, me["Email"])))
        assert resp.status_code == 200
        assert resp.json() == []

    def test_not_captured_by_route_id_path(self, client):
        # Declarado antes de GET /{route_id}: no debe dar 422 ("my-forms" no es int)
        assert client.get("/routes/my-forms").status_code == 200
