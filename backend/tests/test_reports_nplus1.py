"""Tests de equivalencia para los endpoints de reports refactorizados (N+1 -> batch).

Siembran un escenario controlado por sesión directa de DB y verifican los valores
exactos calculados, ejercitando los caminos que antes hacían 1 query por iteración:
- /reports/pdv-map      -> assigned user = el RouteDay MÁS RECIENTE por PDV
- /reports/route-analytics -> visit_count = visitas cerradas (30d) de los PDVs de la ruta
"""
from datetime import datetime, timezone, timedelta, date

import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import User as UserModel, PDV as PDVModel
from app.models.route import Route as RouteModel, RoutePdv as RoutePdvModel, RouteDay as RouteDayModel
from app.models.visit import Visit as VisitModel


@pytest.fixture()
def db():
    SessionLocal = sessionmaker(bind=engine)
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def _user(db, name):
    u = UserModel(Email=f"{name}_{datetime.now(timezone.utc).timestamp()}@nplus1.test",
                  DisplayName=name, PasswordHash="x", IsActive=True)
    db.add(u); db.flush()
    return u


def _pdv(db, name):
    p = PDVModel(Name=name, IsActive=True)
    db.add(p); db.flush()
    return p


def _route(db, name, assigned=None):
    r = RouteModel(Name=name, IsActive=True, AssignedUserId=assigned)
    db.add(r); db.flush()
    return r


class TestPdvMapAssignedUser:
    def test_pdv_map_picks_most_recent_routeday_user(self, client, db):
        u_recent = _user(db, "recent")
        u_old = _user(db, "old")
        p = _pdv(db, "PDV_pdvmap")
        r = _route(db, "R_pdvmap")
        db.add(RoutePdvModel(RouteId=r.RouteId, PdvId=p.PdvId, SortOrder=1))
        today = date.today()
        # Día más reciente -> u_recent ; día más viejo -> u_old
        db.add(RouteDayModel(RouteId=r.RouteId, WorkDate=today, AssignedUserId=u_recent.UserId, Status="PLANNED"))
        db.add(RouteDayModel(RouteId=r.RouteId, WorkDate=today - timedelta(days=10), AssignedUserId=u_old.UserId, Status="PLANNED"))
        db.commit()

        resp = client.get("/reports/pdv-map")
        assert resp.status_code == 200
        row = next((x for x in resp.json() if x["pdvId"] == p.PdvId), None)
        assert row is not None, "el PDV sembrado debe aparecer en pdv-map"
        assert row["assignedUserId"] == u_recent.UserId      # el más reciente, no el viejo
        assert row["assignedUserName"] == u_recent.DisplayName
        assert row["hasRoute"] is True


class TestRouteAnalyticsCounts:
    def test_route_analytics_counts_match(self, client, db):
        u = _user(db, "rep_ra")
        p1 = _pdv(db, "PDV_ra_1")
        p2 = _pdv(db, "PDV_ra_2")
        r = _route(db, "R_ra")  # sin asignar -> admin la ve
        db.add(RoutePdvModel(RouteId=r.RouteId, PdvId=p1.PdvId, SortOrder=1))
        db.add(RoutePdvModel(RouteId=r.RouteId, PdvId=p2.PdvId, SortOrder=2))

        today = date.today()
        # 2 días en ventana 30d: 1 COMPLETED + 1 PLANNED -> total=2, completed=1, compliance=50
        db.add(RouteDayModel(RouteId=r.RouteId, WorkDate=today, AssignedUserId=u.UserId, Status="COMPLETED"))
        db.add(RouteDayModel(RouteId=r.RouteId, WorkDate=today - timedelta(days=5), AssignedUserId=u.UserId, Status="PLANNED"))
        # 1 día futuro PLANNED -> futurePlannedDays=1
        db.add(RouteDayModel(RouteId=r.RouteId, WorkDate=today + timedelta(days=3), AssignedUserId=u.UserId, Status="PLANNED"))

        now = datetime.now(timezone.utc)
        # Visitas cerradas dentro de 30d: 2 en p1 + 1 en p2 = 3
        for _ in range(2):
            db.add(VisitModel(PdvId=p1.PdvId, UserId=u.UserId, Status="CLOSED", OpenedAt=now - timedelta(days=2)))
        db.add(VisitModel(PdvId=p2.PdvId, UserId=u.UserId, Status="COMPLETED", OpenedAt=now - timedelta(days=1)))
        # Ruido que NO debe contarse: OPEN (no cerrada) y una cerrada vieja (>30d)
        db.add(VisitModel(PdvId=p1.PdvId, UserId=u.UserId, Status="OPEN", OpenedAt=now))
        db.add(VisitModel(PdvId=p1.PdvId, UserId=u.UserId, Status="CLOSED", OpenedAt=now - timedelta(days=40)))
        db.commit()

        resp = client.get("/reports/route-analytics")
        assert resp.status_code == 200
        row = next((x for x in resp.json()["routes"] if x["RouteId"] == r.RouteId), None)
        assert row is not None, "la ruta sembrada debe aparecer en route-analytics"
        assert row["pdvCount"] == 2
        assert row["totalDays30d"] == 2
        assert row["completedDays30d"] == 1
        assert row["compliance30d"] == 50
        assert row["futurePlannedDays"] == 1
        assert row["visits30d"] == 3      # 2 (p1) + 1 (p2); OPEN y la vieja excluidas
