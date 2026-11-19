"""Tablero de control de rutas (2026-11-19): GET /routes/board, mover un día
(PATCH /routes/days/{id} con WorkDate / AssignedUserId), quitar un PDV de un día,
guarda de duplicados al crear días y cambio de día de la semana de toda la ruta."""
import json
import uuid
from datetime import timedelta

from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import AuditEvent, Route as RouteModel, RouteDay as RouteDayModel, RouteDayPdv as RouteDayPdvModel
from app.models.route import today_ar
from app.models.visit import Visit as VisitModel

TODAY = today_ar()
# Lunes de una semana enteramente futura (evita depender de qué día corre el test).
MONDAY = TODAY + timedelta(days=(7 - TODAY.weekday()) % 7 + 7)
SATURDAY = MONDAY + timedelta(days=5)


def _uid():
    return uuid.uuid4().hex[:8]


def _db():
    return sessionmaker(bind=engine)()


def _login(client, email, password="Pass123!"):
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _user(client, role="vendedor", manager_id=None):
    email = f"board_{role}_{_uid()}@test.com"
    payload = {"Email": email, "DisplayName": f"Board {role} {_uid()}", "Password": "Pass123!", "RoleName": role}
    if manager_id is not None:
        payload["ManagerUserId"] = manager_id
    resp = client.post("/users", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# Pocos usuarios compartidos por todo el módulo (cada test arma sus propias rutas y
# días): GET /users tiene tope 500 y test_users_list_perf depende de no pasarlo.
_POOL: dict[str, dict] = {}


def _team(client):
    """regional → mgr (territory_manager) → mine y mine2; other es un trade sin manager;
    outsider (territory_manager), ejecutivo y regional_out no tienen a nadie a cargo."""
    if not _POOL:
        _POOL["regional"] = _user(client, "regional_manager")
        _POOL["mgr"] = _user(client, "territory_manager", manager_id=_POOL["regional"]["UserId"])
        _POOL["ejecutivo"] = _user(client, "ejecutivo")
        _POOL["regional_out"] = _user(client, "regional_manager")
        _POOL["mine"] = _user(client, "vendedor", manager_id=_POOL["mgr"]["UserId"])
        _POOL["mine2"] = _user(client, "vendedor", manager_id=_POOL["mgr"]["UserId"])
        _POOL["other"] = _user(client, "vendedor")
        _POOL["outsider"] = _user(client, "territory_manager")
    return _POOL


def _trade(client):
    return _team(client)["other"]


def _pdv(client):
    ch = client.post("/channels", json={"Name": f"BoardCh_{_uid()}"}).json()
    resp = client.post("/pdvs", json={"Name": f"BoardPDV_{_uid()}", "ChannelId": ch["ChannelId"], "IsActive": True})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _route(client, assigned, pdvs=0, **kw):
    resp = client.post("/routes", json={"Name": f"BR_{_uid()}", "IsActive": True, "AssignedUserId": assigned, **kw})
    assert resp.status_code == 201, resp.text
    route = resp.json()
    route["pdvIds"] = []
    for i in range(pdvs):
        p = _pdv(client)
        r = client.post(f"/routes/{route['RouteId']}/pdvs", json={"PdvId": p["PdvId"], "SortOrder": i + 1})
        assert r.status_code == 201, r.text
        route["pdvIds"].append(p["PdvId"])
    return route


def _day(client, route_id, work_date, expect=201, **kw):
    resp = client.post(f"/routes/{route_id}/days", json={"WorkDate": work_date.isoformat(), **kw})
    assert resp.status_code == expect, resp.text
    return resp.json()


def _board(client, headers=None, date_from=MONDAY, date_to=SATURDAY):
    resp = client.get("/routes/board", params={"date_from": date_from.isoformat(), "date_to": date_to.isoformat()}, headers=headers or {})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _add_visit(day_id, pdv_id, user_id):
    db = _db()
    db.add(VisitModel(PdvId=pdv_id, UserId=user_id, RouteDayId=day_id, Status="OPEN"))
    db.commit()
    db.close()


def _audit_actions(route_id):
    db = _db()
    ev = db.query(AuditEvent).filter(AuditEvent.Entity == "Route", AuditEvent.EntityId == str(route_id)).order_by(AuditEvent.AuditEventId).all()
    out = [(e.Action, json.loads(e.PayloadJson)) for e in ev]
    db.close()
    return out


# ---------------------------------------------------------------------------
# GET /routes/board
# ---------------------------------------------------------------------------

def test_board_devuelve_trades_dias_y_rutas(client):
    mgr, t = _team(client)["mgr"], _team(client)["mine"]
    a = _route(client, t["UserId"], pdvs=2)
    b = _route(client, t["UserId"], pdvs=1, RouteType="campaign", EndDate=(MONDAY + timedelta(days=30)).isoformat())
    da = _day(client, a["RouteId"], MONDAY)
    _day(client, b["RouteId"], MONDAY)  # mismo trade, mismo día: permitido
    _day(client, a["RouteId"], MONDAY + timedelta(days=7))  # fuera del rango

    body = _board(client)
    rep = next(r for r in body["reps"] if r["userId"] == t["UserId"])
    assert rep["managerId"] == mgr["UserId"] and rep["managerName"] == mgr["DisplayName"] and rep["role"] == "vendedor"
    mine = [d for d in body["days"] if d["routeId"] in (a["RouteId"], b["RouteId"])]
    assert len(mine) == 2 and {d["workDate"] for d in mine} == {MONDAY.isoformat()}
    assert {d["userId"] for d in mine} == {t["UserId"]}
    by_route = {d["routeId"]: d for d in mine}
    assert by_route[a["RouteId"]]["pdvCount"] == 2 and by_route[a["RouteId"]]["routeDayId"] == da["RouteDayId"]
    assert by_route[a["RouteId"]]["hasVisits"] is False and by_route[a["RouteId"]]["locked"] is False
    assert by_route[b["RouteId"]]["routeType"] == "campaign"
    routes = {r["routeId"]: r for r in body["routes"]}
    assert routes[a["RouteId"]]["pdvCount"] == 2 and routes[a["RouteId"]]["isLive"] is True
    assert body["today"] == TODAY.isoformat()


def test_board_marca_visitas_y_avance(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=2)
    d = _day(client, r["RouteId"], MONDAY)
    _add_visit(d["RouteDayId"], r["pdvIds"][0], t["UserId"])
    client.patch(f"/routes/days/{d['RouteDayId']}/pdvs/{r['pdvIds'][0]}", json={"ExecutionStatus": "DONE"})
    row = next(x for x in _board(client)["days"] if x["routeDayId"] == d["RouteDayId"])
    assert row["hasVisits"] is True and row["locked"] is True and row["doneCount"] == 1 and row["pdvCount"] == 2


def test_board_dia_pasado_queda_bloqueado(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=1)
    past = TODAY - timedelta(days=3)
    d = _day(client, r["RouteId"], past)
    row = next(x for x in _board(client, date_from=past, date_to=past)["days"] if x["routeDayId"] == d["RouteDayId"])
    assert row["locked"] is True and row["hasVisits"] is False


def test_board_respeta_jerarquia_y_rol(client):
    team = _team(client)
    mgr, mine, other = team["mgr"], team["mine"], team["other"]
    r1 = _route(client, mine["UserId"], pdvs=1)
    r2 = _route(client, other["UserId"], pdvs=1)
    _day(client, r1["RouteId"], MONDAY)
    _day(client, r2["RouteId"], MONDAY)

    body = _board(client, headers=_login(client, mgr["Email"]))
    rep_ids = {r["userId"] for r in body["reps"]}
    assert mine["UserId"] in rep_ids and other["UserId"] not in rep_ids
    assert mine["UserId"] in {d["userId"] for d in body["days"]}
    assert {d["userId"] for d in body["days"]} <= {mgr["UserId"], mine["UserId"], team["mine2"]["UserId"]}
    assert r2["RouteId"] not in {r["routeId"] for r in body["routes"]}

    # Un vendedor no entra al tablero.
    resp = client.get("/routes/board", params={"date_from": MONDAY.isoformat(), "date_to": SATURDAY.isoformat()}, headers=_login(client, mine["Email"]))
    assert resp.status_code == 403


def test_board_valida_rango(client):
    p = {"date_from": MONDAY.isoformat(), "date_to": (MONDAY + timedelta(days=14)).isoformat()}
    assert client.get("/routes/board", params=p).status_code == 400
    p = {"date_from": SATURDAY.isoformat(), "date_to": MONDAY.isoformat()}
    assert client.get("/routes/board", params=p).status_code == 400
    p = {"date_from": MONDAY.isoformat(), "date_to": (MONDAY + timedelta(days=13)).isoformat()}
    assert client.get("/routes/board", params=p).status_code == 200


def test_board_sin_n_mas_1(client):
    """La cantidad de queries no crece con la cantidad de trades / días."""
    def count_queries():
        n = [0]

        def before(conn, cursor, statement, parameters, context, executemany):
            n[0] += 1

        event.listen(engine, "before_cursor_execute", before)
        try:
            _board(client)
        finally:
            event.remove(engine, "before_cursor_execute", before)
        return n[0]

    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=1)
    _day(client, r["RouteId"], MONDAY)
    base = count_queries()
    team = _team(client)
    for i in range(6):
        t2 = team[("mine", "mine2", "other")[i % 3]]
        r2 = _route(client, t2["UserId"], pdvs=2)
        _day(client, r2["RouteId"], MONDAY + timedelta(days=i % 6))
    assert count_queries() == base
    assert base <= 12


