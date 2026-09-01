"""Tests de `app/services/tmr_dashboard.py` — los recursos del Tablero TMR.

`build_team` calcula todo con agregados SQL (`GROUP BY`) en vez de traer las
visitas a Python. Eso mete dos riesgos que estos tests cubren:

1. **Dialecto**: la duración promedio usa `DATEDIFF` en Azure SQL y `julianday`
   en la SQLite de los tests (`_duration_minutes_expr`). Sin un test que corra
   el cálculo, la rama SQLite —o sea, todo el entorno de desarrollo— queda sin
   verificar.
2. **Universo**: los conteos se acotan a "PDV con ruta foco asignada al propio
   vendedor" con un join en la base. Una visita a un PDV fuera de la ruta, o a
   un PDV de la ruta de OTRO vendedor, no debe contar.
"""
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import (
    PDV as PDVModel,
    Route as RouteModel,
    RouteDay as RouteDayModel,
    RouteDayPdv as RouteDayPdvModel,
    RoutePdv as RoutePdvModel,
    User as UserModel,
    Visit as VisitModel,
    VisitAction as VisitActionModel,
    VisitCheck as VisitCheckModel,
    File as FileModel,
    VisitPhoto as VisitPhotoModel,
)
from app.services.tmr_dashboard import build_team

# Mes en el pasado respecto de "hoy" (2026-08) para que no dependa del día actual.
YEAR, MONTH = 2026, 4
DAY = datetime(YEAR, MONTH, 15, 12, 0, 0)


@pytest.fixture()
def db():
    SessionLocal = sessionmaker(bind=engine)
    s = SessionLocal()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def _uid():
    return uuid.uuid4().hex[:8]


def _user(db, zone_id=None):
    u = UserModel(
        Email=f"u_{_uid()}@tmr.test", DisplayName=f"TMR {_uid()}",
        PasswordHash="x", IsActive=True, ZoneId=zone_id,
    )
    db.add(u)
    db.flush()
    return u


def _pdv(db):
    p = PDVModel(Name=f"PDV_{_uid()}", IsActive=True)
    db.add(p)
    db.flush()
    return p


def _route(db, user_id, is_focus=True):
    r = RouteModel(Name=f"R_{_uid()}", IsActive=True, AssignedUserId=user_id, IsFocus=is_focus)
    db.add(r)
    db.flush()
    return r


def _link(db, route, pdv):
    db.add(RoutePdvModel(RouteId=route.RouteId, PdvId=pdv.PdvId, SortOrder=1))
    db.flush()


def _plan(db, route, pdv, user_id):
    rd = RouteDayModel(
        RouteId=route.RouteId, WorkDate=DAY.date(), AssignedUserId=user_id, Status="PLANNED"
    )
    db.add(rd)
    db.flush()
    db.add(RouteDayPdvModel(RouteDayId=rd.RouteDayId, PdvId=pdv.PdvId, PlannedOrder=1))
    db.flush()


def _visit(db, pdv, user, opened=DAY, minutes=None):
    v = VisitModel(
        PdvId=pdv.PdvId, UserId=user.UserId, OpenedAt=opened, Status="CLOSED",
        ClosedAt=opened + timedelta(minutes=minutes) if minutes is not None else None,
    )
    db.add(v)
    db.flush()
    return v


def _row_for(payload, user):
    return next(t for t in payload["trades"] if t["id"] == user.UserId)


def test_team_cuenta_visitas_y_pdvs_del_universo(db):
    u = _user(db)
    r = _route(db, u.UserId)
    p1, p2, p3 = _pdv(db), _pdv(db), _pdv(db)
    for p in (p1, p2, p3):
        _link(db, r, p)
    _plan(db, r, p1, u.UserId)
    _visit(db, p1, u)
    _visit(db, p1, u)  # segunda visita al mismo PDV
    _visit(db, p2, u)

    t = _row_for(build_team(db, [u.UserId], YEAR, MONTH), u)
    assert t["tot"] == 3          # visitas totales
    assert t["vis"] == 2          # PDVs distintos visitados
    assert t["pdvs"] == 3         # universo foco
    assert t["plan"] == 1         # PDVs planificados en el mes
    assert t["vis_plan"] == 1     # de los planificados, cuantos se visitaron
    assert t["ef_pct"] == 100     # 1 de 1 planificado: NO 2/1 = 200%


