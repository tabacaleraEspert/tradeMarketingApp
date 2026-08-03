"""Tests del motor de KPIs del tablero TMR (docs/tablero-tmr-plan-fase1.md T2/T6).

Fixtures sintéticas via sesión directa de DB (patrón de test_routes_visibility_perms.py /
test_reports_nplus1.py), sin pasar por routers (el motor todavía no está expuesto — T3).

Convención: los KpiConfig / ScoringCoverageRule / ScoringCommunicationRule de cada test
se crean con `ScopeType="user"` acotado al usuario del propio test, para no interferir
con otros tests que comparten la misma tabla (`KpiDefinition` sí es global/idempotente,
ver `_kpi_definitions`).
"""
import uuid
from datetime import date, datetime

import pytest
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.kpi_defaults import KPI_DEFINITIONS
from app.models import (
    User as UserModel,
    Zone as ZoneModel,
    PDV as PDVModel,
    Product as ProductModel,
    Route as RouteModel,
    RoutePdv as RoutePdvModel,
    RouteDay as RouteDayModel,
    RouteDayPdv as RouteDayPdvModel,
    Visit as VisitModel,
    VisitAction as VisitActionModel,
    VisitCoverage as VisitCoverageModel,
    VisitPOPItem as VisitPOPItemModel,
    KpiDefinition as KpiDefinitionModel,
    KpiConfig as KpiConfigModel,
    ScoringCoverageRule as ScoringCoverageRuleModel,
    ScoringCommunicationRule as ScoringCommunicationRuleModel,
    KpiMonthlySnapshot as KpiMonthlySnapshotModel,
)
from app.services.kpi_engine import (
    resolve_config,
    focus_universe,
    pdv_coverage_scores,
    pdv_communication_scores,
    compute_kpis,
    filter_price_outliers,
)

MONTH_YEAR, MONTH = 2026, 3  # marzo 2026: en el pasado respecto de "hoy" (2026-08) -> mes cerrado, sin snapshot -> cálculo en vivo


def _clean_kpi_tables(s):
    """Vacía las tablas de config/reglas/snapshot de KPI antes de cada test: la DB de
    sesión de pytest se comparte entre todos los tests de este archivo (y de
    test_kpi_router.py / test_kpi_snapshot.py), y filas `global`/`zone` con
    `ValidTo=None` dejadas por un test contaminarían la resolución de vigencia de
    cualquier otro (esto destapaba B1/B2 — ver auditoría del motor de KPIs)."""
    s.query(KpiMonthlySnapshotModel).delete()
    s.query(KpiConfigModel).delete()
    s.query(ScoringCoverageRuleModel).delete()
    s.query(ScoringCommunicationRuleModel).delete()
    s.commit()


@pytest.fixture()
def db():
    SessionLocal = sessionmaker(bind=engine)
    s = SessionLocal()
    try:
        _clean_kpi_tables(s)
        yield s
    finally:
        s.close()


def _uid():
    return uuid.uuid4().hex[:8]


def _user(db, zone_id=None):
    u = UserModel(Email=f"u_{_uid()}@kpi.test", DisplayName="U", PasswordHash="x", IsActive=True, ZoneId=zone_id)
    db.add(u)
    db.flush()
    return u


def _zone(db):
    z = ZoneModel(Name=f"Z_{_uid()}")
    db.add(z)
    db.flush()
    return z


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


def _route(db, assigned_user_id, is_focus=True, is_active=True):
    r = RouteModel(Name=f"R_{_uid()}", IsActive=is_active, AssignedUserId=assigned_user_id, IsFocus=is_focus)
    db.add(r)
    db.flush()
    return r


def _route_pdv(db, route_id, pdv_id):
    rp = RoutePdvModel(RouteId=route_id, PdvId=pdv_id, SortOrder=1)
    db.add(rp)
    db.flush()
    return rp


