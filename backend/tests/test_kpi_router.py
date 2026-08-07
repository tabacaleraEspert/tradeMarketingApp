"""Tests del router `/kpi` (docs/tablero-tmr-plan-fase1.md T3/T6).

Patrón de fixtures: `client` (admin, de conftest.py) + tokens ad-hoc para otros roles
(igual que test_routes_visibility_perms.py). Los KpiConfig de estos tests usan
`ScopeType="user"` acotado al usuario de cada test (convención de test_kpi_engine.py)
para no interferir entre tests que comparten la misma tabla/DB de sesión.
"""
from datetime import date, datetime, timezone

import bcrypt
import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.kpi_defaults import KPI_DEFINITIONS
from app.models import User as UserModel, Role as RoleModel, UserRole as UserRoleModel
from app.models.kpi_definition import KpiDefinition as KpiDefinitionModel
from app.models.kpi_config import KpiConfig as KpiConfigModel
from app.auth import create_access_token


def _clean_kpi_tables(s):
    """Vacía `KpiConfig` antes de cada test (ver test_kpi_engine.py::_clean_kpi_tables
    — misma DB de sesión de pytest compartida entre los 3 archivos de test de KPI;
    este archivo no crea `ScoringCoverageRule`/`ScoringCommunicationRule`/
    `KpiMonthlySnapshot`, así que no hace falta limpiarlas acá)."""
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
    return datetime.now(timezone.utc).timestamp()