def test_team_ignora_pdv_sin_ruta_asignada(db):
    """Una visita a un PDV que no está en ninguna ruta foco del vendedor cuenta
    como visita pero NO como PDV del universo."""
    u = _user(db)
    r = _route(db, u.UserId)
    en_ruta, fuera = _pdv(db), _pdv(db)
    _link(db, r, en_ruta)
    _visit(db, en_ruta, u)
    _visit(db, fuera, u)

    t = _row_for(build_team(db, [u.UserId], YEAR, MONTH), u)
    assert t["tot"] == 2
    assert t["vis"] == 1
    assert t["pdvs"] == 1


def test_team_ignora_ruta_de_otro_vendedor(db):
    """El PDV está en una ruta foco, pero asignada a otro vendedor: no es
    universo de quien lo visitó."""
    dueño, otro = _user(db), _user(db)
    r = _route(db, dueño.UserId)
    p = _pdv(db)
    _link(db, r, p)
    _visit(db, p, otro)

    payload = build_team(db, [dueño.UserId, otro.UserId], YEAR, MONTH)
    t_otro = _row_for(payload, otro)
    assert t_otro["tot"] == 1
    assert t_otro["vis"] == 0
    assert t_otro["pdvs"] == 0


def test_team_promedia_duracion_en_minutos(db):
    """Cubre `_duration_minutes_expr` (julianday en SQLite, DATEDIFF en Azure).

    30 y 10 minutos -> promedio 20. Con `DATEDIFF(minute, ...)` sobre segundos
    fraccionarios esto se iba un minuto abajo, de ahí que se mida en segundos."""
    u = _user(db)
    p = _pdv(db)
    _visit(db, p, u, minutes=30)
    _visit(db, p, u, minutes=10)
    _visit(db, p, u, minutes=None)  # sin cerrar: no promedia

    t = _row_for(build_team(db, [u.UserId], YEAR, MONTH), u)
    assert t["tot"] == 3
    assert t["dur"] == 20


def test_team_porcentajes_de_gps_foto_y_accion(db):
    u = _user(db)
    p = _pdv(db)
    v1, v2 = _visit(db, p, u), _visit(db, p, u)
    db.add(VisitCheckModel(VisitId=v1.VisitId, CheckType="IN", Ts=DAY, Lat=-34.6, Lon=-58.4))
    f = FileModel(BlobKey=f"blob_{_uid()}", OriginalName="x.jpg")
    db.add(f)
    db.flush()
    db.add(VisitPhotoModel(VisitId=v1.VisitId, FileId=f.FileId, PhotoType="pop_x"))
    # Acción ad-hoc del vendedor: cuenta como ejecutada aunque quede en PENDING.
    db.add(VisitActionModel(VisitId=v2.VisitId, ActionType="promo", Status="PENDING"))
    db.flush()

    t = _row_for(build_team(db, [u.UserId], YEAR, MONTH), u)
    assert t["gps"] == 50
    assert t["foto"] == 50
    assert t["accion_pct"] == 50


def test_team_entregas_cuenta_pdvs_no_visitas(db):
    """`ent` cuenta PDVs distintos con cada tipo de entrega, no acciones."""
    u = _user(db)
    r = _route(db, u.UserId)
    p1, p2 = _pdv(db), _pdv(db)
    _link(db, r, p1)
    _link(db, r, p2)
    v1, v2, v3 = _visit(db, p1, u), _visit(db, p1, u), _visit(db, p2, u)
    for v in (v1, v2):  # dos canjes en el MISMO PDV -> cuenta 1
        db.add(VisitActionModel(VisitId=v.VisitId, ActionType="canje_sueltos", Status="DONE"))
    db.add(VisitActionModel(VisitId=v3.VisitId, ActionType="promo", Status="DONE"))
    db.flush()

    t = _row_for(build_team(db, [u.UserId], YEAR, MONTH), u)
    assert t["ent"]["canje_sueltos"] == 1
    assert t["ent"]["promo"] == 1
    assert t["ent"]["juego"] == 0
    assert t["tot_ent"] == 2


def test_team_sin_usuarios_devuelve_payload_vacio(db):
    payload = build_team(db, [], YEAR, MONTH)
    assert payload["trades"] == []
    assert payload["res"]["vis"] == 0
    assert payload["periodo_label"]


