"""Tests de `app/services/behavior.py` y `GET /intelligence/behavior`.

Fixtures al estilo de `test_tmr_dashboard.py` (session sobre `app.database.engine`,
rollback al final). Las horas se escriben en hora argentina con `ar(...)` y se
guardan como UTC naive (+3 h), igual que `Visit.OpenedAt` en prod.
"""
import uuid
from datetime import date, datetime, timedelta

import bcrypt
import pytest
from sqlalchemy.orm import sessionmaker

from app.auth import create_access_token
from app.database import engine
from app.models import (
    File as FileModel,
    PDV as PDVModel,
    Role as RoleModel,
    Route as RouteModel,
    RouteDay as RouteDayModel,
    RouteDayPdv as RouteDayPdvModel,
    User as UserModel,
    UserRole as UserRoleModel,
    Visit as VisitModel,
    VisitCheck as VisitCheckModel,
    VisitPhoto as VisitPhotoModel,
)
from app.routers import intelligence as intel_router
from app.routers.route_generator import _haversine_km as rg_haversine
from app.services import behavior as B
from app.services.behavior import build_behavior
from app.utils.geo import haversine_km

# Semana en el pasado (lun 13 → vie 17 de abril de 2026) para no depender de "hoy".
D1, D2, D3 = date(2026, 4, 13), date(2026, 4, 14), date(2026, 4, 15)
LAT, LON = -34.600000, -58.400000  # PDV base; +0.009 de latitud ≈ 1 km


def ar(d: date, hh: int, mm: int = 0) -> datetime:
    """Hora argentina (UTC-3) → UTC naive, como se persiste."""
    return datetime(d.year, d.month, d.day, hh, mm) + timedelta(hours=3)


@pytest.fixture()
def db():
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


@pytest.fixture(autouse=True)
def _clear_behavior_cache():
    intel_router._BEHAVIOR_CACHE.clear()
    yield


def _uid():
    return uuid.uuid4().hex[:8]


def _user(db):
    u = UserModel(Email=f"u_{_uid()}@beh.test", DisplayName=f"Beh {_uid()}", PasswordHash="x", IsActive=True)
    db.add(u)
    db.flush()
    return u


def _user_with_role(db, role_name):
    role = db.query(RoleModel).filter(RoleModel.Name == role_name).first()
    if not role:
        role = RoleModel(Name=role_name)
        db.add(role)
        db.flush()
    u = UserModel(
        Email=f"{role_name}_{_uid()}@beh.test", DisplayName=f"Beh {role_name}",
        PasswordHash=bcrypt.hashpw(b"x", bcrypt.gensalt()).decode(), IsActive=True,
    )
    db.add(u)
    db.flush()
    db.add(UserRoleModel(UserId=u.UserId, RoleId=role.RoleId))
    db.commit()
    db.refresh(u)
    return u, create_access_token(subject=u.UserId, role=role_name)


def _pdv(db, lat=LAT, lon=LON):
    p = PDVModel(Name=f"PDV_{_uid()}", IsActive=True, Lat=lat, Lon=lon)
    db.add(p)
    db.flush()
    return p


def _route(db, user_id):
    r = RouteModel(Name=f"R_{_uid()}", IsActive=True, AssignedUserId=user_id, IsFocus=True)
    db.add(r)
    db.flush()
    return r


def _plan(db, route, user_id, work_date, pdvs_in_order):
    rd = RouteDayModel(RouteId=route.RouteId, WorkDate=work_date, AssignedUserId=user_id, Status="PLANNED")
    db.add(rd)
    db.flush()
    for i, p in enumerate(pdvs_in_order, start=1):
        db.add(RouteDayPdvModel(RouteDayId=rd.RouteDayId, PdvId=p.PdvId, PlannedOrder=i))
    db.flush()
    return rd