def _user_with_role(db, role_name, manager_id=None):
    """Crea un usuario con el rol dado y devuelve (user, token)."""
    role = db.query(RoleModel).filter(RoleModel.Name == role_name).first()
    if not role:
        role = RoleModel(Name=role_name)
        db.add(role)
        db.flush()
    u = UserModel(
        Email=f"{role_name}_{_uid()}@kpirouter.test",
        DisplayName=f"KpiTest {role_name}",
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
    """Los 5 KpiDefinition (idempotente por KpiKey, tabla compartida entre tests)."""
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


YEAR, MONTH = 2026, 3  # mes cerrado en el pasado respecto de "hoy" -> cálculo en vivo


# ---------------------------------------------------------------------------
# Permisos — /kpi/variable, /kpi/pdv-scoring
# ---------------------------------------------------------------------------

def test_vendedor_variable_user_id_ajeno_403(client, db):
    _, token = _user_with_role(db, "vendedor")
    other, _ = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get("/kpi/variable", params={"year": YEAR, "month": MONTH, "user_id": other.UserId}, headers=hdr)
    assert resp.status_code == 403


def test_pdv_scoring_user_id_ajeno_403(client, db):
    _, token = _user_with_role(db, "vendedor")
    other, _ = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get("/kpi/pdv-scoring", params={"year": YEAR, "month": MONTH, "user_id": other.UserId}, headers=hdr)
    assert resp.status_code == 403


def test_tm_variable_ve_subordinados(client, db):
    manager, mgr_token = _user_with_role(db, "territory_manager")
    sub, _ = _user_with_role(db, "vendedor", manager_id=manager.UserId)
    hdr = {"Authorization": f"Bearer {mgr_token}"}
    resp = client.get("/kpi/variable", params={"year": YEAR, "month": MONTH}, headers=hdr)
    assert resp.status_code == 200
    user_ids = {row["userId"] for row in resp.json()}
    assert manager.UserId in user_ids
    assert sub.UserId in user_ids


def test_admin_variable_sin_user_id_200(client):
    resp = client.get("/kpi/variable", params={"year": YEAR, "month": MONTH})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_variable_happy_path_estructura(client, db):
    user, token = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get("/kpi/variable", params={"year": YEAR, "month": MONTH, "user_id": user.UserId}, headers=hdr)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    row = body[0]
    assert row["userId"] == user.UserId
    assert "kpis" in row and isinstance(row["kpis"], list)
    assert "variableTotal" in row
    assert "partial" in row


def test_variable_incluye_manager_por_fila(client, db):
    manager, mgr_token = _user_with_role(db, "territory_manager")
    sub, _ = _user_with_role(db, "vendedor", manager_id=manager.UserId)
    hdr = {"Authorization": f"Bearer {mgr_token}"}
    resp = client.get("/kpi/variable", params={"year": YEAR, "month": MONTH}, headers=hdr)
    assert resp.status_code == 200
    rows = {row["userId"]: row for row in resp.json()}
    assert rows[sub.UserId]["managerUserId"] == manager.UserId
    assert rows[sub.UserId]["managerName"] == manager.DisplayName
    assert rows[manager.UserId]["managerUserId"] is None
    assert rows[manager.UserId]["managerName"] is None


def test_pdv_scoring_happy_path_estructura(client, db):
    user, token = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.get(
        "/kpi/pdv-scoring",
        params={"year": YEAR, "month": MONTH, "user_id": user.UserId, "page": 1, "page_size": 50},
        headers=hdr,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["page"] == 1
    assert body["pageSize"] == 50
    assert "scoreDist" in body and "coverage" in body["scoreDist"] and "communication" in body["scoreDist"]


def test_config_resolved_visibilidad_vendedor(client, db):
    user, token = _user_with_role(db, "vendedor")
    other, _ = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    ok = client.get("/kpi/config/resolved", params={"user_id": user.UserId}, headers=hdr)
    assert ok.status_code == 200
    blocked = client.get("/kpi/config/resolved", params={"user_id": other.UserId}, headers=hdr)
    assert blocked.status_code == 403


# ---------------------------------------------------------------------------
# Permisos — CRUD de configuración (solo admin)
# ---------------------------------------------------------------------------

def test_vendedor_no_puede_crud_config(client, db):
    _, token = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    assert client.get("/kpi/definitions", headers=hdr).status_code == 403


def test_tm_no_puede_crud_config(client, db):
    _, token = _user_with_role(db, "territory_manager")
    hdr = {"Authorization": f"Bearer {token}"}
    defs = _kpi_definitions(db)
    kpi_id = defs["cobertura_skus"].KpiDefinitionId
    resp = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_id, "Weight": 100, "Target": 80, "ScopeType": "global", "ScopeId": None},
        headers=hdr,
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# CRUD de configuración — vigencias y validación de suma=100
# ---------------------------------------------------------------------------

def test_post_config_ok_y_get_lo_lista(client, db):
    user, _ = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_id = defs["cobertura_skus"].KpiDefinitionId

    resp = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_id, "Weight": 100, "Target": 80, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert resp.status_code == 201, resp.text
    config_id = resp.json()["KpiConfigId"]

    listed = client.get("/kpi/config", params={"scope_type": "user", "scope_id": user.UserId}).json()
    assert any(c["KpiConfigId"] == config_id for c in listed)


def test_post_config_rompe_suma_100_422(client, db):
    user, _ = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_a = defs["cobertura_skus"].KpiDefinitionId
    kpi_b = defs["efectividad_visitas"].KpiDefinitionId

    first = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_a, "Weight": 100, "Target": 80, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_b, "Weight": 50, "Target": 50, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert second.status_code == 422, second.text
    assert "100" in str(second.json()["detail"])


def test_post_config_edicion_mismo_dia_usa_la_nueva(client, db):
    # B1: editar (POST) una config el MISMO día cierra la vieja con ValidTo=hoy y crea
    # la nueva con ValidFrom=hoy. La resolución de HOY debe usar la nueva.
    user, _ = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_id = defs["cobertura_skus"].KpiDefinitionId

    first = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_id, "Weight": 100, "Target": 50, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_id, "Weight": 100, "Target": 80, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert second.status_code == 201, second.text

    resolved = client.get("/kpi/config/resolved", params={"user_id": user.UserId}).json()
    cfg = next(c for c in resolved["configs"] if c["kpiKey"] == "cobertura_skus")
    assert cfg["target"] == 80  # usa la nueva, no la vieja


def test_post_config_edicion_mismo_dia_valida_contra_la_nueva(client, db):
    # B1: la validación de suma=100 del propio POST debe evaluar el estado NUEVO, no
    # el viejo (que erróneamente seguiría sumando 100 si la vieja fila todavía se
    # considerara vigente). Baseline A=60+B=40=100 sembrada directo en DB (creada
    # "hoy", como si fuera de más temprano en el día).
    user, _ = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_a = defs["cobertura_skus"].KpiDefinitionId
    kpi_b = defs["efectividad_visitas"].KpiDefinitionId
    today = date.today()

    db.add(KpiConfigModel(
        KpiDefinitionId=kpi_a, Weight=60, Target=50, ScopeType="user", ScopeId=user.UserId,
        ValidFrom=today, ValidTo=None,
    ))
    db.add(KpiConfigModel(
        KpiDefinitionId=kpi_b, Weight=40, Target=50, ScopeType="user", ScopeId=user.UserId,
        ValidFrom=today, ValidTo=None,
    ))
    db.commit()

    # Editar A el MISMO día (vía POST del router) a un peso que rompe la suma
    # (80+40=120): debe rechazarse evaluando el estado nuevo.
    edit_a = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_a, "Weight": 80, "Target": 50, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert edit_a.status_code == 422, edit_a.text


def test_delete_config_rompe_suma_100_422_y_override_sigue_vigente(client, db):
    # B2: si borrar el único override deja la suma resuelta != 100 (sin fallback
    # global que la cubra), el DELETE debe rechazarse y el override debe seguir
    # vigente (no aplicado el cierre).
    user, _ = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_id = defs["pop_colocado"].KpiDefinitionId

    created = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_id, "Weight": 100, "Target": 70, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert created.status_code == 201, created.text
    config_id = created.json()["KpiConfigId"]

    deleted = client.delete(f"/kpi/config/{config_id}")
    assert deleted.status_code == 422, deleted.text

    after = client.get("/kpi/config", params={"scope_type": "user", "scope_id": user.UserId}).json()
    assert any(c["KpiConfigId"] == config_id for c in after)  # sigue vigente


def test_delete_config_valido_vuelve_a_global_el_mismo_dia(client, db):
    # B2 (caso válido): con un fallback global que cubre el 100%, borrar el override
    # de usuario cierra la vigencia y el cálculo de HOY vuelve a la config global.
    user, _ = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_id = defs["pop_colocado"].KpiDefinitionId

    global_created = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_id, "Weight": 100, "Target": 60, "ScopeType": "global", "ScopeId": None},
    )
    assert global_created.status_code == 201, global_created.text

    created = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_id, "Weight": 100, "Target": 70, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert created.status_code == 201, created.text
    config_id = created.json()["KpiConfigId"]

    before = client.get("/kpi/config", params={"scope_type": "user", "scope_id": user.UserId}).json()
    assert any(c["KpiConfigId"] == config_id for c in before)

    deleted = client.delete(f"/kpi/config/{config_id}")
    assert deleted.status_code == 204, deleted.text

    after = client.get("/kpi/config", params={"scope_type": "user", "scope_id": user.UserId}).json()
    assert not any(c["KpiConfigId"] == config_id for c in after)

    resolved = client.get("/kpi/config/resolved", params={"user_id": user.UserId}).json()
    cfg = next(c for c in resolved["configs"] if c["kpiKey"] == "pop_colocado")
    assert cfg["scopeApplied"] == "global"
    assert cfg["target"] == 60