def _route_day(db, route_id, assigned_user_id, work_date):
    rd = RouteDayModel(RouteId=route_id, WorkDate=work_date, AssignedUserId=assigned_user_id, Status="PLANNED")
    db.add(rd)
    db.flush()
    return rd


def _route_day_pdv(db, route_day_id, pdv_id):
    rdp = RouteDayPdvModel(RouteDayId=route_day_id, PdvId=pdv_id, PlannedOrder=1)
    db.add(rdp)
    db.flush()
    return rdp


def _visit(db, pdv_id, user_id, opened_at, status="CLOSED", route_day_id=None):
    v = VisitModel(PdvId=pdv_id, UserId=user_id, OpenedAt=opened_at, Status=status, RouteDayId=route_day_id)
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


def _kpi_config(db, kpi_definition_id, weight, target, scope_type="user", scope_id=None, valid_from=None):
    c = KpiConfigModel(
        KpiDefinitionId=kpi_definition_id, Weight=weight, Target=target,
        ScopeType=scope_type, ScopeId=scope_id, ValidFrom=valid_from or date(2020, 1, 1), ValidTo=None,
    )
    db.add(c)
    db.flush()
    return c


def _coverage_rule(db, brand, level, min_skus, user_id, valid_from=None):
    r = ScoringCoverageRuleModel(
        Brand=brand, Level=level, MinSkus=min_skus, ScopeType="user", ScopeId=user_id,
        ValidFrom=valid_from or date(2020, 1, 1), ValidTo=None,
    )
    db.add(r)
    db.flush()
    return r


def _communication_rule(db, level, min_elements, user_id, valid_from=None):
    r = ScoringCommunicationRuleModel(
        MaterialType="total", Level=level, MinElements=min_elements, ScopeType="user", ScopeId=user_id,
        ValidFrom=valid_from or date(2020, 1, 1), ValidTo=None,
    )
    db.add(r)
    db.flush()
    return r


# ---------------------------------------------------------------------------
# 1. focus_universe
# ---------------------------------------------------------------------------

class TestFocusUniverse:
    def test_excludes_non_focus_route(self, db):
        user = _user(db)
        pdv_focus = _pdv(db)
        pdv_no_focus = _pdv(db)
        r_focus = _route(db, user.UserId, is_focus=True)
        r_no_focus = _route(db, user.UserId, is_focus=False)
        _route_pdv(db, r_focus.RouteId, pdv_focus.PdvId)
        _route_pdv(db, r_no_focus.RouteId, pdv_no_focus.PdvId)
        db.commit()

        universe = focus_universe(db, user.UserId, MONTH_YEAR, MONTH)
        assert universe == {pdv_focus.PdvId}

    def test_excludes_inactive_route(self, db):
        user = _user(db)
        pdv_active = _pdv(db)
        pdv_inactive_route = _pdv(db)
        r_active = _route(db, user.UserId, is_active=True)
        r_inactive = _route(db, user.UserId, is_active=False)
        _route_pdv(db, r_active.RouteId, pdv_active.PdvId)
        _route_pdv(db, r_inactive.RouteId, pdv_inactive_route.PdvId)
        db.commit()

        universe = focus_universe(db, user.UserId, MONTH_YEAR, MONTH)
        assert universe == {pdv_active.PdvId}

    def test_pdv_in_two_focus_routes_counts_once(self, db):
        user = _user(db)
        pdv = _pdv(db)
        r1 = _route(db, user.UserId)
        r2 = _route(db, user.UserId)
        _route_pdv(db, r1.RouteId, pdv.PdvId)
        _route_pdv(db, r2.RouteId, pdv.PdvId)
        db.commit()

        universe = focus_universe(db, user.UserId, MONTH_YEAR, MONTH)
        assert universe == {pdv.PdvId}

    def test_excludes_inactive_pdv(self, db):
        # M3: un PDV dado de baja (IsActive=False) queda fuera del universo/denominadores
        # aunque siga en RoutePdv de una ruta foco activa.
        user = _user(db)
        pdv_active = _pdv(db, IsActive=True)
        pdv_inactive = _pdv(db, IsActive=False)
        route = _route(db, user.UserId)
        _route_pdv(db, route.RouteId, pdv_active.PdvId)
        _route_pdv(db, route.RouteId, pdv_inactive.PdvId)
        db.commit()

        universe = focus_universe(db, user.UserId, MONTH_YEAR, MONTH)
        assert universe == {pdv_active.PdvId}


