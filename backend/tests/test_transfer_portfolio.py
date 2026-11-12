"""Traspaso masivo de cartera entre trades (POST /routes/transfer-portfolio, 2026-11-12)."""
from datetime import timedelta

from app.models import AuditEvent, PDV as PDVModel, Route as RouteModel
from app.models import RouteDay as RouteDayModel, RouteDayPdv as RouteDayPdvModel, RoutePdv as RoutePdvModel
from app.models.route import today_ar

from tests.test_route_campaign import _db, _login, _pdv, _route, _user


def _setup(client):
    a, b = _user(client, "vendedor"), _user(client, "vendedor")
    pdvs = [_pdv(client)["PdvId"] for _ in range(3)]
    reg = _route(client, a["UserId"])
    camp = _route(client, a["UserId"], route_type="campaign", end=today_ar() + timedelta(days=30))
    for i, pid in enumerate(pdvs, 1):
        assert client.post(f"/routes/{reg['RouteId']}/pdvs", json={"PdvId": pid, "SortOrder": i}).status_code == 201
    assert client.post(f"/routes/{camp['RouteId']}/pdvs", json={"PdvId": pdvs[0], "SortOrder": 1}).status_code == 201
    day = client.post(f"/routes/{reg['RouteId']}/days", json={
        "WorkDate": (today_ar() + timedelta(days=3)).isoformat(), "AssignedUserId": a["UserId"]})
    assert day.status_code == 201, day.text
    return a, b, pdvs, reg, camp, day.json()


def _state(pdvs, reg, camp, day):
    db = _db()
    try:
        return {
            "owners": [db.query(PDVModel).get(p).AssignedUserId for p in pdvs],
            "reg": sorted(r.PdvId for r in db.query(RoutePdvModel).filter_by(RouteId=reg["RouteId"])),
            "camp": sorted(r.PdvId for r in db.query(RoutePdvModel).filter_by(RouteId=camp["RouteId"])),
            "day": sorted(r.PdvId for r in db.query(RouteDayPdvModel).filter_by(RouteDayId=day["RouteDayId"])),
            "reg_owner": db.query(RouteModel).get(reg["RouteId"]).AssignedUserId,
            "camp_owner": db.query(RouteModel).get(camp["RouteId"]).AssignedUserId,
            "day_owner": db.query(RouteDayModel).get(day["RouteDayId"]).AssignedUserId,
        }
    finally:
        db.close()


def test_partial_dry_run_then_commit(client):
    a, b, pdvs, reg, camp, day = _setup(client)
    before = _state(pdvs, reg, camp, day)
    assert before["owners"] == [a["UserId"]] * 3 and before["day"] == sorted(pdvs)

    r = client.post("/routes/transfer-portfolio", json={"to_user_id": b["UserId"], "pdv_ids": pdvs[:2]})
    assert r.status_code == 200, r.text
    assert r.json()["dry_run"] is True and r.json()["pdvs"] == 2
    assert r.json()["routes"] == [{"RouteId": reg["RouteId"], "Name": reg["Name"], "pdvs": 2}]
    assert _state(pdvs, reg, camp, day) == before  # dry-run no escribe

    r = client.post("/routes/transfer-portfolio", json={"to_user_id": b["UserId"], "pdv_ids": pdvs[:2], "dry_run": False})
    assert r.status_code == 200, r.text
    st = _state(pdvs, reg, camp, day)
    assert st["owners"] == [b["UserId"], b["UserId"], a["UserId"]]
    assert st["reg"] == [pdvs[2]] and st["day"] == [pdvs[2]]      # salen de la ruta y del día futuro
    assert st["camp"] == [pdvs[0]]                                # la campaña no se toca
    assert st["reg_owner"] == a["UserId"]
    db = _db()
    try:
        ev = db.query(AuditEvent).filter_by(Action="PDV_TRANSFER", EntityId=str(b["UserId"])).all()
        assert len(ev) == 1 and str(pdvs[0]) in ev[0].PayloadJson
        assert db.query(AuditEvent).filter_by(Action="ROUTE_PDV_DEL", EntityId=str(reg["RouteId"])).count() >= 1
    finally:
        db.close()

    # Idempotente: repetir no rompe y reporta que ya eran del destino
    r = client.post("/routes/transfer-portfolio", json={"to_user_id": b["UserId"], "pdv_ids": pdvs[:2], "dry_run": False})
    assert r.status_code == 200 and r.json()["already_owned"] == 2 and r.json()["routes"] == []