def test_team_visita_fuera_del_mes_no_cuenta(db):
    u = _user(db)
    p = _pdv(db)
    _visit(db, p, u, opened=DAY)
    _visit(db, p, u, opened=datetime(YEAR, MONTH + 1, 2, 12, 0, 0))

    t = _row_for(build_team(db, [u.UserId], YEAR, MONTH), u)
    assert t["tot"] == 1


def test_team_efectividad_no_pasa_de_100(db):
    """Visitar PDVs de la ruta que no estaban agendados ese mes no puede empujar
    la efectividad arriba de 100%.

    Caso real de producción (Sebastian Morales, agosto 2026): visitó los 167
    PDVs planificados —plan cumplido al 100%— y ademas 25 PDVs de su ruta sin
    agendar. Con el numerador viejo (PDVs del universo visitados) daba 115%."""
    u = _user(db)
    r = _route(db, u.UserId)
    plan1, plan2, extra_pdv = _pdv(db), _pdv(db), _pdv(db)
    for p in (plan1, plan2, extra_pdv):
        _link(db, r, p)
    _plan(db, r, plan1, u.UserId)
    _plan(db, r, plan2, u.UserId)
    for p in (plan1, plan2, extra_pdv):
        _visit(db, p, u)

    t = _row_for(build_team(db, [u.UserId], YEAR, MONTH), u)
    assert t["plan"] == 2
    assert t["vis"] == 3        # los 3 del universo se visitaron
    assert t["vis_plan"] == 2   # pero solo 2 estaban planificados
    assert t["ef_pct"] == 100


def test_team_efectividad_parcial(db):
    """Mitad del plan visitado -> 50%, y el PDV no planificado no suma."""
    u = _user(db)
    r = _route(db, u.UserId)
    visitado, sin_visitar = _pdv(db), _pdv(db)
    _link(db, r, visitado)
    _link(db, r, sin_visitar)
    _plan(db, r, visitado, u.UserId)
    _plan(db, r, sin_visitar, u.UserId)
    _visit(db, visitado, u)

    t = _row_for(build_team(db, [u.UserId], YEAR, MONTH), u)
    assert t["plan"] == 2
    assert t["vis_plan"] == 1
    assert t["ef_pct"] == 50


# ---------------------------------------------------------------------------
# Filtro de período (date_from/date_to) — resolve_periodo y su efecto en team
# ---------------------------------------------------------------------------

def test_periodo_default_es_el_mes(db):
    from datetime import date
    from app.services.tmr_dashboard import resolve_periodo

    p = resolve_periodo(YEAR, MONTH)
    assert p.d_start == date(YEAR, MONTH, 1)
    assert p.d_end == date(YEAR, MONTH + 1, 1)
    assert "Abril" in p.label


def test_periodo_rango_incluye_hasta_inclusive(db):
    from datetime import date
    from app.services.tmr_dashboard import resolve_periodo

    p = resolve_periodo(YEAR, MONTH, date(2026, 3, 10), date(2026, 4, 20))
    assert p.d_start == date(2026, 3, 10)
    assert p.d_end == date(2026, 4, 21)  # exclusivo: el 20 entra completo
    assert p.label == "10/03/2026 – 20/04/2026"


def test_periodo_todo_sin_date_from(db):
    from datetime import date
    from app.services.tmr_dashboard import RANGE_START_MIN, resolve_periodo

    p = resolve_periodo(YEAR, MONTH, None, date(2026, 4, 30))
    assert p.d_start == RANGE_START_MIN
    assert p.label.startswith("Histórico completo")


def test_team_con_rango_suma_meses_anteriores(db):
    """Una visita en marzo no cuenta en el mes de abril, pero sí en el rango
    marzo-abril y en el histórico completo."""
    from datetime import date

    u = _user(db)
    r = _route(db, u.UserId)
    p = _pdv(db)
    _link(db, r, p)
    _visit(db, p, u)                                      # abril (DAY)
    _visit(db, p, u, opened=DAY - timedelta(days=40))     # marzo

    solo_mes = _row_for(build_team(db, [u.UserId], YEAR, MONTH), u)
    assert solo_mes["tot"] == 1

    rango = _row_for(
        build_team(db, [u.UserId], YEAR, MONTH, date(2026, 3, 1), date(2026, 4, 30)), u
    )
    assert rango["tot"] == 2

    todo = _row_for(
        build_team(db, [u.UserId], YEAR, MONTH, None, date(2026, 4, 30)), u
    )
    assert todo["tot"] == 2
