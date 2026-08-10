"""Tests de `GET /kpi/weekly-activity` (docs/tablero-tmr-diseno.md, DD.visits_semanal).

Patrón de fixtures: sesión directa de DB para sembrar PDV/Visit/VisitAction/
VisitCoverage/VisitPOPItem (igual que test_kpi_engine.py) + `client` (admin, de
conftest.py) y tokens ad-hoc para otros roles (igual que test_kpi_router.py).
"""
import uuid
from datetime import date, datetime, timezone

import bcrypt
import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import (
    User as UserModel,
    Role as RoleModel,
    UserRole as UserRoleModel,
    PDV as PDVModel,
    Product as ProductModel,
    Visit as VisitModel,
    VisitAction as VisitActionModel,
    VisitCoverage as VisitCoverageModel,
    VisitPOPItem as VisitPOPItemModel,
)
from app.auth import create_access_token


@pytest.fixture()
def db():
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.close()


def _uid():
    return uuid.uuid4().hex[:8]


def _user_with_role(db, role_name, manager_id=None):
    role = db.query(RoleModel).filter(RoleModel.Name == role_name).first()
    if not role:
        role = RoleModel(Name=role_name)
        db.add(role)
        db.flush()
    u = UserModel(
        Email=f"{role_name}_{_uid()}@kpiactivity.test",
        DisplayName=f"Activity {role_name}",
        PasswordHash=bcrypt.hashpw(b"x", bcrypt.gensalt()).decode(),
        IsActive=True,
        ManagerUserId=manager_id,
    )
    db.add(u)
    db.flush()
    db.add(UserRoleModel(UserId=u.UserId, RoleId=role.RoleId))
    db.commit()
    db.refresh(u)
    return u, create_access_token(subject=u.UserId, role=role_name)


def _pdv(db, **kwargs):
    kwargs.setdefault("IsActive", True)
    p = PDVModel(Name=f"PDV_{_uid()}", **kwargs)
    db.add(p)
    db.flush()
    return p


def _product(db, name):
    p = ProductModel(Name=name, Category="Cigarrillos", IsOwn=True, IsActive=True)
    db.add(p)
    db.flush()
    return p


def _visit(db, pdv_id, user_id, opened_at, closed_at=None, status="CLOSED"):
    v = VisitModel(PdvId=pdv_id, UserId=user_id, OpenedAt=opened_at, ClosedAt=closed_at, Status=status)
    db.add(v)
    db.flush()
    return v


def _coverage(db, visit_id, product_id, works=True):
    c = VisitCoverageModel(VisitId=visit_id, ProductId=product_id, Works=works)
    db.add(c)
    db.flush()
    return c


def _pop_item(db, visit_id, material_name, material_type="secundario", present=True):
    p = VisitPOPItemModel(VisitId=visit_id, MaterialType=material_type, MaterialName=material_name, Present=present)
    db.add(p)
    db.flush()
    return p


def _action(db, visit_id, action_type, status="DONE", photo_taken=False):
    a = VisitActionModel(VisitId=visit_id, ActionType=action_type, Status=status, PhotoTaken=photo_taken)
    db.add(a)
    db.flush()
    return a


YEAR, MONTH = 2026, 3  # mes cerrado en el pasado respecto de "hoy" (2026-08)


def _dt(day, hour, minute):
    return datetime(YEAR, MONTH, day, hour, minute, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------

def test_weekly_activity_user_id_ajeno_403(client, db):
    _, token = _user_with_role(db, "vendedor")
    other, _ = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/weekly-activity", params={"year": YEAR, "month": MONTH, "user_id": other.UserId}, headers=hdr,
    )
    assert resp.status_code == 403


def test_weekly_activity_user_id_faltante_422(client):
    resp = client.get("/kpi/weekly-activity", params={"year": YEAR, "month": MONTH})
    assert resp.status_code == 422


def test_weekly_activity_mes_vacio_weeks_vacio(client, db):
    user, token = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/weekly-activity", params={"year": YEAR, "month": MONTH, "user_id": user.UserId}, headers=hdr,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["userId"] == user.UserId
    assert body["weeks"] == []


