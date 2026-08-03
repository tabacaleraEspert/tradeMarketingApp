"""Tests de `POST /kpi/close-month` (docs/tablero-tmr-plan-fase1.md T5/T6).

Patrón de fixtures compartido con test_kpi_engine.py / test_kpi_router.py: sesión
directa de DB para seedear datos sintéticos + `client` (admin, de conftest.py) para
pegarle al endpoint. Los KpiConfig de estos tests usan `ScopeType="user"` acotado al
usuario del propio test para no interferir con otros tests que comparten la tabla.
"""
import uuid
from datetime import date, datetime

import bcrypt
import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.kpi_defaults import KPI_DEFINITIONS
from app.models import (
    User as UserModel,
    Role as RoleModel,
    UserRole as UserRoleModel,
    PDV as PDVModel,
    Product as ProductModel,
    Route as RouteModel,
    RoutePdv as RoutePdvModel,
    Visit as VisitModel,
    VisitCoverage as VisitCoverageModel,
    KpiDefinition as KpiDefinitionModel,
    KpiConfig as KpiConfigModel,
    KpiMonthlySnapshot as KpiMonthlySnapshotModel,
)
from app.auth import create_access_token


def _clean_kpi_tables(s):
    """Vacía `KpiConfig`/`KpiMonthlySnapshot` antes de cada test (ver
    test_kpi_engine.py::_clean_kpi_tables — misma DB de sesión de pytest compartida
    entre los 3 archivos de test de KPI)."""
    s.query(KpiMonthlySnapshotModel).delete()
    s.query(KpiConfigModel).delete()
    s.commit()


@pytest.fixture()
def db():
    s = sessionmaker(bind=engine)()
    try:
        _clean_kpi_tables(s)
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
        Email=f"{role_name}_{_uid()}@kpisnapshot.test",
        DisplayName=f"KpiSnapshot {role_name}",
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


def _kpi_definitions(db):
    defs = {}
    for kd in KPI_DEFINITIONS:
        existing = db.query(KpiDefinitionModel).filter(KpiDefinitionModel.KpiKey == kd["key"]).first()
        if not existing:
            existing = KpiDefinitionModel(KpiKey=kd["key"], Name=kd["name"], Description=kd["description"], IsActive=True)
            db.add(existing)
            db.flush()
        defs[kd["key"]] = existing
    db.commit()
    return defs


def _route_with_pdv(db, user_id):
    pdv = PDVModel(Name=f"PDV_{_uid()}", IsActive=True)
    db.add(pdv)
    db.flush()
    route = RouteModel(Name=f"R_{_uid()}", IsActive=True, AssignedUserId=user_id, IsFocus=True)
    db.add(route)
    db.flush()
    db.add(RoutePdvModel(RouteId=route.RouteId, PdvId=pdv.PdvId, SortOrder=1))
    db.commit()
    return route, pdv


def _cobertura_setup(db, user, year, month):
    """Un usuario con ruta foco + 1 PDV, config de `cobertura_skus` peso 100/target
    50%, y una visita con cobertura que da actual=100% (1/1 SKU trabaja)."""
    defs = _kpi_definitions(db)
    kpi_id = defs["cobertura_skus"].KpiDefinitionId
    db.add(KpiConfigModel(
        KpiDefinitionId=kpi_id, Weight=100, Target=50, ScopeType="user", ScopeId=user.UserId,
        ValidFrom=date(year, 1, 1), ValidTo=None,
    ))
    db.commit()

    route, pdv = _route_with_pdv(db, user.UserId)
    product = ProductModel(Name=f"Milenio_{_uid()}", Category="Cigarrillos", IsOwn=True, IsActive=True)
    db.add(product)
    db.flush()
    visit = VisitModel(PdvId=pdv.PdvId, UserId=user.UserId, OpenedAt=datetime(year, month, 10), Status="CLOSED")
    db.add(visit)
    db.flush()
    db.add(VisitCoverageModel(VisitId=visit.VisitId, ProductId=product.ProductId, Works=True))
    db.commit()
    return route, pdv


# La fixture `db` vacía `KpiMonthlySnapshot`/`KpiConfig` antes de cada test, así que
# los distintos tests de "primer cierre" ya no necesitan (year, month) exclusivos entre
# sí para no chocar; se mantienen igual solo por prolijidad de lectura.
YEAR, MONTH = 2026, 3  # mes cerrado en el pasado respecto de "hoy" (2026-08) -- solo para el 422


def test_mes_en_curso_422(client):
    today = date.today()
    resp = client.post("/kpi/close-month", params={"year": today.year, "month": today.month})
    assert resp.status_code == 422


def test_no_admin_403(db):
    _, token = _user_with_role(db, "vendedor")
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app, headers={"Authorization": f"Bearer {token}"}) as c:
        resp = c.post("/kpi/close-month", params={"year": YEAR, "month": MONTH})
    assert resp.status_code == 403


def test_cierre_feliz_crea_filas_correctas(client, db):
    year, month = 2019, 1
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, year, month)

    live = client.get("/kpi/variable", params={"year": year, "month": month, "user_id": user.UserId}).json()[0]
    live_kpi = next(k for k in live["kpis"] if k["key"] == "cobertura_skus")

    resp = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == year
    assert body["month"] == month
    assert body["forced"] is False
    assert body["usersClosed"] >= 1
    assert body["snapshotsCreated"] >= 1

    row = (
        db.query(KpiMonthlySnapshotModel)
        .join(KpiDefinitionModel, KpiDefinitionModel.KpiDefinitionId == KpiMonthlySnapshotModel.KpiDefinitionId)
        .filter(
            KpiMonthlySnapshotModel.UserId == user.UserId,
            KpiMonthlySnapshotModel.Year == year,
            KpiMonthlySnapshotModel.Month == month,
            KpiDefinitionModel.KpiKey == "cobertura_skus",
        )
        .first()
    )
    assert row is not None
    assert row.Numerator == live_kpi["numerator"]
    assert row.Denominator == live_kpi["denominator"]
    assert row.Weight == live_kpi["weight"]
    assert float(row.Target) == live_kpi["target"]
    assert row.Achieved == live_kpi["achieved"]
    assert row.ScopeApplied == live_kpi["scopeApplied"]
    assert row.FrozenAt is not None