# ---------------------------------------------------------------------------
# 2. pdv_coverage_scores — borde de rúbrica y sin relevar
# ---------------------------------------------------------------------------

class TestCoverageScores:
    def test_bueno_threshold_border(self, db):
        user = _user(db)
        pdv = _pdv(db)
        route = _route(db, user.UserId)
        _route_pdv(db, route.RouteId, pdv.PdvId)

        # Rúbrica reducida: solo Milenio, mínimo "bueno"=3, "muy_bueno"=4, "excelente"=5
        # (rules explícitas en todos los niveles para que "excelente"/"muy_bueno" no
        # queden vacíamente satisfechos por falta de regla).
        _coverage_rule(db, "Milenio", "excelente", 5, user.UserId)
        _coverage_rule(db, "Milenio", "muy_bueno", 4, user.UserId)
        _coverage_rule(db, "Milenio", "bueno", 3, user.UserId)
        _coverage_rule(db, "Total cigs", "excelente", 5, user.UserId)
        _coverage_rule(db, "Total cigs", "muy_bueno", 4, user.UserId)
        _coverage_rule(db, "Total cigs", "bueno", 3, user.UserId)

        products = [_product(db, f"Milenio {i}") for i in range(3)]  # exactamente 3 -> borde de "bueno"
        db.commit()

        visit = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 10))
        for p in products:
            _coverage(db, visit.VisitId, p.ProductId, works=True)
        db.commit()

        scores = pdv_coverage_scores(db, user.UserId, MONTH_YEAR, MONTH)
        assert scores[pdv.PdvId] == "bueno"

    def test_sin_relevamiento_en_mes(self, db):
        user = _user(db)
        pdv = _pdv(db)
        route = _route(db, user.UserId)
        _route_pdv(db, route.RouteId, pdv.PdvId)
        db.commit()

        scores = pdv_coverage_scores(db, user.UserId, MONTH_YEAR, MONTH)
        assert scores[pdv.PdvId] == "sin_relevar"
        # No suma numerador de KPI 1 pero sí aparece en el universo (denominador).
        universe = focus_universe(db, user.UserId, MONTH_YEAR, MONTH)
        assert pdv.PdvId in universe

    def test_consolida_ultimo_valor_por_producto_entre_visitas(self, db):
        # M4: visita 1 releva 8 SKUs (Works=true), visita 2 (posterior) releva otros 2
        # SKUs distintos -> el score debe usar el último valor de cada uno de los 8+2,
        # no solo lo relevado en la última visita (que perdería los 8 de la visita 1).
        user = _user(db)
        pdv = _pdv(db)
        route = _route(db, user.UserId)
        _route_pdv(db, route.RouteId, pdv.PdvId)
        # Rules explícitas en todos los niveles (si no, "excelente"/"muy_bueno" quedan
        # vacíamente satisfechos por falta de regla, ver test_bueno_threshold_border).
        _coverage_rule(db, "Milenio", "excelente", 11, user.UserId)
        _coverage_rule(db, "Milenio", "muy_bueno", 11, user.UserId)
        _coverage_rule(db, "Milenio", "bueno", 10, user.UserId)
        _coverage_rule(db, "Total cigs", "excelente", 11, user.UserId)
        _coverage_rule(db, "Total cigs", "muy_bueno", 11, user.UserId)
        _coverage_rule(db, "Total cigs", "bueno", 10, user.UserId)

        products_v1 = [_product(db, f"Milenio {i}") for i in range(8)]
        products_v2 = [_product(db, f"Milenio {i}") for i in range(8, 10)]
        db.commit()

        visit1 = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 5))
        for p in products_v1:
            _coverage(db, visit1.VisitId, p.ProductId, works=True)
        visit2 = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 20))
        for p in products_v2:
            _coverage(db, visit2.VisitId, p.ProductId, works=True)
        db.commit()

        scores = pdv_coverage_scores(db, user.UserId, MONTH_YEAR, MONTH)
        assert scores[pdv.PdvId] == "bueno"  # 10 SKUs distintos trabajando (8+2)


