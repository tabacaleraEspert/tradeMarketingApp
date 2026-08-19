"""Tests del cache TTL corto de `GET /kpi/variable` (mes en curso, o mes pasado
que todavía no tiene `KpiMonthlySnapshot`): `compute_kpis` recalcula contra
Azure SQL en cada request y en producción la primera carga del admin (todos
los vendedores del mes en curso) tarda ~10s. Ver la sección "Cache TTL corto"
en `app/routers/kpi.py` para el diseño completo.

Patrón de fixtures compartido con test_kpi_auto_close.py / test_kpi_snapshot.py:
sesión directa de DB para seedear datos sintéticos + `client` (admin, de
conftest.py) para pegarle a los endpoints. Además de `KpiConfig`/
`KpiMonthlySnapshot`, este archivo también vacía `_KPI_VARIABLE_CACHE` (dict
módulo-level de app/routers/kpi.py) antes de cada test, y deja la marca de
auto-cierre (`kpi_last_auto_close`) ya al día para el mes anterior real: así
`ensure_previous_month_closed` corta temprano en cada `GET /kpi/variable` de
este archivo y no dispara de fondo un `_close_month_core` ajeno que sumaría
llamadas inesperadas a `compute_kpis` en los contadores de estos tests (ver
test_kpi_auto_close.py sobre el mecanismo)."""
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
from app.routers.kpi import (
    _invalidate_kpi_cache,
    KPI_AUTO_CLOSE_SETTING_KEY,
    _previous_month,
    compute_kpis as _original_compute_kpis,
)

_AUTO_CLOSE_PREV_YEAR, _AUTO_CLOSE_PREV_MONTH = _previous_month(date.today())
_AUTO_CLOSE_TARGET_KEY = f"{_AUTO_CLOSE_PREV_YEAR:04d}-{_AUTO_CLOSE_PREV_MONTH:02d}"


