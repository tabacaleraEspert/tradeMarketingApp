"""Rutas de campaña + fecha de fin de ruta (2026-09-30).

Campaña: ruta temporal que usa PDVs de otras rutas sin quitárselos, asignable a
cualquier trade, sin cambiar el dueño del PDV, nunca foco, solo admin.
Fecha de fin: no se generan días después; vencida = inactiva (route_is_live).
"""
import json
import uuid
from datetime import date, timedelta

from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import AuditEvent, PDV as PDVModel, Route as RouteModel
from app.models.route import today_ar
from app.routers.routes import monthly_dates
from app.services.kpi_engine import focus_universe


def _uid():
    return uuid.uuid4().hex[:8]


def _login(client, email, password="Pass123!"):
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _user(client, role, manager_id=None):
    email = f"camp_{role}_{_uid()}@test.com"
    payload = {"Email": email, "DisplayName": email, "Password": "Pass123!", "RoleName": role}
    if manager_id is not None:
        payload["ManagerUserId"] = manager_id
    resp = client.post("/users", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _pdv(client):
    ch = client.post("/channels", json={"Name": f"CampCh_{_uid()}"}).json()
    resp = client.post("/pdvs", json={"Name": f"CampPDV_{_uid()}", "ChannelId": ch["ChannelId"], "IsActive": True})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _route(client, assigned, route_type="regular", end=None, start=None, headers=None, expect=201):
    payload = {"Name": f"R_{_uid()}", "IsActive": True, "AssignedUserId": assigned, "RouteType": route_type}
    if end is not None:
        payload["EndDate"] = end.isoformat()
    if start is not None:
        payload["FrequencyType"] = "weekly"
        payload["FrequencyConfig"] = json.dumps({"day": 1, "startDate": start.isoformat()})
    resp = client.post("/routes", json=payload, headers=headers or {})
    assert resp.status_code == expect, resp.text
    return resp.json()


def _db():
    return sessionmaker(bind=engine)()


TODAY = today_ar()
IN_A_MONTH = TODAY + timedelta(days=30)


# ---------------------------------------------------------------------------
# Escenario del pedido: PDV de Carlos en campaña de Jaimito
# ---------------------------------------------------------------------------

def test_campana_usa_pdv_de_otra_ruta_sin_cambiar_dueno(client):
    carlos, jaimito = _user(client, "vendedor"), _user(client, "vendedor")
    pdv = _pdv(client)
    regular = _route(client, carlos["UserId"])
    assert client.post(f"/routes/{regular['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1}).status_code == 201

    camp = _route(client, jaimito["UserId"], "campaign", end=IN_A_MONTH)
    assert camp["RouteType"] == "campaign" and camp["IsFocus"] is False
    r = client.post(f"/routes/{camp['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1})
    assert r.status_code == 201, r.text

    db = _db()
    assert db.get(PDVModel, pdv["PdvId"]).AssignedUserId == carlos["UserId"]  # dueño intacto
    db.close()

    # Jaimito ve el PDV (por la campaña) y Carlos también (es suyo).
    assert client.get(f"/pdvs/{pdv['PdvId']}", headers=_login(client, jaimito["Email"])).status_code == 200
    assert client.get(f"/pdvs/{pdv['PdvId']}", headers=_login(client, carlos["Email"])).status_code == 200

    # Reasignar la campaña tampoco toca al dueño.
    otro = _user(client, "vendedor")
    assert client.patch(f"/routes/{camp['RouteId']}", json={"AssignedUserId": otro["UserId"]}).status_code == 200
    db = _db()
    assert db.get(PDVModel, pdv["PdvId"]).AssignedUserId == carlos["UserId"]
    db.close()


def test_exclusividad_entre_regulares_se_mantiene(client):
    a, b = _user(client, "vendedor"), _user(client, "vendedor")
    pdv = _pdv(client)
    r1, r2 = _route(client, a["UserId"]), _route(client, b["UserId"])
    assert client.post(f"/routes/{r1['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1}).status_code == 201
    r = client.post(f"/routes/{r2['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1})
    assert r.status_code == 409 and r1["Name"] in r.json()["detail"]
    # Re-agregar a la MISMA ruta = reordenar, no 409.
    assert client.post(f"/routes/{r1['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 5}).status_code == 201


def test_campana_no_bloquea_a_una_regular(client):
    a, b = _user(client, "vendedor"), _user(client, "vendedor")
    pdv = _pdv(client)
    camp = _route(client, a["UserId"], "campaign", end=IN_A_MONTH)
    assert client.post(f"/routes/{camp['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1}).status_code == 201
    reg = _route(client, b["UserId"])
    assert client.post(f"/routes/{reg['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1}).status_code == 201
    assignments = [x for x in client.get("/routes/pdv-assignments").json() if x["pdvId"] == pdv["PdvId"]]
    assert {x["routeType"] for x in assignments} == {"campaign", "regular"}


def test_campana_vencida_deja_de_dar_visibilidad(client):
    carlos, jaimito = _user(client, "vendedor"), _user(client, "vendedor")
    pdv = _pdv(client)
    reg = _route(client, carlos["UserId"])
    client.post(f"/routes/{reg['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1})
    camp = _route(client, jaimito["UserId"], "campaign", end=IN_A_MONTH)
    client.post(f"/routes/{camp['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1})
    h = _login(client, jaimito["Email"])
    assert client.get(f"/pdvs/{pdv['PdvId']}", headers=h).status_code == 200
    mine = client.get(f"/routes/my-routes-detail?user_id={jaimito['UserId']}", headers=h).json()
    assert [r["RouteType"] for r in mine] == ["campaign"]

    db = _db()
    db.get(RouteModel, camp["RouteId"]).EndDate = TODAY - timedelta(days=1)
    db.commit()
    db.close()
    assert client.get(f"/pdvs/{pdv['PdvId']}", headers=h).status_code == 403
    assert client.get(f"/routes/my-routes-detail?user_id={jaimito['UserId']}", headers=h).json() == []


# ---------------------------------------------------------------------------
# Permisos y validaciones
# ---------------------------------------------------------------------------

def test_solo_admin_crea_y_edita_campanas(client):
    rm = _user(client, "regional_manager")
    trade = _user(client, "vendedor", manager_id=rm["UserId"])
    h = _login(client, rm["Email"])
    _route(client, trade["UserId"], "campaign", end=IN_A_MONTH, headers=h, expect=403)
    camp = _route(client, trade["UserId"], "campaign", end=IN_A_MONTH)
    assert client.patch(f"/routes/{camp['RouteId']}", json={"Name": "x"}, headers=h).status_code == 403
    assert client.delete(f"/routes/{camp['RouteId']}", headers=h).status_code == 403
    pdv = _pdv(client)
    assert client.post(f"/routes/{camp['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1}, headers=h).status_code == 403
    # Pero el manager sigue creando regulares como siempre.
    _route(client, trade["UserId"], headers=h)


def test_admin_asigna_campana_a_cualquier_trade(client):
    """Sin restricción de sub-árbol: cualquier vendedor, tenga o no jefe."""
    huerfano = _user(client, "vendedor")
    camp = _route(client, huerfano["UserId"], "campaign", end=IN_A_MONTH)
    assert camp["AssignedUserId"] == huerfano["UserId"]


def test_validaciones_de_campana_y_fecha_fin(client):
    t = _user(client, "vendedor")
    r = client.post("/routes", json={"Name": "sin fin", "AssignedUserId": t["UserId"], "RouteType": "campaign"})
    assert r.status_code == 400 and "fecha de fin" in r.json()["detail"]
    _route(client, t["UserId"], end=TODAY, start=TODAY + timedelta(days=5), expect=400)  # fin < inicio
    camp = _route(client, t["UserId"], "campaign", end=IN_A_MONTH)
    # El tipo no cambia; la campaña no puede volverse foco.
    assert client.patch(f"/routes/{camp['RouteId']}", json={"RouteType": "regular"}).status_code == 400
    assert client.patch(f"/routes/{camp['RouteId']}", json={"IsFocus": True}).json()["IsFocus"] is False
    assert client.patch(f"/routes/{camp['RouteId']}", json={"EndDate": None}).status_code == 400


# ---------------------------------------------------------------------------
# Fecha de fin (cualquier ruta)
# ---------------------------------------------------------------------------

def test_no_se_crean_dias_despues_de_la_fecha_fin_y_acortar_borra(client):
    t = _user(client, "vendedor")
    reg = _route(client, t["UserId"])
    for d in (TODAY + timedelta(days=2), TODAY + timedelta(days=10), TODAY + timedelta(days=20)):
        assert client.post(f"/routes/{reg['RouteId']}/days", json={"WorkDate": d.isoformat()}).status_code == 201
    r = client.patch(f"/routes/{reg['RouteId']}", json={"EndDate": (TODAY + timedelta(days=12)).isoformat()})
    assert r.status_code == 200 and r.json()["EndDate"] == (TODAY + timedelta(days=12)).isoformat()
    days = sorted(d["WorkDate"] for d in client.get(f"/routes/{reg['RouteId']}/days").json())
    assert days == [(TODAY + timedelta(days=2)).isoformat(), (TODAY + timedelta(days=10)).isoformat()]
    r = client.post(f"/routes/{reg['RouteId']}/days", json={"WorkDate": (TODAY + timedelta(days=13)).isoformat()})
    assert r.status_code == 400 and "termina" in r.json()["detail"]


def test_ruta_vencida_sale_del_universo_foco(client):
    t = _user(client, "vendedor")
    pdv = _pdv(client)
    reg = _route(client, t["UserId"])
    client.post(f"/routes/{reg['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1})
    db = _db()
    assert pdv["PdvId"] in focus_universe(db, t["UserId"], TODAY.year, TODAY.month)
    db.get(RouteModel, reg["RouteId"]).EndDate = TODAY - timedelta(days=1)
    db.commit()
    assert pdv["PdvId"] not in focus_universe(db, t["UserId"], TODAY.year, TODAY.month)
    db.close()


def test_campana_fuera_del_universo_foco(client):
    t = _user(client, "vendedor")
    pdv = _pdv(client)
    camp = _route(client, t["UserId"], "campaign", end=IN_A_MONTH)
    client.post(f"/routes/{camp['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1})
    db = _db()
    assert pdv["PdvId"] not in focus_universe(db, t["UserId"], TODAY.year, TODAY.month)
    db.close()


def test_auditoria_de_rutas(client):
    t = _user(client, "vendedor")
    camp = _route(client, t["UserId"], "campaign", end=IN_A_MONTH)
    pdv = _pdv(client)
    client.post(f"/routes/{camp['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1})
    client.patch(f"/routes/{camp['RouteId']}", json={"Name": "Verano 2027"})
    db = _db()
    ev = db.query(AuditEvent).filter(AuditEvent.Entity == "Route", AuditEvent.EntityId == str(camp["RouteId"])).order_by(AuditEvent.AuditEventId).all()
    assert [e.Action for e in ev] == ["ROUTE_CREATE", "ROUTE_PDV_ADD", "ROUTE_UPDATE"]
    upd = json.loads(ev[-1].PayloadJson)
    assert upd["despues"] == {"Name": "Verano 2027"} and list(upd["antes"]) == ["Name"]
    db.close()


# ---------------------------------------------------------------------------
# Frecuencia mensual (bug: no generaba días)
# ---------------------------------------------------------------------------

def test_monthly_dates():
    assert monthly_dates(date(2026, 10, 1), date(2027, 3, 31), "2026-10-31") == [
        date(2026, 10, 31), date(2026, 11, 30), date(2026, 12, 31), date(2027, 1, 31), date(2027, 2, 28), date(2027, 3, 31)]
    assert monthly_dates(date(2026, 10, 20), date(2026, 12, 31), "2026-09-15") == [date(2026, 11, 15), date(2026, 12, 15)]
    assert monthly_dates(date(2026, 9, 1), date(2026, 12, 31), "2026-10-10")[0] == date(2026, 10, 10)  # no antes del inicio


def test_trade_ejecuta_su_campana_pero_no_la_edita(client):
    jaimito = _user(client, "vendedor")
    pdv = _pdv(client)
    camp = _route(client, jaimito["UserId"], "campaign", end=IN_A_MONTH)
    client.post(f"/routes/{camp['RouteId']}/pdvs", json={"PdvId": pdv["PdvId"], "SortOrder": 1})
    day = client.post(f"/routes/{camp['RouteId']}/days", json={"WorkDate": TODAY.isoformat()}).json()
    h = _login(client, jaimito["Email"])
    r = client.patch(f"/routes/days/{day['RouteDayId']}/pdvs/{pdv['PdvId']}", json={"ExecutionStatus": "DONE"}, headers=h)
    assert r.status_code == 200, r.text
    assert client.patch(f"/routes/{camp['RouteId']}", json={"Name": "mía"}, headers=h).status_code == 403