def test_weekly_activity_agrupa_en_dos_semanas(client, db):
    # Marzo 2026: 2 (lun) y 3 (mar) caen en la semana del 2-6; 9 (lun) cae en la
    # semana siguiente (9-13).
    user, token = _user_with_role(db, "vendedor")
    pdv = _pdv(db)
    _visit(db, pdv.PdvId, user.UserId, _dt(2, 9, 0), closed_at=_dt(2, 9, 30))
    _visit(db, pdv.PdvId, user.UserId, _dt(3, 10, 0), closed_at=_dt(3, 10, 20))
    _visit(db, pdv.PdvId, user.UserId, _dt(9, 11, 0), closed_at=_dt(9, 11, 15))
    db.commit()

    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/weekly-activity", params={"year": YEAR, "month": MONTH, "user_id": user.UserId}, headers=hdr,
    )
    assert resp.status_code == 200
    weeks = resp.json()["weeks"]
    assert len(weeks) == 2

    week1, week2 = weeks
    assert week1["weekStart"] == "2026-03-02"
    assert date.fromisoformat(week1["weekStart"]).weekday() == 0  # lunes
    assert week1["totalVisits"] == 2
    assert len(week1["days"]) == 2

    assert week2["weekStart"] == "2026-03-09"
    assert week2["totalVisits"] == 1
    assert len(week2["days"]) == 1
    assert week2["days"][0]["count"] == 1
    assert week2["days"][0]["visits"][0]["pdvId"] == pdv.PdvId


def test_weekly_activity_effective_true_false(client, db):
    user, token = _user_with_role(db, "vendedor")
    pdv = _pdv(db)
    product = _product(db, f"Prod_{_uid()}")

    v_effective = _visit(db, pdv.PdvId, user.UserId, _dt(2, 9, 0), closed_at=_dt(2, 9, 30))
    _coverage(db, v_effective.VisitId, product.ProductId)
    _pop_item(db, v_effective.VisitId, "Cigarrera aérea")
    _action(db, v_effective.VisitId, "pop", status="DONE")

    v_incomplete = _visit(db, pdv.PdvId, user.UserId, _dt(2, 11, 0), closed_at=_dt(2, 11, 10))
    _coverage(db, v_incomplete.VisitId, product.ProductId)
    # sin VisitPOPItem ni VisitAction DONE -> no efectiva
    db.commit()

    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/weekly-activity", params={"year": YEAR, "month": MONTH, "user_id": user.UserId}, headers=hdr,
    )
    assert resp.status_code == 200
    day = resp.json()["weeks"][0]["days"][0]
    # openedAt se muestra en hora de Argentina (UTC-3): 09:00/11:00 UTC -> 06:00/08:00 AR.
    effective_flags = {v["openedAt"]: v["effective"] for v in day["visits"]}
    assert effective_flags["06:00"] is True
    assert effective_flags["08:00"] is False


def test_weekly_activity_effective_false_si_visita_abierta(client, db):
    # A3: antes esta vista no exigía Status='CLOSED' -- una visita todavía abierta
    # con cobertura+POP+acción DONE figuraba efectiva igual.
    user, token = _user_with_role(db, "vendedor")
    pdv = _pdv(db)
    product = _product(db, f"Prod_{_uid()}")

    v_open = _visit(db, pdv.PdvId, user.UserId, _dt(2, 9, 0), closed_at=None, status="OPEN")
    _coverage(db, v_open.VisitId, product.ProductId)
    _pop_item(db, v_open.VisitId, "Cigarrera aérea")
    _action(db, v_open.VisitId, "pop", status="DONE")
    db.commit()

    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/weekly-activity", params={"year": YEAR, "month": MONTH, "user_id": user.UserId}, headers=hdr,
    )
    assert resp.status_code == 200
    day = resp.json()["weeks"][0]["days"][0]
    assert day["visits"][0]["effective"] is False


def test_weekly_activity_visita_23hs_ar_agrupa_en_dia_ar_correcto(client, db):
    """Residuo de la auditoría (B2): el agrupado por día y las horas mostradas usaban
    UTC crudo pese a que la ventana del mes ya se calculaba en hora AR. Una visita
    abierta a las 23:00 hora Argentina cae, en UTC, a las 02:00 del día siguiente:
    debe agruparse en el día AR (16), no en el día UTC (17), y mostrar la hora local
    (23:00), no la UTC cruda (02:00)."""
    user, token = _user_with_role(db, "vendedor")
    pdv = _pdv(db)
    _visit(db, pdv.PdvId, user.UserId, _dt(17, 2, 0), closed_at=_dt(17, 2, 30))
    db.commit()

    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/weekly-activity", params={"year": YEAR, "month": MONTH, "user_id": user.UserId}, headers=hdr,
    )
    assert resp.status_code == 200
    weeks = resp.json()["weeks"]
    assert len(weeks) == 1
    day = weeks[0]["days"][0]
    assert day["date"] == "2026-03-16"
    assert day["firstOpen"] == "23:00"
    assert day["lastClose"] == "23:30"
    assert day["visits"][0]["openedAt"] == "23:00"
    assert day["visits"][0]["closedAt"] == "23:30"