# ---------------------------------------------------------------------------
# POST /kpi/config/bulk — guardado en lote (intercambio de pesos entre 2+ KPIs)
# ---------------------------------------------------------------------------

def _seed_baseline_configs(db, user, kpi_a, kpi_b, kpi_c):
    """Baseline a=30+b=20+c=50=100 sembrada directo en DB (como
    test_post_config_edicion_mismo_dia_valida_contra_la_nueva): las 3 vía POST
    individual no serviría porque cada POST valida la suma tras SU cambio solo."""
    today = date.today()
    for kpi_id, weight in ((kpi_a, 30), (kpi_b, 20), (kpi_c, 50)):
        db.add(KpiConfigModel(
            KpiDefinitionId=kpi_id, Weight=weight, Target=50, ScopeType="user", ScopeId=user.UserId,
            ValidFrom=today, ValidTo=None,
        ))
    db.commit()


def test_bulk_intercambia_pesos_entre_dos_kpis_200(client, db):
    user, _ = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_a = defs["cobertura_skus"].KpiDefinitionId
    kpi_b = defs["efectividad_visitas"].KpiDefinitionId
    kpi_c = defs["pop_colocado"].KpiDefinitionId
    _seed_baseline_configs(db, user, kpi_a, kpi_b, kpi_c)

    # Cambiar 30->25 y 20->25 a la vez: el primero aislado dejaría la suma en 95.
    resp = client.post(
        "/kpi/config/bulk",
        json={
            "ScopeType": "user",
            "ScopeId": user.UserId,
            "items": [
                {"KpiDefinitionId": kpi_a, "Weight": 25, "Target": 50},
                {"KpiDefinitionId": kpi_b, "Weight": 25, "Target": 50},
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    assert len(resp.json()) == 2

    resolved = client.get("/kpi/config/resolved", params={"user_id": user.UserId}).json()
    weights = {c["kpiKey"]: c["weight"] for c in resolved["configs"]}
    assert weights["cobertura_skus"] == 25
    assert weights["efectividad_visitas"] == 25
    assert weights["pop_colocado"] == 50


def test_bulk_rompe_suma_100_422_no_aplica_nada(client, db):
    user, _ = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_a = defs["cobertura_skus"].KpiDefinitionId
    kpi_b = defs["efectividad_visitas"].KpiDefinitionId
    kpi_c = defs["pop_colocado"].KpiDefinitionId
    _seed_baseline_configs(db, user, kpi_a, kpi_b, kpi_c)

    resp = client.post(
        "/kpi/config/bulk",
        json={
            "ScopeType": "user",
            "ScopeId": user.UserId,
            "items": [
                {"KpiDefinitionId": kpi_a, "Weight": 25, "Target": 50},
                {"KpiDefinitionId": kpi_b, "Weight": 35, "Target": 50},
            ],
        },
    )
    assert resp.status_code == 422, resp.text
    assert "100" in str(resp.json()["detail"])

    resolved = client.get("/kpi/config/resolved", params={"user_id": user.UserId}).json()
    weights = {c["kpiKey"]: c["weight"] for c in resolved["configs"]}
    assert weights["cobertura_skus"] == 30  # config previa sigue vigente
    assert weights["efectividad_visitas"] == 20


def test_bulk_no_admin_403(client, db):
    _, token = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_id = defs["cobertura_skus"].KpiDefinitionId
    hdr = {"Authorization": f"Bearer {token}"}
    resp = client.post(
        "/kpi/config/bulk",
        json={"ScopeType": "global", "ScopeId": None, "items": [{"KpiDefinitionId": kpi_id, "Weight": 100, "Target": 50}]},
        headers=hdr,
    )
    assert resp.status_code == 403


def test_bulk_kpi_inexistente_no_aplica_nada(client, db):
    user, _ = _user_with_role(db, "vendedor")
    defs = _kpi_definitions(db)
    kpi_a = defs["cobertura_skus"].KpiDefinitionId

    created = client.post(
        "/kpi/config",
        json={"KpiDefinitionId": kpi_a, "Weight": 100, "Target": 50, "ScopeType": "user", "ScopeId": user.UserId},
    )
    assert created.status_code == 201, created.text

    resp = client.post(
        "/kpi/config/bulk",
        json={
            "ScopeType": "user",
            "ScopeId": user.UserId,
            "items": [
                {"KpiDefinitionId": kpi_a, "Weight": 50, "Target": 50},
                {"KpiDefinitionId": 999999, "Weight": 50, "Target": 50},
            ],
        },
    )
    assert resp.status_code == 404, resp.text

    resolved = client.get("/kpi/config/resolved", params={"user_id": user.UserId}).json()
    weights = {c["kpiKey"]: c["weight"] for c in resolved["configs"]}
    assert weights["cobertura_skus"] == 100  # config previa sigue vigente, nada aplicado


# ---------------------------------------------------------------------------
# M6 — lectura de definitions/config/scoring-rules: admin + territory_manager
# ---------------------------------------------------------------------------

def test_tm_puede_leer_definitions_config_scoring_rules(client, db):
    _, token = _user_with_role(db, "territory_manager")
    hdr = {"Authorization": f"Bearer {token}"}
    assert client.get("/kpi/definitions", headers=hdr).status_code == 200
    assert client.get("/kpi/config", headers=hdr).status_code == 200
    assert client.get("/kpi/scoring-rules", params={"type": "coverage"}, headers=hdr).status_code == 200


def test_vendedor_no_puede_leer_definitions_config_scoring_rules(client, db):
    _, token = _user_with_role(db, "vendedor")
    hdr = {"Authorization": f"Bearer {token}"}
    assert client.get("/kpi/definitions", headers=hdr).status_code == 403
    assert client.get("/kpi/config", headers=hdr).status_code == 403
    assert client.get("/kpi/scoring-rules", params={"type": "coverage"}, headers=hdr).status_code == 403