# ---------------------------------------------------------------------------
# 3. KPI 2 — efectividad de visitas
# ---------------------------------------------------------------------------

class TestKpi2Efectividad:
    def _setup(self, db):
        user = _user(db)
        pdv = _pdv(db)
        route = _route(db, user.UserId)
        _route_pdv(db, route.RouteId, pdv.PdvId)
        route_day = _route_day(db, route.RouteId, user.UserId, date(MONTH_YEAR, MONTH, 5))
        _route_day_pdv(db, route_day.RouteDayId, pdv.PdvId)
        defs = _kpi_definitions(db)
        _kpi_config(db, defs["efectividad_visitas"].KpiDefinitionId, weight=10, target=50, scope_id=user.UserId)
        db.commit()
        return user, pdv, route_day

    def test_visit_out_of_plan_does_not_count(self, db):
        user, pdv, route_day = self._setup(db)
        # Visita completa pero SIN RouteDayId (fuera de plan)
        visit = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 6), status="CLOSED", route_day_id=None)
        product = _product(db, "Milenio Fuera")
        db.add(product); db.flush()
        _coverage(db, visit.VisitId, product.ProductId)
        _pop_item(db, visit.VisitId, "Stopper")
        _action(db, visit.VisitId, "cobertura", status="DONE")
        db.commit()

        result = compute_kpis(db, user.UserId, MONTH_YEAR, MONTH)
        kpi = next(k for k in result.kpis if k.key == "efectividad_visitas")
        assert kpi.numerator == 0
        assert kpi.denominator == 1

    def test_planned_visit_without_action_does_not_count(self, db):
        user, pdv, route_day = self._setup(db)
        visit = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 6), status="CLOSED", route_day_id=route_day.RouteDayId)
        product = _product(db, "Milenio SinAccion")
        db.add(product); db.flush()
        _coverage(db, visit.VisitId, product.ProductId)
        _pop_item(db, visit.VisitId, "Stopper")
        # sin VisitAction DONE
        db.commit()

        result = compute_kpis(db, user.UserId, MONTH_YEAR, MONTH)
        kpi = next(k for k in result.kpis if k.key == "efectividad_visitas")
        assert kpi.numerator == 0
        assert kpi.denominator == 1

    def test_all_three_conditions_counts(self, db):
        user, pdv, route_day = self._setup(db)
        # OpenedAt debe caer el mismo día que RouteDay.WorkDate (5) para acreditar (M2).
        visit = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 5, 9), status="CLOSED", route_day_id=route_day.RouteDayId)
        product = _product(db, "Milenio Completo")
        db.add(product); db.flush()
        _coverage(db, visit.VisitId, product.ProductId)
        _pop_item(db, visit.VisitId, "Stopper")
        _action(db, visit.VisitId, "cobertura", status="DONE")
        db.commit()

        result = compute_kpis(db, user.UserId, MONTH_YEAR, MONTH)
        kpi = next(k for k in result.kpis if k.key == "efectividad_visitas")
        assert kpi.numerator == 1
        assert kpi.denominator == 1

    def test_visit_de_otro_usuario_no_acredita(self, db):
        # M1: una visita de OTRO usuario sobre el mismo RouteDay/PDV no debe acreditar
        # la efectividad del usuario dueño de la ruta.
        user, pdv, route_day = self._setup(db)
        other_user = _user(db)
        visit = _visit(db, pdv.PdvId, other_user.UserId, datetime(MONTH_YEAR, MONTH, 5, 9), status="CLOSED", route_day_id=route_day.RouteDayId)
        product = _product(db, "Milenio Ajeno")
        db.add(product); db.flush()
        _coverage(db, visit.VisitId, product.ProductId)
        _pop_item(db, visit.VisitId, "Stopper")
        _action(db, visit.VisitId, "cobertura", status="DONE")
        db.commit()

        result = compute_kpis(db, user.UserId, MONTH_YEAR, MONTH)
        kpi = next(k for k in result.kpis if k.key == "efectividad_visitas")
        assert kpi.numerator == 0
        assert kpi.denominator == 1

    def test_visit_de_otro_dia_del_route_day_no_acredita(self, db):
        # M2: visita atada al RouteDayId correcto pero abierta OTRO día (no el
        # WorkDate=5 del RouteDay) no debe acreditar como planificada.
        user, pdv, route_day = self._setup(db)
        visit = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 6, 9), status="CLOSED", route_day_id=route_day.RouteDayId)
        product = _product(db, "Milenio OtroDia")
        db.add(product); db.flush()
        _coverage(db, visit.VisitId, product.ProductId)
        _pop_item(db, visit.VisitId, "Stopper")
        _action(db, visit.VisitId, "cobertura", status="DONE")
        db.commit()

        result = compute_kpis(db, user.UserId, MONTH_YEAR, MONTH)
        kpi = next(k for k in result.kpis if k.key == "efectividad_visitas")
        assert kpi.numerator == 0
        assert kpi.denominator == 1