# ---------------------------------------------------------------------------
# Panel del día
# ---------------------------------------------------------------------------

def test_detalle_del_dia_y_candidatos(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=3)
    d = _day(client, r["RouteId"], MONDAY)
    det = client.get(f"/routes/days/{d['RouteDayId']}/detail").json()
    assert det["routeId"] == r["RouteId"] and det["userId"] == t["UserId"] and det["workDate"] == MONDAY.isoformat()
    assert [p["pdvId"] for p in det["pdvs"]] == r["pdvIds"] and det["locked"] is False
    assert all(p["executionStatus"] == "PENDING" and p["hasVisit"] is False and p["name"] for p in det["pdvs"])

    # Quitar uno del día → vuelve como candidato (es de la ruta); los que siguen en el día no.
    assert client.delete(f"/routes/days/{d['RouteDayId']}/pdvs/{r['pdvIds'][1]}").status_code == 204
    cands = client.get(f"/routes/days/{d['RouteDayId']}/pdv-candidates").json()
    assert [c["pdvId"] for c in cands if c["inRoute"]] == [r["pdvIds"][1]]
    assert not {c["pdvId"] for c in cands} & {r["pdvIds"][0], r["pdvIds"][2]}


# ---------------------------------------------------------------------------
# DELETE /routes/days/{id}/pdvs/{pdv_id}
# ---------------------------------------------------------------------------

def test_quitar_pdv_de_un_dia_no_toca_la_ruta_ni_otros_dias(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=2)
    d1 = _day(client, r["RouteId"], MONDAY)
    d2 = _day(client, r["RouteId"], MONDAY + timedelta(days=7))
    pid = r["pdvIds"][0]
    assert client.delete(f"/routes/days/{d1['RouteDayId']}/pdvs/{pid}").status_code == 204
    assert [p["PdvId"] for p in client.get(f"/routes/days/{d1['RouteDayId']}/pdvs").json()] == [r["pdvIds"][1]]
    assert len(client.get(f"/routes/days/{d2['RouteDayId']}/pdvs").json()) == 2
    assert len(client.get(f"/routes/{r['RouteId']}/pdvs").json()) == 2
    assert client.delete(f"/routes/days/{d1['RouteDayId']}/pdvs/{pid}").status_code == 404
    actions = _audit_actions(r["RouteId"])
    assert actions[-1][0] == "ROUTE_DAY_PDV_DEL" and actions[-1][1]["pdvId"] == pid

    # Volver a sumarlo (solo a ese día) y no duplicar.
    body = {"RouteDayId": d1["RouteDayId"], "PdvId": pid, "PlannedOrder": 9}
    assert client.post(f"/routes/days/{d1['RouteDayId']}/pdvs", json=body).status_code == 201
    assert client.post(f"/routes/days/{d1['RouteDayId']}/pdvs", json=body).status_code == 409
    assert _audit_actions(r["RouteId"])[-1][0] == "ROUTE_DAY_PDV_ADD"


def test_quitar_pdv_con_visita_409(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=2)
    d = _day(client, r["RouteId"], MONDAY)
    _add_visit(d["RouteDayId"], r["pdvIds"][0], t["UserId"])
    resp = client.delete(f"/routes/days/{d['RouteDayId']}/pdvs/{r['pdvIds'][0]}")
    assert resp.status_code == 409 and "visita" in resp.json()["detail"]
    # El otro PDV del mismo día (sin visita) sí se puede quitar.
    assert client.delete(f"/routes/days/{d['RouteDayId']}/pdvs/{r['pdvIds'][1]}").status_code == 204