def test_partial_keeps_destination_routes(client):
    a, b, pdvs, reg, camp, day = _setup(client)
    # la ruta entera ya es del destino → el PDV no sale de ella
    assert client.patch(f"/routes/{reg['RouteId']}", json={"AssignedUserId": b["UserId"]}).status_code == 200
    c = _user(client, "vendedor")
    r = client.post("/routes/transfer-portfolio", json={"to_user_id": b["UserId"], "pdv_ids": pdvs, "dry_run": False})
    assert r.status_code == 200 and r.json()["routes"] == [] and r.json()["already_owned"] == 3
    assert _state(pdvs, reg, camp, day)["reg"] == sorted(pdvs)
    r = client.post("/routes/transfer-portfolio", json={"to_user_id": c["UserId"], "pdv_ids": pdvs[:1], "dry_run": False})
    assert r.json()["routes"][0]["pdvs"] == 1
    assert _state(pdvs, reg, camp, day)["reg"] == sorted(pdvs[1:])


def test_whole_portfolio(client):
    a, b, pdvs, reg, camp, day = _setup(client)
    r = client.post("/routes/transfer-portfolio", json={"to_user_id": b["UserId"], "from_user_id": a["UserId"]})
    assert r.status_code == 200 and r.json()["pdvs"] == 3 and r.json()["future_days"] == 1
    assert [x["RouteId"] for x in r.json()["routes"]] == [reg["RouteId"]]
    assert _state(pdvs, reg, camp, day)["reg_owner"] == a["UserId"]

    r = client.post("/routes/transfer-portfolio", json={"to_user_id": b["UserId"], "from_user_id": a["UserId"], "dry_run": False})
    assert r.status_code == 200, r.text
    st = _state(pdvs, reg, camp, day)
    assert st["owners"] == [b["UserId"]] * 3
    assert st["reg_owner"] == b["UserId"] and st["day_owner"] == b["UserId"]
    assert st["reg"] == sorted(pdvs) and st["day"] == sorted(pdvs)   # la ruta sigue armada
    assert st["camp_owner"] == a["UserId"]                           # campaña intacta


def test_validations_and_admin_only(client):
    a, b, pdvs, *_ = _setup(client)
    post = lambda body, **kw: client.post("/routes/transfer-portfolio", json=body, **kw)  # noqa: E731
    assert post({"to_user_id": b["UserId"]}).status_code == 422
    assert post({"to_user_id": b["UserId"], "from_user_id": a["UserId"], "pdv_ids": pdvs}).status_code == 422
    assert post({"to_user_id": a["UserId"], "from_user_id": a["UserId"]}).status_code == 422
    assert post({"to_user_id": 99999999, "pdv_ids": pdvs}).status_code == 422
    assert post({"to_user_id": b["UserId"], "pdv_ids": [99999999]}).status_code == 404
    tm = _user(client, "territory_manager")
    assert post({"to_user_id": b["UserId"], "pdv_ids": pdvs}, headers=_login(client, tm["Email"])).status_code == 403
    assert client.get("/pdvs/admin-ids", headers=_login(client, tm["Email"])).status_code == 403


def test_admin_ids_matches_filters(client):
    a, b, pdvs, *_ = _setup(client)
    r = client.get("/pdvs/admin-ids", params={"assigned_user_id": a["UserId"]})
    assert r.status_code == 200 and r.json() == {"ids": sorted(pdvs), "truncated": False}
    r = client.get("/pdvs/admin-ids", params={"assigned_user_id": a["UserId"], "has_route": "false"})
    assert r.json()["ids"] == []