def test_segundo_cierre_409(client, db):
    year, month = 2019, 2
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, year, month)

    first = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert first.status_code == 200, first.text

    second = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert second.status_code == 409


def test_force_true_regenera(client, db):
    year, month = 2019, 3
    user, _ = _user_with_role(db, "vendedor")
    route, pdv = _cobertura_setup(db, user, year, month)

    first = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert first.status_code == 200, first.text

    # Cambia los datos crudos: agrega otro PDV a la ruta foco -> denominador sube.
    pdv2 = PDVModel(Name=f"PDV_{_uid()}", IsActive=True)
    db.add(pdv2)
    db.flush()
    db.add(RoutePdvModel(RouteId=route.RouteId, PdvId=pdv2.PdvId, SortOrder=2))
    db.commit()

    forced = client.post("/kpi/close-month", params={"year": year, "month": month, "force": True})
    assert forced.status_code == 200, forced.text
    assert forced.json()["forced"] is True

    row = (
        db.query(KpiMonthlySnapshotModel)
        .join(KpiDefinitionModel, KpiDefinitionModel.KpiDefinitionId == KpiMonthlySnapshotModel.KpiDefinitionId)
        .filter(
            KpiMonthlySnapshotModel.UserId == user.UserId,
            KpiMonthlySnapshotModel.Year == year,
            KpiMonthlySnapshotModel.Month == month,
            KpiDefinitionModel.KpiKey == "cobertura_skus",
        )
        .first()
    )
    assert row.Denominator == 2  # el snapshot regenerado refleja el universo nuevo


def test_get_variable_mes_cerrado_devuelve_snapshot_congelado(client, db):
    year, month = 2019, 4
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, year, month)

    closed = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert closed.status_code == 200, closed.text

    before = client.get("/kpi/variable", params={"year": year, "month": month, "user_id": user.UserId}).json()[0]
    before_kpi = next(k for k in before["kpis"] if k["key"] == "cobertura_skus")

    # Cambia los datos crudos post-cierre.
    pdv_extra = PDVModel(Name=f"PDV_{_uid()}", IsActive=True)
    db.add(pdv_extra)
    db.flush()
    route = db.query(RouteModel).filter(RouteModel.AssignedUserId == user.UserId).first()
    db.add(RoutePdvModel(RouteId=route.RouteId, PdvId=pdv_extra.PdvId, SortOrder=99))
    db.commit()

    after = client.get("/kpi/variable", params={"year": year, "month": month, "user_id": user.UserId}).json()[0]
    after_kpi = next(k for k in after["kpis"] if k["key"] == "cobertura_skus")

    assert after_kpi["numerator"] == before_kpi["numerator"]
    assert after_kpi["denominator"] == before_kpi["denominator"]


# ---------------------------------------------------------------------------
# B3 — close-month con config vacía (sin `resolve_config` vigente para el mes)
# ---------------------------------------------------------------------------

def test_close_month_sin_config_para_ningun_usuario_422(client, db):
    year, month = 2024, 6
    user, _ = _user_with_role(db, "vendedor")
    _route_with_pdv(db, user.UserId)  # ruta foco, pero SIN KpiConfig -> resolve_config vacío

    resp = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert resp.status_code == 422, resp.text

    rows = db.query(KpiMonthlySnapshotModel).filter(
        KpiMonthlySnapshotModel.Year == year, KpiMonthlySnapshotModel.Month == month,
    ).all()
    assert rows == []


def test_close_month_force_con_config_vacia_no_borra_snapshot_previo(client, db):
    # Cierre previo válido y luego la config deja de cubrir ese mes (ValidFrom se
    # corre a después del cierre) -> un force=true posterior debe rechazarse con 422
    # SIN borrar el snapshot ya persistido.
    year, month = 2025, 1
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, year, month)

    first = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert first.status_code == 200, first.text

    config = db.query(KpiConfigModel).filter(KpiConfigModel.ScopeId == user.UserId).first()
    config.ValidFrom = date(year, month + 1, 1)
    db.commit()

    forced = client.post("/kpi/close-month", params={"year": year, "month": month, "force": True})
    assert forced.status_code == 422, forced.text

    rows = db.query(KpiMonthlySnapshotModel).filter(
        KpiMonthlySnapshotModel.UserId == user.UserId,
        KpiMonthlySnapshotModel.Year == year,
        KpiMonthlySnapshotModel.Month == month,
    ).all()
    assert len(rows) >= 1  # el snapshot preexistente sigue intacto, no se borró


def test_close_month_reporta_users_skipped_para_usuario_sin_config(client, db):
    year, month = 2024, 7
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, year, month)

    skipped_user, _ = _user_with_role(db, "vendedor")
    _route_with_pdv(db, skipped_user.UserId)  # ruta foco pero sin KpiConfig

    resp = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert skipped_user.UserId in body["usersSkipped"]
    assert user.UserId not in body["usersSkipped"]
