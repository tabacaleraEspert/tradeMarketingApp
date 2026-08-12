"""Tests de performance/equivalencia para la optimización de los 6 endpoints
admin más lentos de reports.py (smart-alerts, perfect-store, channel-coverage,
pdv-map, trending, gps-alerts).

- Query-count: prueba que el número de queries NO escale con un parámetro que
  antes generaba 1-2 queries POR ITERACIÓN (ej. `months` en /trending).
- Equivalencia: siembra un escenario controlado por sesión directa de DB y
  verifica los valores exactos que antes se calculaban recorriendo tablas
  enteras en Python (channel-coverage, perfect-store).

(La rutina de pdv-map ya tiene su test de equivalencia en
test_reports_nplus1.py — acá no se duplica.)
"""
from datetime import datetime, timezone, timedelta, date

import pytest
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import User as UserModel, PDV as PDVModel
from app.models.channel import Channel as ChannelModel
from app.models.route import Route as RouteModel, RoutePdv as RoutePdvModel, RouteDay as RouteDayModel, RouteDayPdv as RouteDayPdvModel
from app.models.visit import Visit as VisitModel, VisitCheck as VisitCheckModel


@pytest.fixture()
def db():
    SessionLocal = sessionmaker(bind=engine)
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def _user(db, name):
    u = UserModel(Email=f"{name}_{datetime.now(timezone.utc).timestamp()}@repperf.test",
                  DisplayName=name, PasswordHash="x", IsActive=True)
    db.add(u); db.flush()
    return u


def _count_queries(client_call):
    """Ejecuta `client_call()` contando los statements SQL emitidos (event
    listener sobre el mismo `engine` que usa la app, patrón de run_perf.py)."""
    holder = {"n": 0}

    def _listener(conn, cursor, statement, parameters, context, executemany):
        holder["n"] += 1

    event.listen(engine, "before_cursor_execute", _listener)
    try:
        resp = client_call()
    finally:
        event.remove(engine, "before_cursor_execute", _listener)
    return resp, holder["n"]


# ---------------------------------------------------------------------------
# Trending: antes hacía hasta 2 queries POR MES dentro de un for (O(months));
# con months=12 (el máximo permitido) eran ~24 queries de más.
# ---------------------------------------------------------------------------
class TestTrendingQueryCount:
    def test_query_count_does_not_scale_with_months(self, client):
        _, q_small = _count_queries(lambda: client.get("/reports/trending", params={"months": 2}))
        resp_large, q_large = _count_queries(lambda: client.get("/reports/trending", params={"months": 12}))

        assert resp_large.status_code == 200
        assert q_large == q_small, (
            f"trending no debe escalar con `months` (patrón N+1 por mes): "
            f"{q_small} queries con months=2 vs {q_large} con months=12"
        )
        assert q_large < 10  # antes de la optimización rondaba ~24-28


# ---------------------------------------------------------------------------
# Channel coverage: antes cargaba TODOS los PDVs y TODAS las visitas del mes
# como objetos completos y cruzaba listas enteras en Python por cada canal.
# ---------------------------------------------------------------------------
class TestChannelCoverageEquivalence:
    def test_totals_visited_gps_match_seeded_scenario(self, client, db):
        rep = _user(db, "cc_rep")
        ch = ChannelModel(Name=f"Canal_cc_{datetime.now(timezone.utc).timestamp()}", IsActive=True)
        db.add(ch); db.flush()
        p1 = PDVModel(Name="PDV_cc_1", IsActive=True, ChannelId=ch.ChannelId)
        p2 = PDVModel(Name="PDV_cc_2", IsActive=True, ChannelId=ch.ChannelId)
        db.add_all([p1, p2]); db.flush()

        now = datetime.now(timezone.utc)
        v1 = VisitModel(PdvId=p1.PdvId, UserId=rep.UserId, Status="CLOSED", OpenedAt=now)
        v2 = VisitModel(PdvId=p2.PdvId, UserId=rep.UserId, Status="CLOSED", OpenedAt=now)
        db.add_all([v1, v2]); db.flush()
        db.add(VisitCheckModel(VisitId=v1.VisitId, CheckType="IN", Ts=now, Lat=0, Lon=0, DistanceToPdvM=10))
        db.commit()

        resp = client.get("/reports/channel-coverage")
        assert resp.status_code == 200
        row = next((r for r in resp.json() if r["channelId"] == ch.ChannelId), None)
        assert row is not None, "el canal sembrado debe aparecer en channel-coverage"
        assert row["total"] == 2
        assert row["visited"] == 2
        assert row["coverage"] == 100
        assert row["gps"] == 1       # solo v1 tiene VisitCheck
        assert row["photo"] == 0


# ---------------------------------------------------------------------------
# Perfect store: `planned30d`/`frequency` ahora salen de un JOIN
# RouteDayPdv-RouteDay acotado al universo de PDVs (antes: cargaba TODOS los
# RouteDay de 30d como objetos completos solo para sacarles el Id).
# ---------------------------------------------------------------------------
class TestPerfectStorePlannedFrequency:
    def test_planned30d_and_frequency_from_routedaypdv_join(self, client, db):
        rep = _user(db, "ps_rep")
        route = RouteModel(Name="R_ps", IsActive=True, AssignedUserId=rep.UserId)
        db.add(route); db.flush()
        pdv = PDVModel(Name="PDV_ps_1", IsActive=True)
        db.add(pdv); db.flush()
        db.add(RoutePdvModel(RouteId=route.RouteId, PdvId=pdv.PdvId, SortOrder=1))

        today = date.today()
        now = datetime.now(timezone.utc)
        rd1 = RouteDayModel(RouteId=route.RouteId, WorkDate=today, AssignedUserId=rep.UserId, Status="DONE")
        rd2 = RouteDayModel(RouteId=route.RouteId, WorkDate=today - timedelta(days=5), AssignedUserId=rep.UserId, Status="DONE")
        db.add_all([rd1, rd2]); db.flush()
        db.add(RouteDayPdvModel(RouteDayId=rd1.RouteDayId, PdvId=pdv.PdvId, PlannedOrder=1))
        db.add(RouteDayPdvModel(RouteDayId=rd2.RouteDayId, PdvId=pdv.PdvId, PlannedOrder=1))
        # 1 sola visita CLOSED en la ventana de 30d -> planned=2, closed=1
        db.add(VisitModel(PdvId=pdv.PdvId, UserId=rep.UserId, Status="CLOSED", OpenedAt=now, ClosedAt=now))
        db.commit()

        resp = client.get("/reports/perfect-store")
        assert resp.status_code == 200
        row = next((r for r in resp.json()["pdvs"] if r["pdvId"] == pdv.PdvId), None)
        assert row is not None, "el PDV sembrado debe aparecer en perfect-store"
        assert row["planned30d"] == 2
        assert row["visits30d"] == 1
        assert row["components"]["frequency"] == round(25 * min(1 / 2, 1.0))