def _visit(db, pdv, user, opened, minutes=20):
    v = VisitModel(
        PdvId=pdv.PdvId, UserId=user.UserId, OpenedAt=opened,
        Status="CLOSED" if minutes is not None else "OPEN",
        ClosedAt=opened + timedelta(minutes=minutes) if minutes is not None else None,
    )
    db.add(v)
    db.flush()
    return v


def _check(db, visit, kind, ts, lat=LAT, lon=LON, acc=10, dist=5, battery=None):
    c = VisitCheckModel(
        VisitId=visit.VisitId, CheckType=kind, Ts=ts, Lat=lat, Lon=lon,
        AccuracyMeters=acc, DistanceToPdvM=dist, BatteryPct=battery,
    )
    db.add(c)
    db.flush()
    return c


def _photo(db, visit, taken, lat, lon):
    f = FileModel(BlobKey=f"blob_{_uid()}", OriginalName="x.jpg", TakenAt=taken, Lat=lat, Lon=lon)
    db.add(f)
    db.flush()
    db.add(VisitPhotoModel(VisitId=visit.VisitId, FileId=f.FileId, PhotoType="pop"))
    db.flush()


def _day(payload, d):
    return next(x for x in payload["dias"] if x["fecha"] == d.isoformat())


def _tipos(alertas):
    return sorted(a["tipo"] for a in alertas)


# ---------------------------------------------------------------------------
# geo
# ---------------------------------------------------------------------------

def test_haversine_compartido_con_route_generator():
    assert rg_haversine is haversine_km
    # Obelisco → Plaza de Mayo ≈ 1 km
    assert 0.9 < haversine_km(-34.6037, -58.3816, -34.6083, -58.3712) < 1.2
    assert haversine_km(LAT, LON, LAT, LON) == 0.0


# ---------------------------------------------------------------------------
# ON / OFF
# ---------------------------------------------------------------------------

def test_on_off_desde_checks(db):
    u, p = _user(db), _pdv(db)
    v1 = _visit(db, p, u, ar(D1, 9, 5))
    _check(db, v1, "IN", ar(D1, 9, 0))
    _check(db, v1, "OUT", ar(D1, 9, 20))
    v2 = _visit(db, p, u, ar(D1, 12, 0))
    _check(db, v2, "IN", ar(D1, 12, 0))
    _check(db, v2, "OUT", ar(D1, 17, 30))

    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert d["on"] == "2026-04-13T09:00:00-03:00" and d["onSource"] == "gps"
    assert d["off"] == "2026-04-13T17:30:00-03:00" and d["offSource"] == "gps"
    assert d["activoMin"] == 510
    assert d["diaLabel"] == "lun 13/04"
    assert "on_tarde" not in _tipos(d["alertas"]) and "off_temprano" not in _tipos(d["alertas"])


def test_on_off_fallback_visita_sin_checks(db):
    u, p = _user(db), _pdv(db)
    _visit(db, p, u, ar(D1, 9, 0), minutes=30)
    _visit(db, p, u, ar(D1, 15, 0), minutes=None)  # abierta: no aporta OFF

    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert d["on"] == "2026-04-13T09:00:00-03:00" and d["onSource"] == "visit"
    assert d["off"] == "2026-04-13T09:30:00-03:00" and d["offSource"] == "visit"
    assert d["abiertas"] == 1 and "visita_abierta" in _tipos(d["alertas"])


def test_on_off_gana_el_mas_temprano_y_el_mas_tardio(db):
    """Caso real: visita 10:45 sin GPS + visita 11:40 con check-in → on=10:45 (visit),
    no 11:40 (gps). Simétrico para OFF: cierre 17:00 sin check-out > último OUT 16:30.
    on_tarde se evalúa sobre el ON resultante."""
    u, p = _user(db), _pdv(db)
    _visit(db, p, u, ar(D1, 10, 45), minutes=20)                 # sin GPS
    v = _visit(db, p, u, ar(D1, 11, 40), minutes=30)
    _check(db, v, "IN", ar(D1, 11, 40))
    _check(db, v, "OUT", ar(D1, 16, 30))
    _visit(db, p, u, ar(D1, 16, 40), minutes=20)                 # cierra 17:00 sin OUT

    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert d["on"] == "2026-04-13T10:45:00-03:00" and d["onSource"] == "visit"
    assert d["off"] == "2026-04-13T17:00:00-03:00" and d["offSource"] == "visit"
    assert "on_tarde" in _tipos(d["alertas"])        # 10:45 > 10:00
    assert "off_temprano" not in _tipos(d["alertas"])  # 17:00, no 16:30