def test_quitar_pdv_de_dia_ajeno_403(client):
    mgr, other = _team(client)["mgr"], _team(client)["other"]
    r = _route(client, other["UserId"], pdvs=1)
    d = _day(client, r["RouteId"], MONDAY)
    resp = client.delete(f"/routes/days/{d['RouteDayId']}/pdvs/{r['pdvIds'][0]}", headers=_login(client, mgr["Email"]))
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /routes/{id}/days — duplicados
# ---------------------------------------------------------------------------

def test_crear_dia_duplicado_409_y_no_duplica(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=1)
    _day(client, r["RouteId"], MONDAY, Origin="board")
    resp = client.post(f"/routes/{r['RouteId']}/days", json={"WorkDate": MONDAY.isoformat()})
    assert resp.status_code == 409 and "ya tiene un día" in resp.json()["detail"]
    assert len(client.get(f"/routes/{r['RouteId']}/days").json()) == 1
    # Otra fecha: se crea normal. Solo el alta con Origin deja rastro (los editores generan en lote).
    _day(client, r["RouteId"], MONDAY + timedelta(days=1))
    creates = [p for a, p in _audit_actions(r["RouteId"]) if a == "ROUTE_DAY_CREATE"]
    assert len(creates) == 1 and creates[0]["origen"] == "board" and creates[0]["despues"]["WorkDate"] == MONDAY.isoformat()


def test_crear_dia_solo_para_el_dueno_de_la_ruta(client):
    """Prestar un día a otro trade no está disponible: el día es del dueño de la ruta."""
    team = _team(client)
    mgr, mine, mine2, other = team["mgr"], team["mine"], team["mine2"], team["other"]
    r = _route(client, mine["UserId"], pdvs=1)
    hdr = _login(client, mgr["Email"])
    for target in (mine2, other):  # ni dentro ni fuera del equipo
        resp = client.post(f"/routes/{r['RouteId']}/days", json={"WorkDate": MONDAY.isoformat(), "AssignedUserId": target["UserId"]}, headers=hdr)
        assert resp.status_code == 400 and "reasigná toda la ruta" in resp.json()["detail"]
    assert client.post(f"/routes/{r['RouteId']}/days", json={"WorkDate": MONDAY.isoformat(), "AssignedUserId": mine["UserId"]}, headers=hdr).status_code == 201
    # Ruta sin asignar (comportamiento previo): el día va a nombre de un trade del equipo.
    free = client.post("/routes", json={"Name": f"BR_{_uid()}", "IsActive": True}, headers=hdr).json()
    assert client.post(f"/routes/{free['RouteId']}/days", json={"WorkDate": MONDAY.isoformat(), "AssignedUserId": other["UserId"]}, headers=hdr).status_code == 403
    assert client.post(f"/routes/{free['RouteId']}/days", json={"WorkDate": MONDAY.isoformat(), "AssignedUserId": mine["UserId"]}, headers=hdr).status_code == 201


def test_borrar_dia_desde_tablero_audita(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=1)
    d = _day(client, r["RouteId"], MONDAY)
    assert client.delete(f"/routes/days/{d['RouteDayId']}", params={"origin": "board"}).status_code == 204
    action, payload = _audit_actions(r["RouteId"])[-1]
    assert action == "ROUTE_DAY_DELETE" and payload["antes"]["WorkDate"] == MONDAY.isoformat()


# ---------------------------------------------------------------------------
# PATCH /routes/days/{id} — mover solo este día
# ---------------------------------------------------------------------------

def test_mover_dia_de_fecha(client):
    a = _team(client)["mine"]
    r = _route(client, a["UserId"], pdvs=2)
    d = _day(client, r["RouteId"], MONDAY)
    wed = MONDAY + timedelta(days=2)
    resp = client.patch(f"/routes/days/{d['RouteDayId']}", json={"WorkDate": wed.isoformat(), "AssignedUserId": a["UserId"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["WorkDate"] == wed.isoformat() and resp.json()["AssignedUserId"] == a["UserId"]
    assert len(client.get(f"/routes/days/{d['RouteDayId']}/pdvs").json()) == 2  # los PDVs del día no se pierden
    action, payload = _audit_actions(r["RouteId"])[-1]
    assert action == "ROUTE_DAY_MOVE" and payload["routeDayId"] == d["RouteDayId"]
    assert payload["antes"] == {"WorkDate": MONDAY.isoformat()} and payload["despues"] == {"WorkDate": wed.isoformat()}
    row = next(x for x in _board(client)["days"] if x["routeDayId"] == d["RouteDayId"])
    assert row["userId"] == a["UserId"] and row["workDate"] == wed.isoformat()


def test_no_se_presta_un_dia_a_otro_trade(client):
    """Hallazgo 3: un día suelto en manos de otro trade no se puede trabajar (403 al abrir el
    PDV) ni cuenta en el KPI → se bloquea; solo se permite devolverlo al dueño de la ruta."""
    team = _team(client)
    a, b = team["mine"], team["other"]
    r = _route(client, a["UserId"], pdvs=1)
    d = _day(client, r["RouteId"], MONDAY)
    resp = client.patch(f"/routes/days/{d['RouteDayId']}", json={"AssignedUserId": b["UserId"]})
    assert resp.status_code == 400 and "reasigná toda la ruta" in resp.json()["detail"]
    assert client.get(f"/routes/days/{d['RouteDayId']}").json()["AssignedUserId"] == a["UserId"]
    # Un día que ya estaba a nombre de otro (activador / dato previo) sí vuelve al dueño.
    db = _db()
    db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == d["RouteDayId"]).update({"AssignedUserId": b["UserId"]})
    db.commit(); db.close()
    resp = client.patch(f"/routes/days/{d['RouteDayId']}", json={"AssignedUserId": a["UserId"]})
    assert resp.status_code == 200 and resp.json()["AssignedUserId"] == a["UserId"]


def test_mover_solo_status_no_audita_ni_cambia_nada_mas(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=1)
    d = _day(client, r["RouteId"], MONDAY)
    resp = client.patch(f"/routes/days/{d['RouteDayId']}", json={"Status": "IN_PROGRESS"})
    assert resp.status_code == 200 and resp.json()["Status"] == "IN_PROGRESS" and resp.json()["WorkDate"] == MONDAY.isoformat()
    assert "ROUTE_DAY_MOVE" not in [a for a, _ in _audit_actions(r["RouteId"])]
    # En curso: ya no se mueve.
    resp = client.patch(f"/routes/days/{d['RouteDayId']}", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()})
    assert resp.status_code == 409


def test_mover_dia_con_visitas_409(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=1)
    d = _day(client, r["RouteId"], MONDAY)
    _add_visit(d["RouteDayId"], r["pdvIds"][0], t["UserId"])
    resp = client.patch(f"/routes/days/{d['RouteDayId']}", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()})
    assert resp.status_code == 409 and "visitas" in resp.json()["detail"]
    assert client.get(f"/routes/days/{d['RouteDayId']}").json()["WorkDate"] == MONDAY.isoformat()