def _clean_kpi_tables(s):
    """Vacía `KpiConfig`/`KpiMonthlySnapshot`, el cache in-process de
    `/kpi/variable` y neutraliza el auto-cierre lazy de
    `ensure_previous_month_closed` (dejando la marca ya al día) antes de cada
    test — este archivo no lo ejercita, y sin esto un `GET /kpi/variable`
    podría disparar de fondo un `_close_month_core` del mes anterior real que
    sumaría llamadas a `compute_kpis` no relacionadas con lo que cada test
    mide (ver test_kpi_engine.py::_clean_kpi_tables sobre por qué se comparte
    la DB de sesión entre archivos de test de KPI)."""
    s.query(KpiMonthlySnapshotModel).delete()
    s.query(KpiConfigModel).delete()
    mark = s.query(AppSettingModel).filter(AppSettingModel.Key == KPI_AUTO_CLOSE_SETTING_KEY).first()
    if mark:
        mark.Value = _AUTO_CLOSE_TARGET_KEY
    else:
        s.add(AppSettingModel(Key=KPI_AUTO_CLOSE_SETTING_KEY, Value=_AUTO_CLOSE_TARGET_KEY))
    s.commit()
    _invalidate_kpi_cache()


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
        Email=f"{role_name}_{_uid()}@kpicache.test",
        DisplayName=f"KpiCache {role_name}",
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
    50%, y una visita con cobertura que da actual=100% (mismo patrón que
    test_kpi_snapshot.py::_cobertura_setup)."""
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


def _spy_compute_kpis(monkeypatch, calls):
    """Reemplaza `app.routers.kpi.compute_kpis` por un wrapper que cuenta llamadas
    y delega en la implementación real, capturada en el import de este módulo
    (antes de cualquier monkeypatch) — así el response sigue teniendo la forma
    correcta."""
    def _wrapped(*args, **kwargs):
        calls.append(1)
        return _original_compute_kpis(*args, **kwargs)

    monkeypatch.setattr("app.routers.kpi.compute_kpis", _wrapped)


TODAY = date.today()  # mes en curso real (mismo criterio que test_kpi_snapshot.py::test_mes_en_curso_422)
PAST_YEAR, PAST_MONTH = 2020, 6  # mes ya cerrado, no usado por otros archivos de test de KPI


def test_segunda_llamada_dentro_del_ttl_no_recomputa(client, db, monkeypatch):
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, TODAY.year, TODAY.month)

    calls = []
    _spy_compute_kpis(monkeypatch, calls)

    first = client.get("/kpi/variable", params={"year": TODAY.year, "month": TODAY.month, "user_id": user.UserId})
    assert first.status_code == 200, first.text
    assert len(calls) == 1

    second = client.get("/kpi/variable", params={"year": TODAY.year, "month": TODAY.month, "user_id": user.UserId})
    assert second.status_code == 200, second.text
    assert len(calls) == 1  # dentro del TTL: no volvió a llamar a compute_kpis
    assert second.json() == first.json()


def test_ttl_vencido_recomputa(client, db, monkeypatch):
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, TODAY.year, TODAY.month)

    calls = []
    _spy_compute_kpis(monkeypatch, calls)

    first = client.get("/kpi/variable", params={"year": TODAY.year, "month": TODAY.month, "user_id": user.UserId})
    assert first.status_code == 200, first.text
    assert len(calls) == 1

    # TTL inyectable/parcheable (constante módulo-level): forzamos su vencimiento
    # sin sleep real.
    monkeypatch.setattr("app.routers.kpi._KPI_CACHE_TTL_SECONDS", -1.0)

    second = client.get("/kpi/variable", params={"year": TODAY.year, "month": TODAY.month, "user_id": user.UserId})
    assert second.status_code == 200, second.text
    assert len(calls) == 2  # venció el TTL: recomputó


def test_post_config_invalida_cache(client, db, monkeypatch):
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, TODAY.year, TODAY.month)

    calls = []
    _spy_compute_kpis(monkeypatch, calls)

    first = client.get("/kpi/variable", params={"year": TODAY.year, "month": TODAY.month, "user_id": user.UserId})
    assert first.status_code == 200, first.text
    assert len(calls) == 1

    defs = _kpi_definitions(db)
    kpi_id = defs["cobertura_skus"].KpiDefinitionId
    posted = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_id, "Weight": 100, "Target": 60, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert posted.status_code == 201, posted.text

    second = client.get("/kpi/variable", params={"year": TODAY.year, "month": TODAY.month, "user_id": user.UserId})
    assert second.status_code == 200, second.text
    assert len(calls) == 2  # el POST /kpi/config invalidó el cache: recomputó


def test_close_month_invalida_cache(client, db, monkeypatch):
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, PAST_YEAR, PAST_MONTH)

    calls = []
    _spy_compute_kpis(monkeypatch, calls)

    first = client.get("/kpi/variable", params={"year": PAST_YEAR, "month": PAST_MONTH, "user_id": user.UserId})
    assert first.status_code == 200, first.text
    assert len(calls) == 1  # sin snapshot todavía -> se calculó en vivo (y se cacheó)

    closed = client.post("/kpi/close-month", params={"year": PAST_YEAR, "month": PAST_MONTH})
    assert closed.status_code == 200, closed.text

    calls.clear()  # aísla la llamada a compute_kpis del propio close-month (crea el snapshot)
    second = client.get("/kpi/variable", params={"year": PAST_YEAR, "month": PAST_MONTH, "user_id": user.UserId})
    assert second.status_code == 200, second.text
    assert len(calls) == 1  # el close-month invalidó el cache: recomputó (ahora lee el snapshot)


def test_mes_cerrado_con_snapshot_no_pasa_por_cache(client, db, monkeypatch):
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, PAST_YEAR, PAST_MONTH)

    closed = client.post("/kpi/close-month", params={"year": PAST_YEAR, "month": PAST_MONTH})
    assert closed.status_code == 200, closed.text

    calls = []
    _spy_compute_kpis(monkeypatch, calls)

    first = client.get("/kpi/variable", params={"year": PAST_YEAR, "month": PAST_MONTH, "user_id": user.UserId})
    assert first.status_code == 200, first.text
    assert len(calls) == 1

    second = client.get("/kpi/variable", params={"year": PAST_YEAR, "month": PAST_MONTH, "user_id": user.UserId})
    assert second.status_code == 200, second.text
    assert len(calls) == 2  # mes con snapshot: nunca se cachea, compute_kpis se llama siempre


# ---------------------------------------------------------------------------
# Cache del Tablero TMR (`/kpi/tmr/*`) — mismo esquema in-process, TTL 10 min,
# response completo cacheado por (endpoint, solicitante, periodo).
# ---------------------------------------------------------------------------

def _spy_build_team(monkeypatch, calls):
    from app.services import tmr_dashboard
    original = tmr_dashboard.build_team

    def _wrapped(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr("app.routers.kpi.tmr.build_team", _wrapped)


def test_tmr_team_segunda_llamada_no_recomputa(client, db, monkeypatch):
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, TODAY.year, TODAY.month)

    calls = []
    _spy_build_team(monkeypatch, calls)

    first = client.get("/kpi/tmr/team", params={"year": TODAY.year, "month": TODAY.month})
    assert first.status_code == 200, first.text
    assert len(calls) == 1

    second = client.get("/kpi/tmr/team", params={"year": TODAY.year, "month": TODAY.month})
    assert second.status_code == 200, second.text
    assert len(calls) == 1  # servido del cache
    assert second.json() == first.json()


def test_tmr_team_ttl_vencido_recomputa(client, db, monkeypatch):
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, TODAY.year, TODAY.month)

    calls = []
    _spy_build_team(monkeypatch, calls)

    assert client.get("/kpi/tmr/team", params={"year": TODAY.year, "month": TODAY.month}).status_code == 200
    monkeypatch.setattr("app.routers.kpi._TMR_CACHE_TTL_SECONDS", -1.0)
    assert client.get("/kpi/tmr/team", params={"year": TODAY.year, "month": TODAY.month}).status_code == 200
    assert len(calls) == 2


def test_tmr_cache_invalidado_por_invalidate(client, db, monkeypatch):
    """_invalidate_kpi_cache (config/scoring-rules/close-month) vacía también el
    cache TMR."""
    user, _ = _user_with_role(db, "vendedor")
    _cobertura_setup(db, user, TODAY.year, TODAY.month)

    calls = []
    _spy_build_team(monkeypatch, calls)

    assert client.get("/kpi/tmr/team", params={"year": TODAY.year, "month": TODAY.month}).status_code == 200
    _invalidate_kpi_cache()
    assert client.get("/kpi/tmr/team", params={"year": TODAY.year, "month": TODAY.month}).status_code == 200
    assert len(calls) == 2