def test_off_null_si_nada_cerrado(db):
    u, p = _user(db), _pdv(db)
    _visit(db, p, u, ar(D1, 9, 0), minutes=None)
    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert d["off"] is None and d["offSource"] is None and d["activoMin"] is None


# ---------------------------------------------------------------------------
# Fecha AR
# ---------------------------------------------------------------------------

def test_visita_2330_ar_cae_en_el_dia_ar(db):
    """23:30 AR del 14 = 02:30 UTC del 15: pertenece al 14."""
    u, p = _user(db), _pdv(db)
    _visit(db, p, u, ar(D2, 23, 30), minutes=10)

    r = build_behavior(db, u.UserId, D2, D2)
    assert [d["fecha"] for d in r["dias"]] == [D2.isoformat()]
    assert r["dias"][0]["on"] == "2026-04-14T23:30:00-03:00"
    # el rango del 15 no la incluye
    assert build_behavior(db, u.UserId, D3, D3)["dias"] == []


def test_rango_inclusivo_y_orden_descendente(db):
    u, p = _user(db), _pdv(db)
    _visit(db, p, u, ar(D1, 9))
    _visit(db, p, u, ar(D3, 9))
    r = build_behavior(db, u.UserId, D1, D3)
    assert [d["fecha"] for d in r["dias"]] == [D3.isoformat(), D1.isoformat()]
    assert r["from"] == D1.isoformat() and r["to"] == D3.isoformat()
    assert r["perimeterM"] == B.PERIMETER_M == 200


# ---------------------------------------------------------------------------
# GPS / km
# ---------------------------------------------------------------------------

def test_km_descarta_precision_mala_y_saltos(db):
    u, p = _user(db), _pdv(db)
    v = _visit(db, p, u, ar(D1, 9))
    _check(db, v, "IN", ar(D1, 9, 0), lat=LAT, lon=LON)                       # A
    _check(db, v, "OUT", ar(D1, 9, 10), lat=-34.7, lon=-58.5, acc=600)         # precisión > 500 → fuera
    v2 = _visit(db, p, u, ar(D1, 10))
    _check(db, v2, "IN", ar(D1, 10, 0), lat=LAT - 0.009, lon=LON)              # B ≈ 1 km de A
    _check(db, v2, "OUT", ar(D1, 10, 10), lat=-33.0, lon=LON)                  # salto ≈ 178 km → fuera
    _photo(db, v2, ar(D1, 10, 5), LAT - 0.018, LON)                            # C ≈ 1 km de B (foto)

    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert [(pt["seq"], pt["tipo"]) for pt in d["puntos"]] == [(1, "in"), (2, "in"), (3, "foto")]
    assert 1.9 < d["kmLinea"] < 2.1
    assert d["puntos"][2]["visitId"] == v2.VisitId and d["puntos"][2]["acc"] is None


def test_secuencia_km_desde_anterior_y_dist_pdv_calculada(db):
    u = _user(db)
    p1, p2 = _pdv(db), _pdv(db, lat=LAT - 0.018, lon=LON)
    v1 = _visit(db, p1, u, ar(D1, 9))
    _check(db, v1, "IN", ar(D1, 9), dist=None)                                  # sin DistanceToPdvM → se calcula
    v2 = _visit(db, p2, u, ar(D1, 10))
    _check(db, v2, "IN", ar(D1, 10), lat=LAT - 0.018, lon=LON, dist=12)

    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    s1, s2 = d["secuencia"]
    assert s1["seq"] == 1 and s1["distPdv"] == 0.0 and s1["kmDesdeAnterior"] is None
    assert s2["seq"] == 2 and s2["distPdv"] == 12.0 and 1.9 < s2["kmDesdeAnterior"] < 2.1
    assert s2["lat"] == pytest.approx(LAT - 0.018) and s2["hasGps"] is True


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