def test_mover_dia_despues_de_fecha_fin_400(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=1, EndDate=(MONDAY + timedelta(days=2)).isoformat())
    d = _day(client, r["RouteId"], MONDAY)
    resp = client.patch(f"/routes/days/{d['RouteDayId']}", json={"WorkDate": (MONDAY + timedelta(days=3)).isoformat()})
    assert resp.status_code == 400 and "termina" in resp.json()["detail"]
    assert client.patch(f"/routes/days/{d['RouteDayId']}", json={"WorkDate": (MONDAY + timedelta(days=2)).isoformat()}).status_code == 200


def test_mover_dia_a_fecha_con_otro_dia_de_la_misma_ruta_409(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=1)
    d1 = _day(client, r["RouteId"], MONDAY)
    _day(client, r["RouteId"], MONDAY + timedelta(days=1))
    resp = client.patch(f"/routes/days/{d1['RouteDayId']}", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()})
    assert resp.status_code == 409 and "ya tiene un día" in resp.json()["detail"]
    # Otra ruta del mismo trade ese día NO bloquea (el solapamiento solo se avisa).
    r2 = _route(client, t["UserId"], pdvs=1)
    d2 = _day(client, r2["RouteId"], MONDAY + timedelta(days=3))
    assert client.patch(f"/routes/days/{d2['RouteDayId']}", json={"WorkDate": MONDAY.isoformat()}).status_code == 200


def test_mover_dia_pasado_o_a_fecha_pasada_400(client):
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=1)
    past = _day(client, r["RouteId"], TODAY - timedelta(days=2))
    assert client.patch(f"/routes/days/{past['RouteDayId']}", json={"WorkDate": MONDAY.isoformat()}).status_code == 400
    fut = _day(client, r["RouteId"], MONDAY)
    assert client.patch(f"/routes/days/{fut['RouteDayId']}", json={"WorkDate": (TODAY - timedelta(days=1)).isoformat()}).status_code == 400


def test_mover_dia_respeta_jerarquia(client):
    team = _team(client)
    mgr, mine, other = team["mgr"], team["mine"], team["other"]
    hdr = _login(client, mgr["Email"])
    r = _route(client, mine["UserId"], pdvs=1)
    d = _day(client, r["RouteId"], MONDAY)
    assert client.patch(f"/routes/days/{d['RouteDayId']}", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()}, headers=hdr).status_code == 200
    # Día de una ruta ajena: 403.
    r2 = _route(client, other["UserId"], pdvs=1)
    d2 = _day(client, r2["RouteId"], MONDAY)
    assert client.patch(f"/routes/days/{d2['RouteDayId']}", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()}, headers=hdr).status_code == 403
    # Usuario inexistente: 400.
    assert client.patch(f"/routes/days/{d['RouteDayId']}", json={"AssignedUserId": 99999999}).status_code == 400


# ---------------------------------------------------------------------------
# Regresiones de la revisión independiente (2026-11-19)
# ---------------------------------------------------------------------------

def test_rev1_vendedor_no_mueve_ni_recorta_sus_dias(client):
    """Un trade no reprograma ni achica sus propios días (denominador del KPI 2);
    el cambio de estado del día sigue siendo suyo."""
    v = _team(client)["mine"]
    h = _login(client, v["Email"])
    r = _route(client, v["UserId"], pdvs=3)
    past = _day(client, r["RouteId"], TODAY - timedelta(days=2))
    today = _day(client, r["RouteId"], TODAY)
    _add_visit(past["RouteDayId"], r["pdvIds"][0], v["UserId"])
    for day in (past, today):
        for p in r["pdvIds"][1:]:
            assert client.delete(f"/routes/days/{day['RouteDayId']}/pdvs/{p}", headers=h).status_code == 403
    assert client.patch(f"/routes/days/{today['RouteDayId']}", json={"WorkDate": (TODAY + timedelta(days=9)).isoformat()}, headers=h).status_code == 403
    assert client.delete(f"/routes/days/{today['RouteDayId']}", params={"origin": "board"}, headers=h).status_code == 403
    assert len(client.get(f"/routes/days/{past['RouteDayId']}/pdvs").json()) == 3
    assert client.get(f"/routes/days/{today['RouteDayId']}").json()["WorkDate"] == TODAY.isoformat()
    # Lo que ya hacía: estado del día (PATCH solo Status).
    resp = client.patch(f"/routes/days/{today['RouteDayId']}", json={"Status": "IN_PROGRESS"}, headers=h)
    assert resp.status_code == 200 and resp.json()["Status"] == "IN_PROGRESS"


def test_rev2_ejecutivo_y_regional_respetan_jerarquia(client):
    """_assert_route_access deja pasar a ejecutivo / regional_manager: las mutaciones del
    tablero validan con visible_user_ids."""
    team = _team(client)
    owner = team["other"]  # fuera de la jerarquía de ejecutivo y de regional_out
    r = _route(client, owner["UserId"], pdvs=2)
    d = _day(client, r["RouteId"], MONDAY)
    extra = _pdv(client)
    for who in (team["ejecutivo"], team["regional_out"]):
        h = _login(client, who["Email"])
        assert client.patch(f"/routes/days/{d['RouteDayId']}", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()}, headers=h).status_code == 403
        assert client.delete(f"/routes/days/{d['RouteDayId']}/pdvs/{r['pdvIds'][0]}", headers=h).status_code == 403
        body = {"RouteDayId": d["RouteDayId"], "PdvId": extra["PdvId"], "PlannedOrder": 9}
        assert client.post(f"/routes/days/{d['RouteDayId']}/pdvs", json=body, headers=h).status_code == 403
        assert client.delete(f"/routes/days/{d['RouteDayId']}", params={"origin": "board"}, headers=h).status_code == 403
        assert client.post(f"/routes/days/{d['RouteDayId']}/shift-weekday", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()}, headers=h).status_code == 403
    assert client.get(f"/routes/days/{d['RouteDayId']}").json()["WorkDate"] == MONDAY.isoformat()
    assert len(client.get(f"/routes/days/{d['RouteDayId']}/pdvs").json()) == 2
    # Un regional con el trade en su sub-árbol (regional → mgr → mine) sí puede.
    r2 = _route(client, team["mine"]["UserId"], pdvs=2)
    d2 = _day(client, r2["RouteId"], MONDAY)
    h = _login(client, team["regional"]["Email"])
    assert client.patch(f"/routes/days/{d2['RouteDayId']}", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()}, headers=h).status_code == 200
    assert client.delete(f"/routes/days/{d2['RouteDayId']}/pdvs/{r2['pdvIds'][0]}", headers=h).status_code == 204
    assert client.delete(f"/routes/days/{d2['RouteDayId']}", params={"origin": "board"}, headers=h).status_code == 204