# ---------------------------------------------------------------------------
# 4. KPI 3 — penetración de sueltos
# ---------------------------------------------------------------------------

class TestKpi3Sueltos:
    def test_denominator_only_sells_loose_and_canje_elsewhere_does_not_count(self, db):
        user = _user(db)
        pdv_loose = _pdv(db, SellsLooseCigarettes=True)
        pdv_no_loose = _pdv(db, SellsLooseCigarettes=False)
        route = _route(db, user.UserId)
        _route_pdv(db, route.RouteId, pdv_loose.PdvId)
        _route_pdv(db, route.RouteId, pdv_no_loose.PdvId)
        defs = _kpi_definitions(db)
        _kpi_config(db, defs["penetracion_sueltos"].KpiDefinitionId, weight=10, target=50, scope_id=user.UserId)
        db.commit()

        # Canje realizado en el PDV que NO vende sueltos -> no debe sumar.
        visit = _visit(db, pdv_no_loose.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 8))
        _action(db, visit.VisitId, "canje_sueltos", status="DONE")
        db.commit()

        result = compute_kpis(db, user.UserId, MONTH_YEAR, MONTH)
        kpi = next(k for k in result.kpis if k.key == "penetracion_sueltos")
        assert kpi.denominator == 1  # solo pdv_loose
        assert kpi.numerator == 0


# ---------------------------------------------------------------------------
# 5. KPI 4 — colocación de POP (requisito de foto)
# ---------------------------------------------------------------------------

