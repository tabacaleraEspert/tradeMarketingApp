"""Regresión del bloqueante B1 (auditoría 2026-07-31).

Antes, POST/PATCH /routes usaban require_role("vendedor") sin validar propiedad:
cualquier vendedor podía editar cualquier ruta ajena (togglear IsFocus, reasignar
AssignedUserId, tocar sus PDVs). Estos tests cubren la corrección vía el helper
_assert_route_access en app/routers/routes.py.

Strategy: `client` fixture es admin. Se usa para sembrar usuarios/rutas/PDVs, y se
generan tokens explícitos por rol para probar los endpoints como vendedor / TM.
"""
import uuid


def _uid():
    return uuid.uuid4().hex[:8]


def _login(client, email, password="Pass123!"):
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _make_user_with_role(client, role_name, manager_id=None):
    email = f"own_{role_name}_{_uid()}@test.com"
    payload = {
        "Email": email,
        "DisplayName": email,
        "Password": "Pass123!",
        "RoleName": role_name,
    }
    if manager_id is not None:
        payload["ManagerUserId"] = manager_id
    resp = client.post("/users", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_route(client, name=None, assigned_user_id=None):
    payload = {"Name": name or f"OwnRoute_{_uid()}", "IsActive": True}
    if assigned_user_id is not None:
        payload["AssignedUserId"] = assigned_user_id
    resp = client.post("/routes", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_channel(client):
    resp = client.post("/channels", json={"Name": f"OwnCh_{_uid()}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_pdv(client, channel_id):
    resp = client.post("/pdvs", json={"Name": f"OwnPDV_{_uid()}", "ChannelId": channel_id, "IsActive": True})
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Vendedor: sólo sus propias rutas, sin tocar IsFocus/AssignedUserId
# ---------------------------------------------------------------------------

def test_vendedor_cannot_edit_foreign_route(client):
    """Caso exacto de la auditoría: un vendedor no puede editar la ruta de otro vendedor."""
    carlos = _make_user_with_role(client, "vendedor")
    lucia = _make_user_with_role(client, "vendedor")
    route = _make_route(client, assigned_user_id=lucia["UserId"])
    token = _login(client, carlos["Email"])
    resp = client.patch(f"/routes/{route['RouteId']}", json={"Name": "Hackeada"}, headers=_auth(token))
    assert resp.status_code == 403, resp.text


def test_vendedor_can_edit_own_route_without_sensitive_fields(client):
    carlos = _make_user_with_role(client, "vendedor")
    route = _make_route(client, assigned_user_id=carlos["UserId"])
    token = _login(client, carlos["Email"])
    resp = client.patch(f"/routes/{route['RouteId']}", json={"Name": "Nombre actualizado"}, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["Name"] == "Nombre actualizado"


def test_vendedor_resending_same_sensitive_values_is_allowed(client):
    """RouteEditorPage (my-routes/:id/edit) siempre reenvía IsFocus/AssignedUserId sin
    cambios porque esos controles están ocultos para vendedor — no debe bloquear."""
    carlos = _make_user_with_role(client, "vendedor")
    route = _make_route(client, assigned_user_id=carlos["UserId"])
    token = _login(client, carlos["Email"])
    resp = client.patch(
        f"/routes/{route['RouteId']}",
        json={"IsFocus": route["IsFocus"], "AssignedUserId": carlos["UserId"]},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text


def test_vendedor_cannot_change_isfocus_on_own_route(client):
    carlos = _make_user_with_role(client, "vendedor")
    route = _make_route(client, assigned_user_id=carlos["UserId"])
    token = _login(client, carlos["Email"])
    resp = client.patch(
        f"/routes/{route['RouteId']}", json={"IsFocus": not route["IsFocus"]}, headers=_auth(token)
    )
    assert resp.status_code == 403, resp.text


def test_vendedor_cannot_reassign_own_route(client):
    carlos = _make_user_with_role(client, "vendedor")
    otro = _make_user_with_role(client, "vendedor")
    route = _make_route(client, assigned_user_id=carlos["UserId"])
    token = _login(client, carlos["Email"])
    resp = client.patch(
        f"/routes/{route['RouteId']}", json={"AssignedUserId": otro["UserId"]}, headers=_auth(token)
    )
    assert resp.status_code == 403, resp.text


def test_vendedor_cannot_create_route_for_other_user(client):
    carlos = _make_user_with_role(client, "vendedor")
    otro = _make_user_with_role(client, "vendedor")
    token = _login(client, carlos["Email"])
    resp = client.post(
        "/routes", json={"Name": "Para otro", "AssignedUserId": otro["UserId"]}, headers=_auth(token)
    )
    assert resp.status_code == 403, resp.text


def test_vendedor_can_create_own_route(client):
    carlos = _make_user_with_role(client, "vendedor")
    token = _login(client, carlos["Email"])
    resp = client.post(
        "/routes", json={"Name": "Mi ruta", "AssignedUserId": carlos["UserId"]}, headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text


def test_vendedor_create_route_forces_is_focus_false(client):
    """RouteGeneratorPage no manda IsFocus (queda en el default True del schema) y
    RouteEditorPage en modo "Mi ruta" oculta el control pero igual reenvía True —
    ninguno de los dos flujos de modo campo debe poder dejar a un vendedor con una
    ruta foco propia, así que el backend fuerza el valor efectivo a False al crear."""
    carlos = _make_user_with_role(client, "vendedor")
    token = _login(client, carlos["Email"])
    resp = client.post(
        "/routes",
        json={"Name": "Mi ruta foco?", "AssignedUserId": carlos["UserId"], "IsFocus": True},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["IsFocus"] is False


def test_vendedor_cannot_add_pdv_to_foreign_route(client):
    carlos = _make_user_with_role(client, "vendedor")
    lucia = _make_user_with_role(client, "vendedor")
    route = _make_route(client, assigned_user_id=lucia["UserId"])
    channel = _make_channel(client)
    pdv = _make_pdv(client, channel["ChannelId"])
    token = _login(client, carlos["Email"])
    resp = client.post(
        f"/routes/{route['RouteId']}/pdvs",
        json={"PdvId": pdv["PdvId"], "SortOrder": 0, "Priority": 3},
        headers=_auth(token),
    )
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Territory manager / supervisor: sólo su sub-árbol
# ---------------------------------------------------------------------------

def test_territory_manager_can_edit_subordinate_route(client):
    tm = _make_user_with_role(client, "territory_manager")
    rep = _make_user_with_role(client, "vendedor", manager_id=tm["UserId"])
    route = _make_route(client, assigned_user_id=rep["UserId"])
    token = _login(client, tm["Email"])
    resp = client.patch(f"/routes/{route['RouteId']}", json={"IsFocus": False}, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["IsFocus"] is False


def test_territory_manager_cannot_edit_non_subordinate_route(client):
    tm = _make_user_with_role(client, "territory_manager")
    stranger = _make_user_with_role(client, "vendedor")  # sin relación de jerarquía con tm
    route = _make_route(client, assigned_user_id=stranger["UserId"])
    token = _login(client, tm["Email"])
    resp = client.patch(f"/routes/{route['RouteId']}", json={"Name": "x"}, headers=_auth(token))
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# RouteDay endpoints: _assert_route_access reemplaza al viejo _check_route_access
# (que dejaba pasar a cualquier territory_manager/regional_manager sin chequear
# sub-árbol, y rechazaba supervisor/ejecutivo directamente)
# ---------------------------------------------------------------------------

def test_supervisor_can_create_route_day_for_subordinate(client):
    sup = _make_user_with_role(client, "supervisor")
    rep = _make_user_with_role(client, "vendedor", manager_id=sup["UserId"])
    route = _make_route(client, assigned_user_id=rep["UserId"])
    token = _login(client, sup["Email"])
    resp = client.post(
        f"/routes/{route['RouteId']}/days", json={"WorkDate": "2026-09-01"}, headers=_auth(token)
    )
    assert resp.status_code == 201, resp.text


def test_supervisor_cannot_create_route_day_for_non_subordinate(client):
    sup = _make_user_with_role(client, "supervisor")
    stranger = _make_user_with_role(client, "vendedor")
    route = _make_route(client, assigned_user_id=stranger["UserId"])
    token = _login(client, sup["Email"])
    resp = client.post(
        f"/routes/{route['RouteId']}/days", json={"WorkDate": "2026-09-01"}, headers=_auth(token)
    )
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# RouteDayPdv: 404 si el RouteDay padre no existe (antes insertaba igual)
# ---------------------------------------------------------------------------

def test_add_route_day_pdv_404_if_route_day_missing(client):
    resp = client.post(
        "/routes/days/999999/pdvs",
        json={"RouteDayId": 999999, "PdvId": 1, "PlannedOrder": 0},
    )
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Admin: sin restricciones
# ---------------------------------------------------------------------------

def test_admin_has_no_restrictions(client):
    someone = _make_user_with_role(client, "vendedor")
    route = _make_route(client, assigned_user_id=someone["UserId"])
    resp = client.patch(f"/routes/{route['RouteId']}", json={"IsFocus": False})
    assert resp.status_code == 200, resp.text
    assert resp.json()["IsFocus"] is False