def test_rev4_dia_bloqueado_no_se_edita(client):
    """La guarda `locked` vive en el servidor: día pasado → ni sumar ni quitar PDVs ni
    borrarlo desde el tablero; borrar exige además PLANIFICADO y sin ejecución."""
    t = _trade(client)
    r = _route(client, t["UserId"], pdvs=2)
    past = _day(client, r["RouteId"], TODAY - timedelta(days=5))
    extra = _pdv(client)
    assert client.delete(f"/routes/days/{past['RouteDayId']}/pdvs/{r['pdvIds'][0]}").status_code == 409
    body = {"RouteDayId": past["RouteDayId"], "PdvId": extra["PdvId"], "PlannedOrder": 9}
    assert client.post(f"/routes/days/{past['RouteDayId']}/pdvs", json=body).status_code == 409
    assert client.delete(f"/routes/days/{past['RouteDayId']}", params={"origin": "board"}).status_code == 409
    assert len(client.get(f"/routes/days/{past['RouteDayId']}/pdvs").json()) == 2
    # Futuro pero empezado (un PDV ya no está PENDING) o en curso: no se borra desde el tablero.
    started = _day(client, r["RouteId"], MONDAY)
    client.patch(f"/routes/days/{started['RouteDayId']}/pdvs/{r['pdvIds'][0]}", json={"ExecutionStatus": "DONE"})
    assert client.delete(f"/routes/days/{started['RouteDayId']}", params={"origin": "board"}).status_code == 409
    running = _day(client, r["RouteId"], MONDAY + timedelta(days=1))
    client.patch(f"/routes/days/{running['RouteDayId']}", json={"Status": "IN_PROGRESS"})
    assert client.delete(f"/routes/days/{running['RouteDayId']}", params={"origin": "board"}).status_code == 409
    # El borrado de los editores (sin origin) no cambia: un día pasado sin visitas se borra.
    assert client.delete(f"/routes/days/{past['RouteDayId']}").status_code == 204


def test_rev4_sumar_pdv_a_un_dia_aplica_reglas_de_campana(client):
    team = _team(client)
    t = team["mine"]
    camp = _route(client, t["UserId"], pdvs=1, RouteType="campaign", EndDate=(MONDAY + timedelta(days=30)).isoformat())
    d = _day(client, camp["RouteId"], MONDAY)
    extra = _pdv(client)
    body = {"RouteDayId": d["RouteDayId"], "PdvId": extra["PdvId"], "PlannedOrder": 9}
    assert client.post(f"/routes/days/{d['RouteDayId']}/pdvs", json=body, headers=_login(client, t["Email"])).status_code == 403
    assert client.post(f"/routes/days/{d['RouteDayId']}/pdvs", json=body, headers=_login(client, team["outsider"]["Email"])).status_code == 403
    assert client.post(f"/routes/days/{d['RouteDayId']}/pdvs", json=body).status_code == 201


def test_rev5_visita_con_routeday_viejo_no_ata_dia_futuro(client):
    """Celular con datos viejos: manda el RouteDayId de un día que el tablero ya movió.
    La visita se crea igual (no se pierde) pero no queda atada al día futuro."""
    t = _team(client)["mine2"]
    h = _login(client, t["Email"])
    r = _route(client, t["UserId"], pdvs=2)
    d = _day(client, r["RouteId"], TODAY)
    assert client.patch(f"/routes/days/{d['RouteDayId']}", json={"WorkDate": (TODAY + timedelta(days=6)).isoformat()}).status_code == 200
    v = client.post("/visits", json={"PdvId": r["pdvIds"][0], "UserId": t["UserId"], "RouteDayId": d["RouteDayId"], "Status": "OPEN"}, headers=h)
    assert v.status_code == 201, v.text
    assert v.json()["RouteDayId"] is None
    statuses = {p["PdvId"]: p["ExecutionStatus"] for p in client.get(f"/routes/days/{d['RouteDayId']}/pdvs").json()}
    assert set(statuses.values()) == {"PENDING"}
    row = next(x for x in _board(client, date_from=TODAY + timedelta(days=6), date_to=TODAY + timedelta(days=6))["days"] if x["routeDayId"] == d["RouteDayId"])
    assert row["hasVisits"] is False and row["locked"] is False
    db = _db()
    db.query(VisitModel).filter(VisitModel.VisitId == v.json()["VisitId"]).update({"Status": "CLOSED"})
    db.commit(); db.close()

    # El día de OTRO usuario tampoco se ata.
    other = _team(client)["other"]
    r2 = _route(client, other["UserId"], pdvs=1)
    d2 = _day(client, r2["RouteId"], TODAY)
    v2 = client.post("/visits", json={"PdvId": r["pdvIds"][1], "UserId": t["UserId"], "RouteDayId": d2["RouteDayId"], "Status": "OPEN"}, headers=h)
    assert v2.status_code == 201 and v2.json()["RouteDayId"] is None
    db = _db()
    db.query(VisitModel).filter(VisitModel.VisitId == v2.json()["VisitId"]).update({"Status": "CLOSED"})
    db.commit(); db.close()