class TestKpi4Pop:
    def _setup(self, db):
        user = _user(db)
        pdv = _pdv(db)
        route = _route(db, user.UserId)
        _route_pdv(db, route.RouteId, pdv.PdvId)
        _communication_rule(db, "excelente", 1, user.UserId)  # 1 elemento alcanza "excelente" (rúbrica reducida)
        defs = _kpi_definitions(db)
        _kpi_config(db, defs["pop_colocado"].KpiDefinitionId, weight=30, target=50, scope_id=user.UserId)
        db.commit()
        return user, pdv

    def test_excelente_sin_foto_no_cuenta(self, db):
        user, pdv = self._setup(db)
        visit = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 10))
        _pop_item(db, visit.VisitId, "Escalerita", present=True)
        # acción POP sin PhotoTaken
        _action(db, visit.VisitId, "pop", status="DONE", photo_taken=False)
        db.commit()

        result = compute_kpis(db, user.UserId, MONTH_YEAR, MONTH)
        kpi = next(k for k in result.kpis if k.key == "pop_colocado")
        assert kpi.numerator == 0
        assert kpi.denominator == 1

    def test_excelente_con_foto_cuenta(self, db):
        user, pdv = self._setup(db)
        visit = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 10))
        _pop_item(db, visit.VisitId, "Escalerita", present=True)
        _action(db, visit.VisitId, "pop", status="DONE", photo_taken=True)
        db.commit()

        result = compute_kpis(db, user.UserId, MONTH_YEAR, MONTH)
        kpi = next(k for k in result.kpis if k.key == "pop_colocado")
        assert kpi.numerator == 1
        assert kpi.denominator == 1

    def test_comunicacion_consolida_ultimo_valor_por_material_entre_visitas(self, db):
        # M4: visita 1 releva "Stopper" presente, visita 2 (posterior) releva
        # "Escalerita" presente -> el score debe contar ambos materiales (2), no solo
        # lo relevado en la última visita (que perdería "Stopper").
        user, pdv = self._setup(db)
        _communication_rule(db, "excelente", 2, user.UserId)  # ya cubierta por defaults; sobreescribe MinElements
        visit1 = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 5))
        _pop_item(db, visit1.VisitId, "Stopper", present=True)
        visit2 = _visit(db, pdv.PdvId, user.UserId, datetime(MONTH_YEAR, MONTH, 20))
        _pop_item(db, visit2.VisitId, "Escalerita", present=True)
        db.commit()

        scores = pdv_communication_scores(db, user.UserId, MONTH_YEAR, MONTH)
        assert scores[pdv.PdvId] == "excelente"  # 2 materiales distintos (Stopper + Escalerita)


# ---------------------------------------------------------------------------
# 6. Resolución de configuración (scope + vigencia)
# ---------------------------------------------------------------------------

class TestResolveConfig:
    def test_user_beats_zone_beats_global(self, db):
        zone = _zone(db)
        user = _user(db, zone_id=zone.ZoneId)
        defs = _kpi_definitions(db)
        kpi_id = defs["cobertura_skus"].KpiDefinitionId

        _kpi_config(db, kpi_id, weight=1, target=1, scope_type="global", scope_id=None)
        _kpi_config(db, kpi_id, weight=2, target=2, scope_type="zone", scope_id=zone.ZoneId)
        _kpi_config(db, kpi_id, weight=3, target=3, scope_type="user", scope_id=user.UserId)
        db.commit()

        configs, warning = resolve_config(db, user.UserId, MONTH_YEAR, MONTH)
        cfg = next(c for c in configs if c.kpi_key == "cobertura_skus")
        assert cfg.weight == 3
        assert cfg.scope_applied == "user"

    def test_zone_beats_global_when_no_user_config(self, db):
        zone = _zone(db)
        user = _user(db, zone_id=zone.ZoneId)
        defs = _kpi_definitions(db)
        kpi_id = defs["efectividad_visitas"].KpiDefinitionId

        _kpi_config(db, kpi_id, weight=1, target=1, scope_type="global", scope_id=None)
        _kpi_config(db, kpi_id, weight=2, target=2, scope_type="zone", scope_id=zone.ZoneId)
        db.commit()

        configs, warning = resolve_config(db, user.UserId, MONTH_YEAR, MONTH)
        cfg = next(c for c in configs if c.kpi_key == "efectividad_visitas")
        assert cfg.weight == 2
        assert cfg.scope_applied == "zone"

    def test_weight_sum_not_100_warns(self, db):
        user = _user(db)
        defs = _kpi_definitions(db)
        # Solo un KPI configurado con peso 30 (para este usuario) -> suma resuelta = 30 != 100
        _kpi_config(db, defs["cobertura_skus"].KpiDefinitionId, weight=30, target=80, scope_id=user.UserId)
        db.commit()

        configs, warning = resolve_config(db, user.UserId, MONTH_YEAR, MONTH)
        assert warning is not None
        assert "100" in warning

    def test_edicion_mismo_dia_usa_la_nueva(self, db):
        # B1: cerrar una config con ValidTo=hoy y crear la reemplazante con
        # ValidFrom=hoy (edición el mismo día, como hace el POST del router) debe hacer
        # que HOY (mes en curso) se resuelva la nueva, no la vieja.
        user = _user(db)
        defs = _kpi_definitions(db)
        kpi_id = defs["cobertura_skus"].KpiDefinitionId
        today = date.today()

        old = _kpi_config(db, kpi_id, weight=100, target=50, scope_id=user.UserId, valid_from=today)
        db.commit()
        old.ValidTo = today
        db.commit()
        _kpi_config(db, kpi_id, weight=100, target=80, scope_id=user.UserId, valid_from=today)
        db.commit()

        configs, _warning = resolve_config(db, user.UserId, today.year, today.month)
        cfg = next(c for c in configs if c.kpi_key == "cobertura_skus")
        assert cfg.target == 80