def test_plan_visitado_y_orden_respetado(db):
    u = _user(db)
    r = _route(db, u.UserId)
    p1, p2, p3 = _pdv(db), _pdv(db), _pdv(db)
    _plan(db, r, u.UserId, D1, [p1, p2, p3])
    _visit(db, p1, u, ar(D1, 9))
    _visit(db, p3, u, ar(D1, 10))
    _visit(db, _pdv(db), u, ar(D1, 11))  # fuera de plan

    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert d["planificados"] == 3 and d["planVisitados"] == 2 and d["visitas"] == 3
    assert d["ordenRespetado"] is True
    assert [x["pdvId"] for x in d["planNoVisitados"]] == [p2.PdvId]
    assert d["planNoVisitados"][0]["plannedOrder"] == 2
    assert [s["plannedOrder"] for s in d["secuencia"]] == [1, 3, None]
    tipos = _tipos(d["alertas"])
    assert "plan_no_visitado" in tipos and "orden_distinto" not in tipos


def test_orden_distinto(db):
    u = _user(db)
    r = _route(db, u.UserId)
    p1, p2 = _pdv(db), _pdv(db)
    _plan(db, r, u.UserId, D1, [p1, p2])
    _visit(db, p2, u, ar(D1, 9))
    _visit(db, p1, u, ar(D1, 10))

    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert d["ordenRespetado"] is False
    assert "orden_distinto" in _tipos(d["alertas"])


def test_orden_null_con_menos_de_dos_planificados_visitados(db):
    u = _user(db)
    r = _route(db, u.UserId)
    p1, p2 = _pdv(db), _pdv(db)
    _plan(db, r, u.UserId, D1, [p1, p2])
    _visit(db, p1, u, ar(D1, 9))
    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert d["ordenRespetado"] is None


def test_plan_sin_visitas(db):
    u = _user(db)
    r = _route(db, u.UserId)
    _plan(db, r, u.UserId, D2, [_pdv(db), _pdv(db)])
    _visit(db, _pdv(db), u, ar(D1, 9))

    res = build_behavior(db, u.UserId, D1, D2)
    d2 = _day(res, D2)
    assert d2["visitas"] == 0 and d2["planificados"] == 2 and d2["on"] is None
    assert _tipos(d2["alertas"]) == ["plan_sin_visitas"]
    assert d2["alertas"][0]["severidad"] == "alta"
    assert len(d2["planNoVisitados"]) == 2
    assert res["resumen"]["dias"] == 1
    assert res["resumen"]["diasConPlan"] == 1 and res["resumen"]["diasConPlanSinVisitas"] == 1


# ---------------------------------------------------------------------------
# Alertas por visita / día
# ---------------------------------------------------------------------------

def test_alertas_sin_gps_fuera_perimetro_corta(db):
    u, p = _user(db), _pdv(db)
    v_sin = _visit(db, p, u, ar(D1, 9))                                          # sin checks
    v_fuera = _visit(db, p, u, ar(D1, 10))
    _check(db, v_fuera, "IN", ar(D1, 10), dist=350)
    v_corta = _visit(db, p, u, ar(D1, 11), minutes=2)
    _check(db, v_corta, "IN", ar(D1, 11), dist=3)

    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert d["sinGps"] == 1 and d["fueraPerimetro"] == 1 and d["cortas"] == 1
    assert d["gpsPct"] == 67
    by_visit = {s["visitId"]: s["alertas"] for s in d["secuencia"]}
    assert by_visit[v_sin.VisitId] == ["sin_gps"]
    assert by_visit[v_fuera.VisitId] == ["fuera_perimetro"]
    assert by_visit[v_corta.VisitId] == ["visita_corta"]
    fuera = next(a for a in d["alertas"] if a["tipo"] == "fuera_perimetro")
    assert fuera["severidad"] == "alta" and fuera["visitId"] == v_fuera.VisitId and fuera["pdvName"] == p.Name


