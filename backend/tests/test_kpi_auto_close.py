"""Tests del cierre automático de KPIs (docs/tablero-tmr-plan-fase1.md, fase 4):
`ensure_previous_month_closed` — disparado desde `GET /kpi/variable` — y
`GET /kpi/closed-months`.

Patrón de fixtures compartido con test_kpi_snapshot.py: sesión directa de DB para
seedear datos sintéticos + `client` (admin, de conftest.py) para pegarle a los
endpoints. Además de `KpiConfig`/`KpiMonthlySnapshot`, este archivo también resetea
la marca de control `AppSetting(Key='kpi_last_auto_close')` antes de cada test, para
no depender de qué otro test de este u otro archivo haya corrido antes en la misma
sesión de DB (ver test_kpi_engine.py::_clean_kpi_tables sobre por qué se comparte).

Como no hay forma de inyectar year/month en `ensure_previous_month_closed` (toma
`date.today()`), los tests usan el mes calendario anterior REAL (`PREV_YEAR`,
`PREV_MONTH`, calculado con el mismo helper `_previous_month` del router) en vez de
mockear la fecha.

El cierre real corre en `BackgroundTasks` (`_run_auto_close`), no inline: con
`TestClient`, Starlette ejecuta las tareas de background antes de que
`client.get(...)` devuelva el control al test (van dentro del mismo ciclo ASGI
que envía la respuesta), así que los asserts sobre `AppSetting`/
`KpiMonthlySnapshot` inmediatamente después del `client.get(...)` siguen viendo
el resultado del cierre sin necesidad de esperar nada extra.
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
    AppSetting as AppSettingModel,
)
from app.auth import create_access_token
from app.routers.kpi import KPI_AUTO_CLOSE_SETTING_KEY, _previous_month, _claim_auto_close


def _clean_kpi_tables(s):
    """Vacía `KpiConfig`/`KpiMonthlySnapshot` y la marca de auto-cierre antes de
    cada test (ver test_kpi_engine.py::_clean_kpi_tables — misma DB de sesión de
    pytest compartida entre los archivos de test de KPI)."""
    s.query(KpiMonthlySnapshotModel).delete()
    s.query(KpiConfigModel).delete()
    s.query(AppSettingModel).filter(AppSettingModel.Key == KPI_AUTO_CLOSE_SETTING_KEY).delete()
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
        Email=f"{role_name}_{_uid()}@kpiautoclose.test",
        DisplayName=f"KpiAutoClose {role_name}",
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
    """Config vigente de `cobertura_skus` (peso 100/target 50%) desde `year-month-01`
    en adelante (`ValidTo=None`), + ruta foco con 1 PDV + una visita que da 100%
    (mismo patrón que test_kpi_snapshot.py::_cobertura_setup)."""
    defs = _kpi_definitions(db)
    kpi_id = defs["cobertura_skus"].KpiDefinitionId
    db.add(KpiConfigModel(
        KpiDefinitionId=kpi_id, Weight=100, Target=50, ScopeType="user", ScopeId=user.UserId,
        ValidFrom=date(year, month, 1), ValidTo=None,
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


def _mark_value(db):
    row = db.query(AppSettingModel).filter(AppSettingModel.Key == KPI_AUTO_CLOSE_SETTING_KEY).first()
    return row.Value if row else None


PREV_YEAR, PREV_MONTH = _previous_month(date.today())
TARGET_KEY = f"{PREV_YEAR:04d}-{PREV_MONTH:02d}"


def test_variable_cierra_mes_anterior_y_escribe_marca(client, db):
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, PREV_YEAR, PREV_MONTH)

    resp = client.get("/kpi/variable", params={"year": PREV_YEAR, "month": PREV_MONTH, "user_id": user.UserId})
    assert resp.status_code == 200, resp.text

    assert _mark_value(db) == TARGET_KEY

    rows = db.query(KpiMonthlySnapshotModel).filter(
        KpiMonthlySnapshotModel.UserId == user.UserId,
        KpiMonthlySnapshotModel.Year == PREV_YEAR,
        KpiMonthlySnapshotModel.Month == PREV_MONTH,
    ).all()
    assert len(rows) >= 1


def test_segunda_llamada_marca_corta_temprano_sin_recalcular(client, db, monkeypatch):
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, PREV_YEAR, PREV_MONTH)

    first = client.get("/kpi/variable", params={"year": PREV_YEAR, "month": PREV_MONTH, "user_id": user.UserId})
    assert first.status_code == 200, first.text
    assert _mark_value(db) == TARGET_KEY

    count_before = db.query(KpiMonthlySnapshotModel).filter(
        KpiMonthlySnapshotModel.Year == PREV_YEAR, KpiMonthlySnapshotModel.Month == PREV_MONTH,
    ).count()

    calls = []

    def _spy(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError("no debería llamarse: la marca ya está al día")

    monkeypatch.setattr("app.routers.kpi._close_month_core", _spy)

    second = client.get("/kpi/variable", params={"year": PREV_YEAR, "month": PREV_MONTH, "user_id": user.UserId})
    assert second.status_code == 200, second.text
    assert calls == []  # _close_month_core no se invocó: la marca cortó temprano

    count_after = db.query(KpiMonthlySnapshotModel).filter(
        KpiMonthlySnapshotModel.Year == PREV_YEAR, KpiMonthlySnapshotModel.Month == PREV_MONTH,
    ).count()
    assert count_after == count_before


def test_sin_config_vigente_no_cierra_pero_marca_y_no_reintenta(client, db, monkeypatch):
    user, _ = _user_with_role(db, "vendedor")
    _route_with_pdv(db, user.UserId)  # ruta foco, pero SIN KpiConfig -> resolve_config vacío

    resp = client.get("/kpi/variable", params={"year": PREV_YEAR, "month": PREV_MONTH, "user_id": user.UserId})
    assert resp.status_code == 200, resp.text

    assert _mark_value(db) == TARGET_KEY  # marca escrita igual, para no reintentar

    rows = db.query(KpiMonthlySnapshotModel).filter(
        KpiMonthlySnapshotModel.Year == PREV_YEAR, KpiMonthlySnapshotModel.Month == PREV_MONTH,
    ).all()
    assert rows == []  # no se cerró nada

    calls = []

    def _spy(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError("no debería reintentar: la marca ya está al día")

    monkeypatch.setattr("app.routers.kpi._close_month_core", _spy)

    resp2 = client.get("/kpi/variable", params={"year": PREV_YEAR, "month": PREV_MONTH, "user_id": user.UserId})
    assert resp2.status_code == 200, resp2.text
    assert calls == []


def test_excepcion_en_cierre_no_rompe_variable(client, db, monkeypatch):
    """El claim (síncrono, dentro del request) escribe la marca ANTES de que el
    cierre real corra en background: si `_close_month_core` explota ahí, la marca
    ya quedó escrita (trade-off aceptado, ver docstring de
    `ensure_previous_month_closed` — se detecta con GET /kpi/closed-months y se
    recupera con POST /kpi/close-month manual) y el request de todos modos
    respondió 200, porque el cierre corre después de responder."""
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, PREV_YEAR, PREV_MONTH)

    def _boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.routers.kpi._close_month_core", _boom)

    resp = client.get("/kpi/variable", params={"year": PREV_YEAR, "month": PREV_MONTH, "user_id": user.UserId})
    assert resp.status_code == 200, resp.text  # el error se loguea y se descarta, no rompe el request

    # El claim ya había escrito la marca antes de que el cierre en background explote.
    assert _mark_value(db) == TARGET_KEY
    rows = db.query(KpiMonthlySnapshotModel).filter(
        KpiMonthlySnapshotModel.Year == PREV_YEAR, KpiMonthlySnapshotModel.Month == PREV_MONTH,
    ).all()
    assert rows == []


def test_claim_atomico_solo_un_worker_gana(db):
    """Simula 2 workers gunicorn compitiendo por el claim del mismo mes (UPDATE
    atómico sobre AppSetting, `_claim_auto_close`): con la marca vieja ya en la
    fila, solo el primer llamado debe reclamar el trabajo (True); el segundo debe
    ceder (False) sin tocar nada — así se evita que varios workers recalculen en
    paralelo el día 1 (B3 de la auditoría)."""
    old_key = "2000-01"
    db.add(AppSettingModel(Key=KPI_AUTO_CLOSE_SETTING_KEY, Value=old_key))
    db.commit()

    other_session = sessionmaker(bind=engine)()
    try:
        first = _claim_auto_close(db, TARGET_KEY)
        second = _claim_auto_close(other_session, TARGET_KEY)
    finally:
        other_session.close()

    assert first is True
    assert second is False
    assert _mark_value(db) == TARGET_KEY


def test_closed_months_devuelve_lo_esperado(client, db):
    year, month = 2019, 5  # mes arbitrario ya cerrado, distinto de otros archivos de test
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, year, month)

    closed = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert closed.status_code == 200, closed.text

    resp = client.get("/kpi/closed-months")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    entry = next((e for e in body if e["year"] == year and e["month"] == month), None)
    assert entry is not None
    assert entry["snapshots"] >= 1
    assert entry["users"] >= 1
    assert entry["frozenAt"] is not None

    for a, b in zip(body, body[1:]):  # orden desc por (year, month)
        assert (a["year"], a["month"]) >= (b["year"], b["month"])


def test_cierre_manual_sigue_funcionando_igual(client, db):
    """El refactor que extrajo `_close_month_core` no cambia el contrato externo de
    `POST /kpi/close-month` (mismo chequeo de contrato que test_kpi_snapshot.py)."""
    year, month = 2019, 6
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, year, month)

    resp = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == year
    assert body["month"] == month
    assert body["forced"] is False
    assert body["usersClosed"] >= 1
    assert body["snapshotsCreated"] >= 1
    assert user.UserId not in body["usersSkipped"]

    second = client.post("/kpi/close-month", params={"year": year, "month": month})
    assert second.status_code == 409  # idempotente, como antes