def test_rev5_visita_con_routeday_de_hoy_o_pasado_se_respeta(client):
    """Casos legítimos intactos: el día de hoy, y un día pasado (visita offline que
    sincroniza después)."""
    t = _team(client)["mine2"]
    h = _login(client, t["Email"])
    r = _route(client, t["UserId"], pdvs=2)
    today = _day(client, r["RouteId"], TODAY)
    past = _day(client, r["RouteId"], TODAY - timedelta(days=1))
    v = client.post("/visits", json={"PdvId": r["pdvIds"][0], "UserId": t["UserId"], "RouteDayId": today["RouteDayId"], "Status": "OPEN"}, headers=h)
    assert v.status_code == 201 and v.json()["RouteDayId"] == today["RouteDayId"]
    statuses = {p["PdvId"]: p["ExecutionStatus"] for p in client.get(f"/routes/days/{today['RouteDayId']}/pdvs").json()}
    assert statuses[r["pdvIds"][0]] == "IN_PROGRESS"
    db = _db()
    db.query(VisitModel).filter(VisitModel.VisitId == v.json()["VisitId"]).update({"Status": "CLOSED"})
    db.commit(); db.close()
    v2 = client.post("/visits", json={"PdvId": r["pdvIds"][1], "UserId": t["UserId"], "RouteDayId": past["RouteDayId"], "Status": "OPEN"}, headers=h)
    assert v2.status_code == 201 and v2.json()["RouteDayId"] == past["RouteDayId"]
    db = _db()
    db.query(VisitModel).filter(VisitModel.VisitId == v2.json()["VisitId"]).update({"Status": "CLOSED"})
    db.commit(); db.close()


def _other_users_day(route_id, work_date, user_id):
    """Como start-today: otro usuario con su propio día de la misma ruta y fecha."""
    db = _db()
    rd = RouteDayModel(RouteId=route_id, WorkDate=work_date, AssignedUserId=user_id, Status="PLANNED")
    db.add(rd); db.commit()
    rid = rd.RouteDayId
    db.close()
    return rid


def test_rev6_dias_de_otro_usuario_en_la_misma_ruta_y_fecha(client):
    team = _team(client)
    a, b = team["mine"], team["other"]
    r = _weekly_route(client, a["UserId"], weeks=2)
    wed = MONDAY + timedelta(days=2)
    # b (activador) tiene su propio día el lunes y el miércoles de la 1ª semana.
    b_mon = _other_users_day(r["RouteId"], MONDAY, b["UserId"])
    b_wed = _other_users_day(r["RouteId"], wed, b["UserId"])
    # Mover / correr los días de a no borra ni mueve los de b, y el miércoles de b no cuenta como choque.
    res = client.post(f"/routes/days/{r['days'][0]['RouteDayId']}/shift-weekday", json={"WorkDate": wed.isoformat()})
    assert res.status_code == 200, res.text
    assert res.json()["moved"] == 2 and res.json()["removed"] == 0
    db = _db()
    days = {d.RouteDayId: (d.WorkDate, d.AssignedUserId) for d in db.query(RouteDayModel).filter(RouteDayModel.RouteId == r["RouteId"])}
    db.close()
    assert days[b_mon] == (MONDAY, b["UserId"]) and days[b_wed] == (wed, b["UserId"])
    assert days[r["days"][0]["RouteDayId"]] == (wed, a["UserId"])
    # Alta y movimiento: el duplicado es por (ruta, fecha, trade).
    thu = MONDAY + timedelta(days=3)
    b_thu = _other_users_day(r["RouteId"], thu, b["UserId"])
    created = client.post(f"/routes/{r['RouteId']}/days", json={"WorkDate": thu.isoformat()})
    assert created.status_code == 201
    assert client.post(f"/routes/{r['RouteId']}/days", json={"WorkDate": thu.isoformat()}).status_code == 409
    fri = MONDAY + timedelta(days=4)
    _other_users_day(r["RouteId"], fri, b["UserId"])
    assert client.patch(f"/routes/days/{created.json()['RouteDayId']}", json={"WorkDate": fri.isoformat()}).status_code == 200
    assert b_thu in {d["RouteDayId"] for d in client.get(f"/routes/{r['RouteId']}/days").json()}


def test_rev7_candidatos_ruta_primero_y_zona_por_jerarquia(client):
    from app.models import PDV as PDVModel
    from app.models.zone import Zone as ZoneModel

    team = _team(client)
    mgr, mine, other = team["mgr"], team["mine"], team["other"]
    db = _db()
    z = ZoneModel(Name=f"Z_{_uid()}"); db.add(z); db.commit(); zid = z.ZoneId
    ch = client.post("/channels", json={"Name": f"C_{_uid()}"}).json()["ChannelId"]
    for i in range(120):  # ajenos al equipo de mgr
        db.add(PDVModel(Name=f"AAA zona {i:03d}", ChannelId=ch, ZoneId=zid, IsActive=True, AssignedUserId=other["UserId"]))
    own = PDVModel(Name="MMM del equipo", ChannelId=ch, ZoneId=zid, IsActive=True, AssignedUserId=mine["UserId"])
    db.add(own); db.commit()
    own_id = own.PdvId
    foreign_id = db.query(PDVModel.PdvId).filter(PDVModel.ZoneId == zid, PDVModel.AssignedUserId == other["UserId"]).first()[0]
    db.close()
    r = _route(client, mine["UserId"], pdvs=0, ZoneId=zid)
    p = client.post("/pdvs", json={"Name": "ZZZ de la ruta", "ChannelId": ch, "IsActive": True}).json()
    assert client.post(f"/routes/{r['RouteId']}/pdvs", json={"PdvId": p["PdvId"], "SortOrder": 1}).status_code == 201
    d = _day(client, r["RouteId"], MONDAY)
    assert client.delete(f"/routes/days/{d['RouteDayId']}/pdvs/{p['PdvId']}").status_code == 204

    # Admin: el PDV de la ruta va primero aunque la zona tenga 120 que ordenan antes.
    c = client.get(f"/routes/days/{d['RouteDayId']}/pdv-candidates").json()
    assert len(c) == 30 and c[0]["pdvId"] == p["PdvId"] and c[0]["inRoute"] is True
    assert sum(1 for x in c if x["inRoute"]) == 1
    # Manager: de la zona solo ve los PDVs de su jerarquía.
    hdr = _login(client, mgr["Email"])
    c = client.get(f"/routes/days/{d['RouteDayId']}/pdv-candidates", headers=hdr).json()
    assert [x["pdvId"] for x in c] == [p["PdvId"], own_id]
    # Y no puede sumar al día un PDV fuera de su visibilidad (sí uno propio o de la ruta).
    def add(pid):
        return client.post(f"/routes/days/{d['RouteDayId']}/pdvs", json={"RouteDayId": d["RouteDayId"], "PdvId": pid, "PlannedOrder": 5}, headers=hdr).status_code
    assert add(foreign_id) == 403
    assert add(own_id) == 201 and add(p["PdvId"]) == 201