def test_on_tarde_off_temprano_y_bateria(db):
    u, p = _user(db), _pdv(db)
    v = _visit(db, p, u, ar(D1, 10, 30))
    _check(db, v, "IN", ar(D1, 10, 30), battery=40)
    _check(db, v, "OUT", ar(D1, 15, 0), battery=9)

    res = build_behavior(db, u.UserId, D1, D1)
    d = _day(res, D1)
    tipos = _tipos(d["alertas"])
    assert "on_tarde" in tipos and "off_temprano" in tipos and "bateria_baja" in tipos
    assert d["bateriaInicio"] == 40 and d["bateriaFin"] == 9
    assert res["resumen"]["onTarde"] == 1 and res["resumen"]["offTemprano"] == 1
    assert res["resumen"]["bateriaBaja"] == 1


def test_on_a_las_10_en_punto_no_es_tarde(db):
    u, p = _user(db), _pdv(db)
    v = _visit(db, p, u, ar(D1, 10, 0))
    _check(db, v, "IN", ar(D1, 10, 0))
    _check(db, v, "OUT", ar(D1, 16, 0))
    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert "on_tarde" not in _tipos(d["alertas"]) and "off_temprano" not in _tipos(d["alertas"])


# ---------------------------------------------------------------------------
# Resumen
# ---------------------------------------------------------------------------

def test_resumen_promedios(db):
    u = _user(db)
    r = _route(db, u.UserId)
    p1, p2, p3 = _pdv(db), _pdv(db), _pdv(db)
    _plan(db, r, u.UserId, D1, [p1, p2])
    # D1: 3 visitas a 2 PDVs, ON 9:00 OFF 17:00
    v = _visit(db, p1, u, ar(D1, 9), minutes=30)
    _check(db, v, "IN", ar(D1, 9))
    _visit(db, p1, u, ar(D1, 11), minutes=10)
    v = _visit(db, p2, u, ar(D1, 14), minutes=20)
    _check(db, v, "OUT", ar(D1, 17))
    # D2: 1 visita, ON 11:00 OFF 11:20 (fallback visit)
    _visit(db, p3, u, ar(D2, 11), minutes=20)

    res = build_behavior(db, u.UserId, D1, D3)
    s = res["resumen"]
    assert s["dias"] == 2 and s["visitas"] == 4 and s["pdvs"] == 3
    assert s["visitasPorDia"] == 2.0 and s["pdvsPorDia"] == 1.5
    assert s["onProm"] == "10:00" and s["offProm"] == "14:10"
    assert s["activoPromMin"] == 250          # (480 + 20) / 2
    assert s["durPromMin"] == 20              # (30+10+20+20)/4
    assert s["planificados"] == 2 and s["planVisitados"] == 2 and s["planPct"] == 100
    assert s["ordenRespetadoPct"] == 100
    assert s["visitasSinGps"] == 2 and s["visitasAbiertas"] == 0
    assert s["kmLinea"] == 0.0 and s["kmLineaPorDia"] == 0.0
    assert res["userName"] == u.DisplayName
    assert len(res["alertas"]) == sum(len(d["alertas"]) for d in res["dias"])


def test_resumen_vacio(db):
    u = _user(db)
    res = build_behavior(db, u.UserId, D1, D3)
    s = res["resumen"]
    assert res["dias"] == [] and res["alertas"] == []
    assert s["dias"] == 0 and s["onProm"] is None and s["planPct"] is None
    assert s["ordenRespetadoPct"] is None and s["activoPromMin"] is None


