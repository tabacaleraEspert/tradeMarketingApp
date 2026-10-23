"""Excepción activadores (VisitFlow short, ej. La Plata 22/10/2026): arrancar hoy una
campaña de su zona sin día planificado y sumarle PDVs dados de alta en el recorrido.
El ciclo común (VisitFlow full) sigue con las reglas de campaña (solo admin)."""
import uuid
from datetime import timedelta

from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import Route as RouteModel, User as UserModel, Zone as ZoneModel
from app.models.route import RouteDay, RouteDayPdv, today_ar

TODAY = today_ar()


def _uid():
    return uuid.uuid4().hex[:8]


def _db():
    return sessionmaker(bind=engine)()


def _login(client, email):
    resp = client.post("/auth/login", json={"email": email, "password": "Pass123!"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _user(client, zone_id, flow="short"):
    email = f"act_{_uid()}@test.com"
    resp = client.post("/users", json={"Email": email, "DisplayName": email, "Password": "Pass123!", "RoleName": "vendedor"})
    assert resp.status_code == 201, resp.text
    db = _db()
    u = db.get(UserModel, resp.json()["UserId"])
    u.VisitFlow, u.ZoneId = flow, zone_id
    db.commit()
    db.close()
    return {**resp.json(), "Email": email}


def _zone():
    db = _db()
    z = ZoneModel(Name=f"Z_{_uid()}")
    db.add(z)
    db.commit()
    zid = z.ZoneId
    db.close()
    return zid


def _pdv(client):
    ch = client.post("/channels", json={"Name": f"ActCh_{_uid()}"}).json()
    return client.post("/pdvs", json={"Name": f"ActPDV_{_uid()}", "ChannelId": ch["ChannelId"], "IsActive": True}).json()


def _campaign(client, assigned, zone_id, pdvs=(), route_type="campaign"):
    payload = {"Name": f"C_{_uid()}", "IsActive": True, "AssignedUserId": assigned, "RouteType": route_type,
               "EndDate": (TODAY + timedelta(days=30)).isoformat()}
    r = client.post("/routes", json=payload)
    assert r.status_code == 201, r.text
    rid = r.json()["RouteId"]
    db = _db()
    db.get(RouteModel, rid).ZoneId = zone_id
    db.commit()
    db.close()
    for i, p in enumerate(pdvs, 1):
        assert client.post(f"/routes/{rid}/pdvs", json={"PdvId": p["PdvId"], "SortOrder": i}).status_code == 201
    return rid


def test_start_today_crea_dia_idempotente_para_quien_arranca(client):
    zone = _zone()
    christian, pablo = _user(client, zone), _user(client, zone)
    p1, p2 = _pdv(client), _pdv(client)
    rid = _campaign(client, christian["UserId"], zone, [p1, p2])

    h = _login(client, christian["Email"])
    r1 = client.post(f"/routes/{rid}/start-today", headers=h)
    assert r1.status_code == 200, r1.text
    r2 = client.post(f"/routes/{rid}/start-today", headers=h)
    assert r2.json()["RouteDayId"] == r1.json()["RouteDayId"]
    assert r1.json()["WorkDate"] == TODAY.isoformat()

    # Pablo (misma zona) la arranca con su propio día
    rp = client.post(f"/routes/{rid}/start-today", headers=_login(client, pablo["Email"]))
    assert rp.status_code == 200 and rp.json()["AssignedUserId"] == pablo["UserId"]

    db = _db()
    n = db.query(RouteDayPdv).filter(RouteDayPdv.RouteDayId == r1.json()["RouteDayId"]).count()
    days = db.query(RouteDay).filter(RouteDay.RouteId == rid).count()
    db.close()
    assert n == 2 and days == 2

    # aparece en el día de hoy (Inicio / Ruta foco)
    det = client.get("/routes/day-detail", params={"date": TODAY.isoformat(), "user_id": pablo["UserId"]}).json()
    assert {d["PdvId"] for d in det} == {p1["PdvId"], p2["PdvId"]}


def test_my_routes_incluye_campanas_de_la_zona_solo_en_short(client):
    zone = _zone()
    christian, pablo = _user(client, zone), _user(client, zone)
    trade = _user(client, zone, flow="full")
    rid = _campaign(client, christian["UserId"], zone)
    ids = lambda u: {r["RouteId"] for r in client.get("/routes/my-routes-detail", params={"user_id": u["UserId"]}).json()}  # noqa: E731
    assert rid in ids(pablo)
    assert rid not in ids(trade)


def test_bloqueos_ciclo_comun_y_fuera_de_zona(client):
    zone, other_zone = _zone(), _zone()
    christian = _user(client, zone)
    trade = _user(client, zone, flow="full")
    outsider = _user(client, other_zone)
    camp = _campaign(client, christian["UserId"], zone)
    regular = _campaign(client, christian["UserId"], zone, route_type="regular")

    assert client.post(f"/routes/{camp}/start-today", headers=_login(client, trade["Email"])).status_code == 403
    assert client.post(f"/routes/{camp}/start-today", headers=_login(client, outsider["Email"])).status_code == 403
    assert client.post(f"/routes/{regular}/start-today", headers=_login(client, christian["Email"])).status_code == 403
    # el trade común sigue sin poder tocar PDVs de campañas
    p = _pdv(client)
    r = client.post(f"/routes/{camp}/pdvs", json={"PdvId": p["PdvId"], "SortOrder": 1}, headers=_login(client, trade["Email"]))
    assert r.status_code == 403


def test_alta_en_recorrido_suma_pdv_a_campana_y_al_dia_de_hoy(client):
    zone = _zone()
    christian, pablo = _user(client, zone), _user(client, zone)
    rid = _campaign(client, christian["UserId"], zone, [_pdv(client)])
    hp = _login(client, pablo["Email"])
    day = client.post(f"/routes/{rid}/start-today", headers=hp).json()

    nuevo = _pdv(client)
    r = client.post(f"/routes/{rid}/pdvs", json={"PdvId": nuevo["PdvId"], "SortOrder": 999, "Priority": 3}, headers=hp)
    assert r.status_code == 201, r.text
    db = _db()
    assert db.query(RouteDayPdv).filter(RouteDayPdv.RouteDayId == day["RouteDayId"], RouteDayPdv.PdvId == nuevo["PdvId"]).count() == 1
    db.close()


def test_relocate_pdv_solo_activador_y_auditado(client):
    from app.models import AuditEvent
    zone = _zone()
    christian, trade = _user(client, zone), _user(client, zone, flow="full")
    p = _pdv(client)
    body = {"Lat": -34.9214, "Lon": -57.9545, "AccuracyM": 12}
    assert client.post(f"/pdvs/{p['PdvId']}/relocate", json=body, headers=_login(client, trade["Email"])).status_code == 403
    hc = _login(client, christian["Email"])
    assert client.post(f"/pdvs/{p['PdvId']}/relocate", json={**body, "AccuracyM": 120}, headers=hc).status_code == 400
    r = client.post(f"/pdvs/{p['PdvId']}/relocate", json=body, headers=hc)
    assert r.status_code == 200, r.text
    assert abs(float(r.json()["Lat"]) - body["Lat"]) < 1e-5
    db = _db()
    assert db.query(AuditEvent).filter(AuditEvent.Entity == "PDV", AuditEvent.EntityId == str(p["PdvId"]), AuditEvent.Action == "PDV_RELOCATE").count() == 1
    db.close()