# ---------------------------------------------------------------------------
# 7. Snapshot — mes cerrado no se recalcula
# ---------------------------------------------------------------------------

class TestSnapshot:
    def test_closed_month_prefers_snapshot_even_if_raw_data_changes(self, db):
        user = _user(db)
        defs = _kpi_definitions(db)
        kpi_def = defs["cobertura_skus"]
        _kpi_config(db, kpi_def.KpiDefinitionId, weight=30, target=80, scope_id=user.UserId)

        snapshot = KpiMonthlySnapshotModel(
            UserId=user.UserId, Year=MONTH_YEAR, Month=MONTH, KpiDefinitionId=kpi_def.KpiDefinitionId,
            Actual=80, Target=80, Weight=30, ScopeApplied="user", Achieved=True, Numerator=8, Denominator=10,
        )
        db.add(snapshot)
        db.commit()

        # Datos crudos post-cierre que, si se recalculara en vivo, darían otro resultado.
        pdv = _pdv(db)
        route = _route(db, user.UserId)
        _route_pdv(db, route.RouteId, pdv.PdvId)
        db.commit()

        result = compute_kpis(db, user.UserId, MONTH_YEAR, MONTH)
        kpi = next(k for k in result.kpis if k.key == "cobertura_skus")
        assert kpi.numerator == 8
        assert kpi.denominator == 10
        assert result.partial is False


# ---------------------------------------------------------------------------
# 9. Outliers de precio
# ---------------------------------------------------------------------------

class TestPriceOutliers:
    def test_discards_10x_median(self, db):
        prices = [
            {"price": 150, "pdv": 1, "user": 1, "date": "2026-03-01", "product": "Milenio Red"},
            {"price": 155, "pdv": 2, "user": 1, "date": "2026-03-02", "product": "Milenio Red"},
            {"price": 145, "pdv": 3, "user": 1, "date": "2026-03-03", "product": "Milenio Red"},
            {"price": 1500, "pdv": 4, "user": 2, "date": "2026-03-04", "product": "Milenio Red"},  # ~10x mediana
        ]
        valid, discarded = filter_price_outliers(prices)
        assert len(discarded) == 1
        assert discarded[0]["price"] == 1500
        assert discarded[0]["pdv"] == 4
        assert len(valid) == 3

    def test_excludes_test_products(self, db):
        prices = [
            {"price": 100, "pdv": 1, "user": 1, "date": "2026-03-01", "product": "TEST_Producto"},
            {"price": 150, "pdv": 2, "user": 1, "date": "2026-03-02", "product": "Milenio Red"},
        ]
        valid, discarded = filter_price_outliers(prices)
        assert all(p["product"] != "TEST_Producto" for p in valid)
        assert any(p["product"] == "TEST_Producto" for p in discarded)