def test_rev8_toda_la_ruta_dia_y_trade_en_una_sola_operacion(client):
    team = _team(client)
    mgr, a, b, other = team["mgr"], team["mine"], team["mine2"], team["other"]
    hdr = _login(client, mgr["Email"])
    r = _weekly_route(client, a["UserId"], weeks=3)
    first = r["days"][0]["RouteDayId"]
    thu = MONDAY + timedelta(days=3)
    # Trade fuera del equipo: falla ENTERO (ni la frecuencia ni los días cambian).
    bad = client.post(f"/routes/days/{first}/shift-weekday", json={"WorkDate": thu.isoformat(), "AssignedUserId": other["UserId"]}, headers=hdr)
    assert bad.status_code == 403
    route = client.get(f"/routes/{r['RouteId']}").json()
    assert json.loads(route["FrequencyConfig"])["day"] == 1 and route["AssignedUserId"] == a["UserId"]
    assert {d["WorkDate"] for d in client.get(f"/routes/{r['RouteId']}/days").json()} == {(MONDAY + timedelta(days=7 * i)).isoformat() for i in range(3)}
    # Dentro del equipo: día de la semana + reasignación en la misma transacción.
    ok = client.post(f"/routes/days/{first}/shift-weekday", json={"WorkDate": thu.isoformat(), "AssignedUserId": b["UserId"]}, headers=hdr)
    assert ok.status_code == 200, ok.text
    assert ok.json()["moved"] == 3 and ok.json()["assignedUserId"] == b["UserId"]
    route = client.get(f"/routes/{r['RouteId']}").json()
    assert json.loads(route["FrequencyConfig"])["day"] == 4 and route["AssignedUserId"] == b["UserId"]
    days = client.get(f"/routes/{r['RouteId']}/days").json()
    assert {d["WorkDate"] for d in days} == {(thu + timedelta(days=7 * i)).isoformat() for i in range(3)}
    assert {d["AssignedUserId"] for d in days} == {b["UserId"]}
    # Ruta regular: los PDVs pasan al nuevo trade (mismo efecto que PATCH /routes/{id}).
    assert client.get(f"/pdvs/{r['pdvIds'][0]}").json()["AssignedUserId"] == b["UserId"]
    action, payload = _audit_actions(r["RouteId"])[-1]
    assert action == "ROUTE_SHIFT_WEEKDAY"
    assert payload["antes"]["AssignedUserId"] == a["UserId"] and payload["despues"]["AssignedUserId"] == b["UserId"]


def test_mover_dia_de_campana_reglas_de_campana(client):
    team = _team(client)
    mgr, outsider, t = team["mgr"], team["outsider"], team["mine"]
    camp = _route(client, t["UserId"], pdvs=1, RouteType="campaign", EndDate=(MONDAY + timedelta(days=30)).isoformat())
    d = _day(client, camp["RouteId"], MONDAY)
    body = {"WorkDate": (MONDAY + timedelta(days=1)).isoformat()}
    # El trade asignado la ejecuta (estado) pero no la mueve; un manager ajeno tampoco.
    assert client.patch(f"/routes/days/{d['RouteDayId']}", json=body, headers=_login(client, t["Email"])).status_code == 403
    assert client.patch(f"/routes/days/{d['RouteDayId']}", json=body, headers=_login(client, outsider["Email"])).status_code == 403
    assert client.patch(f"/routes/days/{d['RouteDayId']}", json=body, headers=_login(client, mgr["Email"])).status_code == 200


# ---------------------------------------------------------------------------
# POST /routes/days/{id}/shift-weekday — toda la ruta de acá en adelante
# ---------------------------------------------------------------------------

def _js(d):
    return (d.weekday() + 1) % 7


def _weekly_route(client, uid, weeks=4, freq="weekly", **cfg):
    config = {"day": 1, "startDate": TODAY.isoformat(), **cfg}
    r = _route(client, uid, pdvs=2, FrequencyType=freq, FrequencyConfig=json.dumps(config))
    step = 14 if freq == "biweekly" else 7
    r["days"] = [_day(client, r["RouteId"], MONDAY + timedelta(days=step * i)) for i in range(weeks)]
    return r


def test_shift_semanal_corre_config_y_dias_futuros(client):
    t = _trade(client)
    r = _weekly_route(client, t["UserId"])
    second = r["days"][1]  # se arrastra el 2º lunes al jueves: el 1º no se toca
    thu = MONDAY + timedelta(days=7 + 3)
    resp = client.post(f"/routes/days/{second['RouteDayId']}/shift-weekday", json={"WorkDate": thu.isoformat()})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["moved"] == 3 and body["removed"] == 0 and body["kept"] == 0
    assert json.loads(body["frequencyConfig"])["day"] == 4
    dates = sorted(d["WorkDate"] for d in client.get(f"/routes/{r['RouteId']}/days").json())
    assert dates == [MONDAY.isoformat()] + [(MONDAY + timedelta(days=7 * i + 3)).isoformat() for i in (1, 2, 3)]
    # Mismos RouteDay (se movieron, no se recrearon): conservan sus PDVs.
    assert len(client.get(f"/routes/days/{second['RouteDayId']}/pdvs").json()) == 2
    assert json.loads(client.get(f"/routes/{r['RouteId']}").json()["FrequencyConfig"])["day"] == 4
    action, payload = _audit_actions(r["RouteId"])[-1]
    assert action == "ROUTE_SHIFT_WEEKDAY"
    assert json.loads(payload["antes"]["FrequencyConfig"])["day"] == 1 and json.loads(payload["despues"]["FrequencyConfig"])["day"] == 4
    assert len(payload["despues"]["dias"]) == 3


def test_shift_no_toca_dias_con_visitas_ni_empezados(client):
    t = _trade(client)
    r = _weekly_route(client, t["UserId"])
    _add_visit(r["days"][2]["RouteDayId"], r["pdvIds"][0], t["UserId"])
    client.patch(f"/routes/days/{r['days'][3]['RouteDayId']}/pdvs/{r['pdvIds'][0]}", json={"ExecutionStatus": "DONE"})
    resp = client.post(f"/routes/days/{r['days'][0]['RouteDayId']}/shift-weekday", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()})
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 2 and resp.json()["kept"] == 2
    by_id = {d["RouteDayId"]: d["WorkDate"] for d in client.get(f"/routes/{r['RouteId']}/days").json()}
    assert by_id[r["days"][0]["RouteDayId"]] == (MONDAY + timedelta(days=1)).isoformat()
    assert by_id[r["days"][2]["RouteDayId"]] == (MONDAY + timedelta(days=14)).isoformat()
    assert by_id[r["days"][3]["RouteDayId"]] == (MONDAY + timedelta(days=21)).isoformat()
    # El día arrastrado con visitas: 409.
    resp = client.post(f"/routes/days/{r['days'][2]['RouteDayId']}/shift-weekday", json={"WorkDate": (MONDAY + timedelta(days=16)).isoformat()})
    assert resp.status_code == 409


