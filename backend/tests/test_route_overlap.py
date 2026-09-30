"""Aviso (no restricción) de 2 rutas del mismo trade el mismo día — 2026-09-30."""
import json
import uuid
from datetime import timedelta

from app.models.route import today_ar
from app.routers.routes import planned_dates

TODAY = today_ar()


def _uid():
    return uuid.uuid4().hex[:8]


def _trade(client):
    r = client.post("/users", json={"Email": f"ov_{_uid()}@t.com", "DisplayName": f"Trade {_uid()}", "Password": "Pass123!", "RoleName": "vendedor"})
    assert r.status_code == 201, r.text
    return r.json()


def _next_js_day(js_day: int):
    """Próxima fecha (>= hoy) con ese día JS (0 = domingo)."""
    d = TODAY
    while (d.weekday() + 1) % 7 != js_day:
        d += timedelta(days=1)
    return d


def _weekly(js_day: int):
    return json.dumps({"day": js_day, "startDate": TODAY.isoformat()})


def _route(client, uid, freq=None, cfg=None, **kw):
    body = {"Name": f"R_{_uid()}", "AssignedUserId": uid, "FrequencyType": freq, "FrequencyConfig": cfg, **kw}
    r = client.post("/routes", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_preview_avisa_misma_frecuencia(client):
    t = _trade(client)
    lunes = _route(client, t["UserId"], "weekly", _weekly(1))
    r = client.post("/routes/overlap-preview", json={"AssignedUserId": t["UserId"], "FrequencyType": "weekly", "FrequencyConfig": _weekly(1)})
    body = r.json()
    assert r.status_code == 200 and body["hasOverlap"] is True
    o = body["overlaps"][0]
    assert o["routeId"] == lunes["RouteId"] and o["overlapDates"][0] == _next_js_day(1).isoformat()
    # Otro día de la semana: sin aviso.
    r = client.post("/routes/overlap-preview", json={"AssignedUserId": t["UserId"], "FrequencyType": "weekly", "FrequencyConfig": _weekly(3)})
    assert r.json()["hasOverlap"] is False


def test_preview_cuenta_dias_cargados_a_mano_y_campanas(client):
    t = _trade(client)
    manual = _route(client, t["UserId"])  # sin frecuencia, día cargado a mano
    d = _next_js_day(2)
    assert client.post(f"/routes/{manual['RouteId']}/days", json={"WorkDate": d.isoformat()}).status_code == 201
    camp = _route(client, t["UserId"], "weekly", _weekly(2), RouteType="campaign", EndDate=(TODAY + timedelta(days=40)).isoformat())
    r = client.post("/routes/overlap-preview", json={"AssignedUserId": t["UserId"], "FrequencyType": "weekly", "FrequencyConfig": _weekly(2)})
    ids = {o["routeId"]: o for o in r.json()["overlaps"]}
    assert set(ids) == {manual["RouteId"], camp["RouteId"]}
    assert ids[camp["RouteId"]]["routeType"] == "campaign"


def test_no_restringe_y_check_post_guardado(client):
    t = _trade(client)
    a = _route(client, t["UserId"], "weekly", _weekly(4))
    b = _route(client, t["UserId"], "weekly", _weekly(4))  # se crea igual (no bloquea)
    r = client.get(f"/routes/{b['RouteId']}/check-overlap").json()
    assert r["hasOverlap"] and r["overlaps"][0]["routeId"] == a["RouteId"] and r["overlaps"][0]["overlapCount"] >= 7


def test_ruta_vencida_o_fin_antes_no_avisan(client):
    t = _trade(client)
    old_cfg = json.dumps({"day": 5, "startDate": (TODAY - timedelta(days=60)).isoformat()})
    _route(client, t["UserId"], "weekly", old_cfg, EndDate=(TODAY - timedelta(days=1)).isoformat())
    r = client.post("/routes/overlap-preview", json={"AssignedUserId": t["UserId"], "FrequencyType": "weekly", "FrequencyConfig": _weekly(5)})
    assert r.json()["hasOverlap"] is False
    # La nueva termina antes del próximo viernes: tampoco.
    other = _route(client, t["UserId"], "weekly", _weekly(5))
    fin = _next_js_day(5) - timedelta(days=1)
    if fin >= TODAY:
        r = client.post("/routes/overlap-preview", json={"AssignedUserId": t["UserId"], "FrequencyType": "weekly",
                                                         "FrequencyConfig": _weekly(5), "EndDate": fin.isoformat()})
        assert other["RouteId"] not in {o["routeId"] for o in r.json()["overlaps"]}


def test_planned_dates_cada_x_dias_y_mensual():
    cfg = json.dumps({"interval": 10, "startDate": TODAY.isoformat()})
    ds = sorted(planned_dates("every_x_days", cfg))
    assert ds[0] == TODAY and ds[1] == TODAY + timedelta(days=10)  # antes: every_x_days no se chequeaba
    m = sorted(planned_dates("monthly", json.dumps({"startDate": TODAY.isoformat()})))
    assert m[0] == TODAY and len(m) >= 2
    assert planned_dates("weekly", "{roto") == set()