def test_rango_invalido_en_servicio():
    with pytest.raises(ValueError):
        build_behavior(None, 1, D2, D1)
    with pytest.raises(ValueError):
        build_behavior(None, 1, D1, D1 + timedelta(days=B.MAX_RANGE_DAYS))


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

def test_endpoint_400_rango_invertido(client, db):
    u, _ = _user_with_role(db, "vendedor")
    resp = client.get("/intelligence/behavior", params={"user_id": u.UserId, "date_from": "2026-04-15", "date_to": "2026-04-13"})
    assert resp.status_code == 400


def test_endpoint_400_rango_muy_largo(client, db):
    u, _ = _user_with_role(db, "vendedor")
    resp = client.get("/intelligence/behavior", params={"user_id": u.UserId, "date_from": "2026-01-01", "date_to": "2026-04-30"})
    assert resp.status_code == 400
    assert str(B.MAX_RANGE_DAYS) in resp.json()["detail"]


def test_endpoint_403_no_admin(client, db):
    u, token = _user_with_role(db, "vendedor")
    resp = client.get(
        "/intelligence/behavior",
        params={"user_id": u.UserId, "date_from": "2026-04-13", "date_to": "2026-04-13"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_endpoint_404_usuario_inexistente(client):
    resp = client.get("/intelligence/behavior", params={"user_id": 999999999, "date_from": "2026-04-13", "date_to": "2026-04-13"})
    assert resp.status_code == 404


def test_endpoint_200_admin_shape(client, db):
    u, _ = _user_with_role(db, "vendedor")
    resp = client.get("/intelligence/behavior", params={"user_id": u.UserId, "date_from": "2026-04-13", "date_to": "2026-04-15"})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"userId", "userName", "from", "to", "perimeterM", "resumen", "alertas", "dias"}
    assert body["userId"] == u.UserId and body["perimeterM"] == 200
    assert set(body["resumen"]) == {
        "dias", "diasConPlan", "diasConPlanSinVisitas", "visitas", "pdvs", "pdvsPorDia", "visitasPorDia",
        "visitasSinGps", "fueraPerimetro", "visitasCortas", "visitasAbiertas", "kmLinea", "kmLineaPorDia",
        "onProm", "offProm", "activoPromMin", "durPromMin", "planificados", "planVisitados", "planPct",
        "ordenRespetadoPct", "onTarde", "offTemprano", "bateriaBaja",
    }


def test_shape_dia_punto_secuencia(db):
    """Contrato con el frontend (se construye en paralelo contra estas keys)."""
    u = _user(db)
    r = _route(db, u.UserId)
    p1, p2 = _pdv(db), _pdv(db)
    _plan(db, r, u.UserId, D1, [p1, p2])
    v = _visit(db, p1, u, ar(D1, 9))
    _check(db, v, "IN", ar(D1, 9), battery=80)

    d = _day(build_behavior(db, u.UserId, D1, D1), D1)
    assert set(d) == {
        "fecha", "diaLabel", "on", "onSource", "off", "offSource", "activoMin", "visitas", "pdvs",
        "planificados", "planVisitados", "ordenRespetado", "kmLinea", "gpsPct", "sinGps", "fueraPerimetro",
        "cortas", "abiertas", "bateriaInicio", "bateriaFin", "alertas", "puntos", "secuencia", "planNoVisitados",
    }
    assert set(d["puntos"][0]) == {"seq", "ts", "tipo", "lat", "lon", "acc", "distPdv", "bateria", "visitId", "pdvId", "pdvName"}
    assert set(d["secuencia"][0]) == {
        "seq", "visitId", "pdvId", "pdvName", "lat", "lon", "openedAt", "closedAt", "durMin", "plannedOrder",
        "hasGps", "distPdv", "kmDesdeAnterior", "alertas",
    }
    assert set(d["planNoVisitados"][0]) == {"pdvId", "pdvName", "lat", "lon", "plannedOrder"}
    assert set(d["alertas"][0]) == {"tipo", "severidad", "fecha", "visitId", "pdvId", "pdvName", "detalle"}
