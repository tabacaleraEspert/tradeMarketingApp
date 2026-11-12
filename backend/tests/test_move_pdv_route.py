"""Cambiar la ruta regular de un PDV desde Gestión + re-optimización automática (2026-11-12)."""
from datetime import timedelta

from app.models import PDV as PDVModel, Route as RouteModel
from app.models import RouteDayPdv as RouteDayPdvModel, RoutePdv as RoutePdvModel
from app.models.route import today_ar

from tests.test_route_campaign import _db, _login, _route, _uid, _user


def _pdv_at(client, ch, lat, lon):
    r = client.post("/pdvs", json={"Name": f"Mv_{_uid()}", "ChannelId": ch, "IsActive": True, "Lat": lat, "Lon": lon})
    assert r.status_code == 201, r.text
    return r.json()["PdvId"]


def _order(route_id):
    db = _db()
    try:
        return [r.PdvId for r in db.query(RoutePdvModel).filter_by(RouteId=route_id).order_by(RoutePdvModel.SortOrder)]
    finally:
        db.close()


def test_move_reoptimiza_y_cambia_dueno(client):
    a, b = _user(client, "vendedor"), _user(client, "vendedor")
    ch = client.post("/channels", json={"Name": f"MvCh_{_uid()}"}).json()["ChannelId"]
    ra, rb = _route(client, a["UserId"]), _route(client, b["UserId"])
    # Ruta B sobre una línea: 0, 2, 4 (en ese orden). Ruta A: el PDV a mover (cae en 1) + otro.
    b0, b2, b4 = (_pdv_at(client, ch, -34.60, -58.40 + d * 0.01) for d in (0, 2, 4))
    mover, a_otro = _pdv_at(client, ch, -34.60, -58.39), _pdv_at(client, ch, -34.70, -58.50)
    for i, p in enumerate((b0, b2, b4)):
        assert client.post(f"/routes/{rb['RouteId']}/pdvs", json={"PdvId": p, "SortOrder": i}).status_code == 201
    for i, p in enumerate((mover, a_otro)):
        assert client.post(f"/routes/{ra['RouteId']}/pdvs", json={"PdvId": p, "SortOrder": i}).status_code == 201
    camp = _route(client, a["UserId"], "campaign", end=today_ar() + timedelta(days=30))
    assert client.post(f"/routes/{camp['RouteId']}/pdvs", json={"PdvId": mover, "SortOrder": 0}).status_code == 201
    day = client.post(f"/routes/{rb['RouteId']}/days", json={
        "WorkDate": (today_ar() + timedelta(days=2)).isoformat(), "AssignedUserId": b["UserId"]}).json()

    r = client.post("/routes/move-pdv", json={"pdv_id": mover, "to_route_id": rb["RouteId"]})
    assert r.status_code == 200, r.text
    assert r.json() == {"changed": True, "from": [ra["Name"]], "to": rb["Name"]}
    assert _order(rb["RouteId"]) == [b0, mover, b2, b4]          # entra en su lugar, no al final
    assert _order(ra["RouteId"]) == [a_otro]
    assert _order(camp["RouteId"]) == [mover]                     # campaña intacta
    db = _db()
    try:
        assert db.query(PDVModel).get(mover).AssignedUserId == b["UserId"]
        assert db.query(RouteModel).get(rb["RouteId"]).IsOptimized is True
        planned = [x.PdvId for x in db.query(RouteDayPdvModel).filter_by(RouteDayId=day["RouteDayId"]).order_by(RouteDayPdvModel.PlannedOrder)]
        assert planned == [b0, mover, b2, b4]                    # el día futuro toma el orden nuevo
    finally:
        db.close()
    item = next(i for i in client.get("/pdvs/admin-list", params={"q": "Mv_", "page_size": 200}).json()["items"] if i["PdvId"] == mover)
    assert (item["RouteId"], item["RouteName"]) == (rb["RouteId"], rb["Name"])

    # Repetir no cambia nada; sacar de ruta lo deja sin ruta regular
    assert client.post("/routes/move-pdv", json={"pdv_id": mover, "to_route_id": rb["RouteId"]}).json()["changed"] is False
    assert client.post("/routes/move-pdv", json={"pdv_id": mover, "to_route_id": None}).json()["changed"] is True
    assert _order(rb["RouteId"]) == [b0, b2, b4]


def test_move_validaciones_y_permisos(client):
    a = _user(client, "vendedor")
    ch = client.post("/channels", json={"Name": f"MvCh_{_uid()}"}).json()["ChannelId"]
    p = _pdv_at(client, ch, -34.6, -58.4)
    reg = _route(client, a["UserId"])
    camp = _route(client, a["UserId"], "campaign", end=today_ar() + timedelta(days=30))
    assert client.post("/routes/move-pdv", json={"pdv_id": p, "to_route_id": camp["RouteId"]}).status_code == 400
    assert client.post("/routes/move-pdv", json={"pdv_id": 99999999, "to_route_id": reg["RouteId"]}).status_code == 404
    assert client.post("/routes/move-pdv", json={"pdv_id": p, "to_route_id": 99999999}).status_code == 404
    h = _login(client, a["Email"])
    assert client.post("/routes/move-pdv", json={"pdv_id": p, "to_route_id": reg["RouteId"]}, headers=h).status_code == 403
    outsider = _user(client, "territory_manager")
    ho = _login(client, outsider["Email"])
    assert client.post("/routes/move-pdv", json={"pdv_id": p, "to_route_id": reg["RouteId"]}, headers=ho).status_code == 403