def test_shift_elimina_los_que_pasan_la_fecha_fin_o_chocan(client):
    t = _trade(client)
    end = MONDAY + timedelta(days=15)  # martes de la 3ª semana
    r = _weekly_route(client, t["UserId"], weeks=3)
    assert client.patch(f"/routes/{r['RouteId']}", json={"EndDate": end.isoformat()}).status_code == 200
    # Día cargado a mano el miércoles de la 2ª semana: el lunes de esa semana chocaría.
    manual = _day(client, r["RouteId"], MONDAY + timedelta(days=9))
    resp = client.post(f"/routes/days/{r['days'][0]['RouteDayId']}/shift-weekday", json={"WorkDate": (MONDAY + timedelta(days=2)).isoformat()})
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1 and resp.json()["removed"] == 2
    days = {d["RouteDayId"]: d["WorkDate"] for d in client.get(f"/routes/{r['RouteId']}/days").json()}
    assert days == {
        r["days"][0]["RouteDayId"]: (MONDAY + timedelta(days=2)).isoformat(),
        manual["RouteDayId"]: (MONDAY + timedelta(days=9)).isoformat(),
    }


def test_shift_quincenal_mantiene_la_fase(client):
    from app.routers.routes import planned_dates

    t = _trade(client)
    r = _weekly_route(client, t["UserId"], weeks=3, freq="biweekly", startDate=MONDAY.isoformat())
    fri = MONDAY + timedelta(days=4)
    resp = client.post(f"/routes/days/{r['days'][0]['RouteDayId']}/shift-weekday", json={"WorkDate": fri.isoformat()})
    assert resp.status_code == 200, resp.text
    cfg = json.loads(resp.json()["frequencyConfig"])
    assert cfg["day"] == 5 and cfg["startDate"] == fri.isoformat()
    dates = sorted(d["WorkDate"] for d in client.get(f"/routes/{r['RouteId']}/days").json())
    assert dates == [(fri + timedelta(days=14 * i)).isoformat() for i in range(3)]
    # Regenerar desde la frecuencia cae en las mismas semanas que los días corridos.
    planned = planned_dates("biweekly", resp.json()["frequencyConfig"])
    assert {fri + timedelta(days=14 * i) for i in range(3)} <= planned
    assert fri + timedelta(days=7) not in planned


def test_shift_dias_especificos(client):
    t = _trade(client)
    cfg = json.dumps({"days": [1, 3], "startDate": TODAY.isoformat()})
    r = _route(client, t["UserId"], pdvs=1, FrequencyType="specific_days", FrequencyConfig=cfg)
    mon = _day(client, r["RouteId"], MONDAY)
    wed = _day(client, r["RouteId"], MONDAY + timedelta(days=2))
    mon2 = _day(client, r["RouteId"], MONDAY + timedelta(days=7))
    # Lunes → miércoles: la ruta ya se visita los miércoles.
    resp = client.post(f"/routes/days/{mon['RouteDayId']}/shift-weekday", json={"WorkDate": (MONDAY + timedelta(days=2)).isoformat()})
    assert resp.status_code == 409
    # Lunes → viernes.
    resp = client.post(f"/routes/days/{mon['RouteDayId']}/shift-weekday", json={"WorkDate": (MONDAY + timedelta(days=4)).isoformat()})
    assert resp.status_code == 200, resp.text
    assert json.loads(resp.json()["frequencyConfig"])["days"] == [3, 5] and resp.json()["moved"] == 2
    days = {d["RouteDayId"]: d["WorkDate"] for d in client.get(f"/routes/{r['RouteId']}/days").json()}
    assert days[wed["RouteDayId"]] == (MONDAY + timedelta(days=2)).isoformat()
    assert days[mon2["RouteDayId"]] == (MONDAY + timedelta(days=11)).isoformat()


def test_shift_no_aplica(client):
    t = _trade(client)
    # Sin frecuencia semanal.
    r = _route(client, t["UserId"], pdvs=1, FrequencyType="monthly", FrequencyConfig=json.dumps({"startDate": TODAY.isoformat()}))
    d = _day(client, r["RouteId"], MONDAY)
    resp = client.post(f"/routes/days/{d['RouteDayId']}/shift-weekday", json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()})
    assert resp.status_code == 400 and "solo este día" in resp.json()["detail"]
    # Semanal, pero el día arrastrado no es el de la frecuencia (cargado a mano un martes).
    w = _weekly_route(client, t["UserId"], weeks=1)
    manual = _day(client, w["RouteId"], MONDAY + timedelta(days=1))
    resp = client.post(f"/routes/days/{manual['RouteDayId']}/shift-weekday", json={"WorkDate": (MONDAY + timedelta(days=3)).isoformat()})
    assert resp.status_code == 400
    # Otra semana o mismo día.
    day = w["days"][0]["RouteDayId"]
    assert client.post(f"/routes/days/{day}/shift-weekday", json={"WorkDate": (MONDAY + timedelta(days=8)).isoformat()}).status_code == 400
    assert client.post(f"/routes/days/{day}/shift-weekday", json={"WorkDate": MONDAY.isoformat()}).status_code == 400
    # Nada cambió.
    assert json.loads(client.get(f"/routes/{w['RouteId']}").json()["FrequencyConfig"])["day"] == 1


def test_shift_respeta_jerarquia(client):
    mgr, other = _team(client)["mgr"], _team(client)["other"]
    r = _weekly_route(client, other["UserId"], weeks=1)
    resp = client.post(
        f"/routes/days/{r['days'][0]['RouteDayId']}/shift-weekday",
        json={"WorkDate": (MONDAY + timedelta(days=1)).isoformat()},
        headers=_login(client, mgr["Email"]),
    )
    assert resp.status_code == 403
    db = _db()
    assert db.query(RouteDayModel).filter(RouteDayModel.RouteId == r["RouteId"]).one().WorkDate == MONDAY
    assert db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId == r["days"][0]["RouteDayId"]).count() == 2
    assert json.loads(db.query(RouteModel).filter(RouteModel.RouteId == r["RouteId"]).one().FrequencyConfig)["day"] == 1
    db.close()
