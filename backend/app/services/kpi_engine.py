"""Motor de cálculo de KPIs del tablero TMR.

Contrato: docs/tablero-tmr-diseno.md §3 (numeradores/denominadores) y
docs/tablero-tmr-plan-fase1.md tarea T2. Funciones puras respecto de la
sesión de DB (solo lectura, sin side effects).

Convenciones de fuente de datos resueltas al implementar (no explícitas en el
diseño, ver docstrings de cada función para el detalle):

- **Foto POP (KPI 4)**: la app mobile escribe *ambas* fuentes en distintos
  pasos del flujo — `VisitAction(ActionType='pop', PhotoTaken=...)` al
  completar la acción "Colocación de material POP" (VisitActionsPage.tsx) y
  `VisitPhoto` con `PhotoType` prefijado `"pop_<material>_<empresa>"` (no el
  valor exacto `"pop"`) al completar el censo POP (POPCensusPage.tsx). Se usa
  `VisitAction(ActionType='pop', Status='DONE', PhotoTaken=true)` como fuente
  primaria (más simple de agregar y explícitamente ligada a una acción DONE)
  con `VisitPhoto.PhotoType LIKE 'pop%'` como OR de respaldo.
- **Elementos POP (rúbrica de comunicación)**: la tarea pedía contar
  "MaterialType distintos", pero `VisitPOPItem.MaterialType` solo toma dos
  valores (`primario`/`secundario`) — no puede llegar a los 4 elementos de la
  rúbrica "Excelente". El detalle real de materiales vive en
  `VisitPOPItem.MaterialName` (Cigarrera aérea, Stopper, Escalerita, Afiche,
  etc.), que es lo que efectivamente enumera §4 del diseño. Se cuenta
  `MaterialName` distinto con `Present=true`; se documenta acá porque es una
  corrección de la letra del ticket a la intención real (la rúbrica de
  comunicación con `MaterialType='total'`).
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, datetime
from statistics import median
from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from ..models import (
    KpiConfig,
    KpiDefinition,
    KpiMonthlySnapshot,
    PDV,
    Product,
    Route,
    RouteDay,
    RouteDayPdv,
    RoutePdv,
    ScoringCommunicationRule,
    ScoringCoverageRule,
    User,
    Visit,
    VisitAction,
    VisitCoverage,
    VisitPhoto,
    VisitPOPItem,
)

# Niveles de rúbrica, de más bajo a más alto.
LEVELS = ("regular", "bueno", "muy_bueno", "excelente")
GOOD_OR_BETTER = {"bueno", "muy_bueno", "excelente"}

# Marcas de la rúbrica de cobertura (§4 del diseño). "Total cigs" agrupa las primeras
# 4; "Total tabacos" agrupa las últimas 2 (ver docstring de `pdv_coverage_scores`).
CIGS_BRANDS = ("Milenio", "Mill", "Melbourne", "Bold")
TABACOS_BRANDS = ("Van Kiff", "Lebonn")


@dataclass
class ResolvedKpiConfig:
    """Config de un KPI ya resuelta (peso/meta) para un usuario/mes puntual."""

    kpi_definition_id: int
    kpi_key: str
    name: str
    weight: int
    target: float
    scope_applied: str  # global | zone | user


@dataclass
class KpiResultItem:
    key: str
    name: str
    actual: float
    target: float
    weight: int
    achieved: bool
    numerator: int
    denominator: int
    scope_applied: str


@dataclass
class KpiResult:
    user_id: int
    year: int
    month: int
    partial: bool
    day: int
    days_in_month: int
    kpis: list = field(default_factory=list)
    variable_total: float = 0.0
    config_warning: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers de tiempo
# ---------------------------------------------------------------------------

def _is_current_month(year: int, month: int) -> bool:
    today = date.today()
    return today.year == year and today.month == month


def _reference_date(year: int, month: int) -> date:
    """Fecha de vigencia a evaluar: hoy si es el mes en curso, si no el día 1."""
    return date.today() if _is_current_month(year, month) else date(year, month, 1)


def _month_range(year: int, month: int) -> tuple[date, date]:
    """(primer día del mes, primer día del mes siguiente) — límite exclusivo."""
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def _month_datetime_range(year: int, month: int) -> tuple[datetime, datetime]:
    start, end = _month_range(year, month)
    return datetime.combine(start, datetime.min.time()), datetime.combine(end, datetime.min.time())


def _pct(numerator: int, denominator: int) -> float:
    # Denominador 0 => 0% => KPI incumplido. Decisión de negocio (P12, 03-08-2026):
    # sin estructura (ej. ningún PDV que venda sueltos) el KPI se pierde igual;
    # el objetivo del vendedor incluye generar esa estructura.
    if not denominator:
        return 0.0
    return round(100.0 * numerator / denominator, 2)


# ---------------------------------------------------------------------------
# Resolución de configuración con alcance (user > zone > global)
# ---------------------------------------------------------------------------

def _vigente_filter(model_cls, ref_date: date):
    """Una fila cerrada (`ValidTo`) el mismo `ref_date` ya NO está vigente ese día:
    el cierre surte efecto de inmediato (permite editar una config el mismo día que se
    creó sin que la vieja siga ganando, ver B1 de la auditoría del motor de KPIs)."""
    return and_(
        model_cls.ValidFrom <= ref_date,
        or_(model_cls.ValidTo.is_(None), model_cls.ValidTo > ref_date),
    )


def _row_pk(row) -> int:
    """PK genérica de una fila de config/regla (distinto nombre de columna según
    modelo: `KpiConfigId` vs `RuleId`)."""
    mapper = sa_inspect(row).mapper
    return getattr(row, mapper.primary_key[0].name)


def _scope_rank(scope_type: str, scope_id, user_id: int, zone_id) -> Optional[int]:
    """Devuelve la especificidad de una fila de scope para este usuario, o None
    si esa fila no aplica (p.ej. `zone` de una zona que no es la del usuario)."""
    if scope_type == "user" and scope_id == user_id:
        return 2
    if scope_type == "zone" and zone_id is not None and scope_id == zone_id:
        return 1
    if scope_type == "global":
        return 0
    return None


def _resolve_rows(rows, user_id: int, zone_id, group_key_fn):
    """De una lista de filas vigentes, se queda con la más específica por grupo
    (`user` > `zone` > `global`); a igual especificidad, la de `ValidFrom` más
    reciente; a igual `ValidFrom` (edición el mismo día), la de PK más alta (la más
    nueva — ver B1 de la auditoría del motor de KPIs)."""
    best: dict = {}
    for row in rows:
        rank = _scope_rank(row.ScopeType, row.ScopeId, user_id, zone_id)
        if rank is None:
            continue
        key = group_key_fn(row)
        current = best.get(key)
        if current is None:
            best[key] = (rank, row)
            continue
        cur_rank, cur_row = current
        if rank > cur_rank:
            best[key] = (rank, row)
        elif rank == cur_rank:
            if row.ValidFrom > cur_row.ValidFrom:
                best[key] = (rank, row)
            elif row.ValidFrom == cur_row.ValidFrom and _row_pk(row) > _row_pk(cur_row):
                best[key] = (rank, row)
    return {k: v[1] for k, v in best.items()}


def resolve_config(db: Session, user_id: int, year: int, month: int) -> tuple[list[ResolvedKpiConfig], Optional[str]]:
    """Por cada KPI activo, la `KpiConfig` más específica vigente (`user` > `zone`
    del usuario > `global`), evaluada al día 1 del mes consultado o a la fecha
    actual si es el mes en curso.

    Devuelve `(configs, config_warning)`: `config_warning` no es None si la
    suma de pesos del set resuelto no da 100 (no bloquea el cálculo, solo
    informa).
    """
    ref_date = _reference_date(year, month)
    user = db.query(User).filter(User.UserId == user_id).first()
    zone_id = user.ZoneId if user else None

    definitions = db.query(KpiDefinition).filter(KpiDefinition.IsActive == True).all()  # noqa: E712
    def_ids = [d.KpiDefinitionId for d in definitions]

    rows = []
    if def_ids:
        rows = (
            db.query(KpiConfig)
            .filter(KpiConfig.KpiDefinitionId.in_(def_ids), _vigente_filter(KpiConfig, ref_date))
            .all()
        )

    resolved_by_def = _resolve_rows(rows, user_id, zone_id, lambda r: r.KpiDefinitionId)

    configs = []
    for d in definitions:
        cfg = resolved_by_def.get(d.KpiDefinitionId)
        if cfg is None:
            continue  # sin config vigente para este KPI -> no se calcula
        configs.append(ResolvedKpiConfig(
            kpi_definition_id=d.KpiDefinitionId,
            kpi_key=d.KpiKey,
            name=d.Name,
            weight=cfg.Weight,
            target=float(cfg.Target),
            scope_applied=cfg.ScopeType,
        ))

    total_weight = sum(c.weight for c in configs)
    config_warning = None
    if total_weight != 100:
        config_warning = f"La suma de pesos de la config resuelta es {total_weight}%, no 100%."

    return configs, config_warning


def _resolve_coverage_rules(db: Session, user_id: int, zone_id, ref_date: date) -> dict:
    rows = db.query(ScoringCoverageRule).filter(_vigente_filter(ScoringCoverageRule, ref_date)).all()
    resolved = _resolve_rows(rows, user_id, zone_id, lambda r: (r.Brand, r.Level))
    return {key: r.MinSkus for key, r in resolved.items()}


def _resolve_communication_rules(db: Session, user_id: int, zone_id, ref_date: date) -> dict:
    rows = db.query(ScoringCommunicationRule).filter(_vigente_filter(ScoringCommunicationRule, ref_date)).all()
    resolved = _resolve_rows(rows, user_id, zone_id, lambda r: (r.MaterialType, r.Level))
    return {key: r.MinElements for key, r in resolved.items()}


# ---------------------------------------------------------------------------
# Universo de PDVs (ruta foco)
# ---------------------------------------------------------------------------

def focus_universe(db: Session, user_id: int, year: int, month: int) -> set:
    """PDVs distintos en `RoutePdv` de rutas `IsFocus=true, IsActive=true,
    AssignedUserId=user_id`.

    `year`/`month` se reciben por simetría con el resto del motor, pero hoy no
    filtran nada: la asignación de ruta no está versionada en el tiempo.
    """
    rows = (
        db.query(RoutePdv.PdvId)
        .join(Route, Route.RouteId == RoutePdv.RouteId)
        .join(PDV, PDV.PdvId == RoutePdv.PdvId)
        .filter(
            Route.IsFocus == True, Route.IsActive == True, Route.AssignedUserId == user_id,  # noqa: E712
            PDV.IsActive == True,  # noqa: E712
        )
        .distinct()
        .all()
    )
    return {r[0] for r in rows}


# ---------------------------------------------------------------------------
# Scoring de cobertura (KPI 1)
# ---------------------------------------------------------------------------

def _matched_sku_names(brand: str, works_products: set) -> set:
    return {name for name in works_products if name.startswith(brand)}


def _coverage_level(works_products: set, rules: dict) -> str:
    cigs_total = len({name for b in CIGS_BRANDS for name in _matched_sku_names(b, works_products)})
    tabacos_total = len({name for b in TABACOS_BRANDS for name in _matched_sku_names(b, works_products)})

    for level in reversed(LEVELS):  # excelente -> regular
        ok = True
        for brand in CIGS_BRANDS + TABACOS_BRANDS:
            min_skus = rules.get((brand, level))
            if min_skus is not None and len(_matched_sku_names(brand, works_products)) < min_skus:
                ok = False
                break
        if ok:
            min_cigs = rules.get(("Total cigs", level))
            if min_cigs is not None and cigs_total < min_cigs:
                ok = False
            min_tabacos = rules.get(("Total tabacos", level))
            if ok and min_tabacos is not None and tabacos_total < min_tabacos:
                ok = False
        if ok:
            return level
    return "no_cuenta"


def pdv_coverage_scores(db: Session, user_id: int, year: int, month: int) -> dict:
    """Nivel de cobertura por PDV del universo foco (rúbrica §4 del diseño).

    Convención de matching marca <-> producto: una regla `ScoringCoverageRule`
    con `Brand='Milenio'` matchea todo producto cuyo `Product.Name` empiece
    con `"Milenio"` (idem Mill/Melbourne/Bold/Van Kiff/Lebonn). Las filas
    `Brand='Total cigs'` / `'Total tabacos'` no matchean productos: son
    totales agregados —`Total cigs` = cantidad de SKUs *distintos* con
    `Works=true` entre Milenio+Mill+Melbourne+Bold; `Total tabacos` = ídem
    entre Van Kiff+Lebonn.

    Nivel del PDV = el más alto (excelente > muy_bueno > bueno > regular) cuyos
    requisitos —todas las filas de marca individuales Y las dos filas de total
    de ESE nivel— se cumplen con los productos consolidados como `Works=true`
    en el mes: por cada producto relevado, se toma el valor de la visita MÁS
    RECIENTE del mes que lo haya relevado (una segunda visita parcial no borra lo
    relevado antes por otra visita, ver M4 de la auditoría del motor de KPIs). Si
    ninguno se cumple -> `'no_cuenta'`. Sin ningún relevamiento de cobertura en el
    mes -> `'sin_relevar'`.
    """
    universe = focus_universe(db, user_id, year, month)
    if not universe:
        return {}

    user = db.query(User).filter(User.UserId == user_id).first()
    zone_id = user.ZoneId if user else None
    ref_date = _reference_date(year, month)
    rules = _resolve_coverage_rules(db, user_id, zone_id, ref_date)

    start, end = _month_datetime_range(year, month)

    result = {}
    for pdv_id in universe:
        cov_rows = (
            db.query(VisitCoverage, Product, Visit.OpenedAt)
            .join(Visit, Visit.VisitId == VisitCoverage.VisitId)
            .join(Product, Product.ProductId == VisitCoverage.ProductId)
            .filter(
                Visit.PdvId == pdv_id,
                Visit.UserId == user_id,
                Visit.OpenedAt >= start,
                Visit.OpenedAt < end,
            )
            .all()
        )
        if not cov_rows:
            result[pdv_id] = "sin_relevar"
            continue

        latest_by_product: dict = {}
        for cov, product, opened_at in cov_rows:
            current = latest_by_product.get(product.ProductId)
            if current is None or opened_at > current[0]:
                latest_by_product[product.ProductId] = (opened_at, cov.Works, product.Name)

        works_products = {name for _, works, name in latest_by_product.values() if works}
        result[pdv_id] = _coverage_level(works_products, rules)

    return result


# ---------------------------------------------------------------------------
# Scoring de comunicación (KPI 4)
# ---------------------------------------------------------------------------

def pdv_communication_scores(db: Session, user_id: int, year: int, month: int) -> dict:
    """Nivel de comunicación (rúbrica de POP) por PDV del universo foco.

    Nivel = el más alto cuya `MinElements` (filas `ScoringCommunicationRule`
    con `MaterialType='total'`) es <= a la cantidad de `VisitPOPItem.MaterialName`
    distintos consolidados como `Present=true` en el mes: por cada material
    relevado, se toma el valor de la visita MÁS RECIENTE del mes que lo haya
    relevado (una segunda visita parcial no borra lo relevado antes por otra
    visita, ver M4 de la auditoría del motor de KPIs; ver nota del módulo sobre
    por qué se cuenta `MaterialName`, no `MaterialType`). Sin relevamiento POP en
    el mes -> `'sin_relevar'`.
    """
    universe = focus_universe(db, user_id, year, month)
    if not universe:
        return {}

    user = db.query(User).filter(User.UserId == user_id).first()
    zone_id = user.ZoneId if user else None
    ref_date = _reference_date(year, month)
    rules = _resolve_communication_rules(db, user_id, zone_id, ref_date)

    start, end = _month_datetime_range(year, month)

    result = {}
    for pdv_id in universe:
        pop_rows = (
            db.query(VisitPOPItem, Visit.OpenedAt)
            .join(Visit, Visit.VisitId == VisitPOPItem.VisitId)
            .filter(
                Visit.PdvId == pdv_id,
                Visit.UserId == user_id,
                Visit.OpenedAt >= start,
                Visit.OpenedAt < end,
            )
            .all()
        )
        if not pop_rows:
            result[pdv_id] = "sin_relevar"
            continue

        latest_by_material: dict = {}
        for item, opened_at in pop_rows:
            current = latest_by_material.get(item.MaterialName)
            if current is None or opened_at > current[0]:
                latest_by_material[item.MaterialName] = (opened_at, item.Present)

        present_materials = {name for name, (_, present) in latest_by_material.items() if present}
        count = len(present_materials)

        level = "no_cuenta"
        for lvl in reversed(LEVELS):
            min_elements = rules.get(("total", lvl))
            if min_elements is not None and count >= min_elements:
                level = lvl
                break
        result[pdv_id] = level

    return result


# ---------------------------------------------------------------------------
# Numeradores/denominadores por KPI (tabla §3 del diseño)
# ---------------------------------------------------------------------------

def _has_pop_photo(db: Session, user_id: int, pdv_id: int, start: datetime, end: datetime) -> bool:
    """Foto POP tomada desde la app en el mes (requisito excluyente del KPI 4).

    Fuente primaria: `VisitAction(ActionType='pop', Status='DONE', PhotoTaken=true)`
    (lo que escribe VisitActionsPage.tsx). OR de respaldo: `VisitPhoto` con
    `PhotoType` que empieza con `'pop'` (POPCensusPage.tsx usa `pop_<material>_<empresa>`,
    no el literal `'pop'`). Ver nota de módulo.
    """
    visit_ids = [
        v.VisitId for v in
        db.query(Visit.VisitId).filter(
            Visit.PdvId == pdv_id, Visit.UserId == user_id,
            Visit.OpenedAt >= start, Visit.OpenedAt < end,
        )
    ]
    if not visit_ids:
        return False

    has_action_photo = db.query(VisitAction).filter(
        VisitAction.VisitId.in_(visit_ids),
        VisitAction.ActionType == "pop",
        VisitAction.Status == "DONE",
        VisitAction.PhotoTaken == True,  # noqa: E712
    ).first() is not None
    if has_action_photo:
        return True

    return db.query(VisitPhoto).filter(
        VisitPhoto.VisitId.in_(visit_ids),
        VisitPhoto.PhotoType.like("pop%"),
    ).first() is not None


def _kpi1_cobertura(coverage_scores: dict, universe: set) -> tuple[int, int]:
    numerator = sum(1 for pdv_id in universe if coverage_scores.get(pdv_id) in GOOD_OR_BETTER)
    return numerator, len(universe)


def _kpi2_efectividad(db: Session, user_id: int, start: date, end: date) -> tuple[int, int]:
    route_days = (
        db.query(RouteDay.RouteDayId, RouteDay.WorkDate)
        .join(Route, Route.RouteId == RouteDay.RouteId)
        .filter(
            Route.IsFocus == True, Route.IsActive == True, Route.AssignedUserId == user_id,  # noqa: E712
            RouteDay.WorkDate >= start, RouteDay.WorkDate < end,
        )
        .all()
    )
    if not route_days:
        return 0, 0
    work_date_by_rd = {rd_id: work_date for rd_id, work_date in route_days}
    planned_route_day_ids = list(work_date_by_rd.keys())

    planned_pairs = (
        db.query(RouteDayPdv.RouteDayId, RouteDayPdv.PdvId)
        .filter(RouteDayPdv.RouteDayId.in_(planned_route_day_ids))
        .all()
    )
    denominator = len({pdv_id for _, pdv_id in planned_pairs})
    if denominator == 0:
        return 0, 0
    planned_set = {(rd_id, pdv_id) for rd_id, pdv_id in planned_pairs}

    # Visita propia del usuario (M1) atada a un RouteDay planificado Y abierta el
    # mismo día que ese RouteDay (M2) — una visita de otro usuario, o atada a un
    # RouteDay de otro día, no acredita como planificada (ver auditoría del motor).
    visits = (
        db.query(Visit)
        .filter(Visit.Status == "CLOSED", Visit.UserId == user_id, Visit.RouteDayId.in_(planned_route_day_ids))
        .all()
    )
    effective_pdvs = set()
    for v in visits:
        if v.PdvId in effective_pdvs or (v.RouteDayId, v.PdvId) not in planned_set:
            continue
        work_date = work_date_by_rd.get(v.RouteDayId)
        if work_date is None or v.OpenedAt.date() != work_date:
            continue
        has_cov = db.query(VisitCoverage).filter(VisitCoverage.VisitId == v.VisitId).first() is not None
        has_pop = db.query(VisitPOPItem).filter(VisitPOPItem.VisitId == v.VisitId).first() is not None
        has_action = db.query(VisitAction).filter(
            VisitAction.VisitId == v.VisitId, VisitAction.Status == "DONE"
        ).first() is not None
        if has_cov and has_pop and has_action:
            effective_pdvs.add(v.PdvId)

    return len(effective_pdvs), denominator


def _kpi3_sueltos(db: Session, user_id: int, universe: set, start: datetime, end: datetime) -> tuple[int, int]:
    if not universe:
        return 0, 0
    sells_loose_pdvs = {
        p.PdvId for p in
        db.query(PDV.PdvId).filter(PDV.PdvId.in_(universe), PDV.SellsLooseCigarettes == True)  # noqa: E712
    }
    denominator = len(sells_loose_pdvs)
    if denominator == 0:
        return 0, 0

    numerator = 0
    for pdv_id in sells_loose_pdvs:
        visit_ids = [
            v.VisitId for v in
            db.query(Visit.VisitId).filter(
                Visit.PdvId == pdv_id, Visit.UserId == user_id,
                Visit.OpenedAt >= start, Visit.OpenedAt < end,
            )
        ]
        if not visit_ids:
            continue
        has_canje = db.query(VisitAction).filter(
            VisitAction.VisitId.in_(visit_ids),
            VisitAction.ActionType == "canje_sueltos",
            VisitAction.Status == "DONE",
        ).first() is not None
        if has_canje:
            numerator += 1

    return numerator, denominator


def _kpi4_pop(db: Session, user_id: int, communication_scores: dict, universe: set, start: datetime, end: datetime) -> tuple[int, int]:
    numerator = 0
    for pdv_id in universe:
        if communication_scores.get(pdv_id) not in GOOD_OR_BETTER:
            continue
        if _has_pop_photo(db, user_id, pdv_id, start, end):
            numerator += 1
    return numerator, len(universe)


def _kpi5_promo(db: Session, user_id: int, universe: set, start: datetime, end: datetime) -> tuple[int, int]:
    if not universe:
        return 0, 0
    numerator = 0
    for pdv_id in universe:
        visit_ids = [
            v.VisitId for v in
            db.query(Visit.VisitId).filter(
                Visit.PdvId == pdv_id, Visit.UserId == user_id,
                Visit.OpenedAt >= start, Visit.OpenedAt < end,
            )
        ]
        if not visit_ids:
            continue
        has_promo = db.query(VisitAction).filter(
            VisitAction.VisitId.in_(visit_ids),
            VisitAction.ActionType == "promo",
            VisitAction.Status == "DONE",
        ).first() is not None
        if has_promo:
            numerator += 1
    return numerator, len(universe)


# ---------------------------------------------------------------------------
# compute_kpis — orquestador
# ---------------------------------------------------------------------------

def compute_kpis(db: Session, user_id: int, year: int, month: int) -> KpiResult:
    """Los 5 KPIs de la variable mensual (§3 del diseño), lógica binaria:
    `achieved = actual >= target`; `variable_total` = suma de pesos logrados.

    Mes cerrado con `KpiMonthlySnapshot` ya persistido -> se devuelve el
    snapshot tal cual (no se recalcula, aunque los datos crudos hayan
    cambiado). Sin snapshot (mes en curso, o mes cerrado que todavía no pasó
    por el cierre) -> cálculo en vivo; si es el mes en curso, `partial=True`
    con `day`/`days_in_month`.
    """
    days_in_month = calendar.monthrange(year, month)[1]
    is_current = _is_current_month(year, month)

    if not is_current:
        snapshot_rows = (
            db.query(KpiMonthlySnapshot, KpiDefinition)
            .join(KpiDefinition, KpiDefinition.KpiDefinitionId == KpiMonthlySnapshot.KpiDefinitionId)
            .filter(
                KpiMonthlySnapshot.UserId == user_id,
                KpiMonthlySnapshot.Year == year,
                KpiMonthlySnapshot.Month == month,
            )
            .all()
        )
        if snapshot_rows:
            kpis = [
                KpiResultItem(
                    key=d.KpiKey,
                    name=d.Name,
                    actual=float(s.Actual),
                    target=float(s.Target),
                    weight=s.Weight,
                    achieved=bool(s.Achieved),
                    numerator=s.Numerator,
                    denominator=s.Denominator,
                    scope_applied=s.ScopeApplied,
                )
                for s, d in snapshot_rows
            ]
            variable_total = sum(k.weight for k in kpis if k.achieved)
            return KpiResult(
                user_id=user_id, year=year, month=month, partial=False,
                day=days_in_month, days_in_month=days_in_month,
                kpis=kpis, variable_total=variable_total, config_warning=None,
            )

    configs, config_warning = resolve_config(db, user_id, year, month)
    universe = focus_universe(db, user_id, year, month)
    coverage_scores = pdv_coverage_scores(db, user_id, year, month)
    communication_scores = pdv_communication_scores(db, user_id, year, month)

    date_start, date_end = _month_range(year, month)
    dt_start, dt_end = _month_datetime_range(year, month)

    kpi_calcs = {
        "cobertura_skus": _kpi1_cobertura(coverage_scores, universe),
        "efectividad_visitas": _kpi2_efectividad(db, user_id, date_start, date_end),
        "penetracion_sueltos": _kpi3_sueltos(db, user_id, universe, dt_start, dt_end),
        "pop_colocado": _kpi4_pop(db, user_id, communication_scores, universe, dt_start, dt_end),
        "activaciones_promo": _kpi5_promo(db, user_id, universe, dt_start, dt_end),
    }

    kpis = []
    for cfg in configs:
        numerator, denominator = kpi_calcs.get(cfg.kpi_key, (0, 0))
        actual = _pct(numerator, denominator)
        achieved = actual >= cfg.target
        kpis.append(KpiResultItem(
            key=cfg.kpi_key, name=cfg.name, actual=actual, target=cfg.target,
            weight=cfg.weight, achieved=achieved, numerator=numerator,
            denominator=denominator, scope_applied=cfg.scope_applied,
        ))

    variable_total = sum(k.weight for k in kpis if k.achieved)
    day = date.today().day if is_current else days_in_month

    return KpiResult(
        user_id=user_id, year=year, month=month, partial=is_current,
        day=day, days_in_month=days_in_month, kpis=kpis,
        variable_total=variable_total, config_warning=config_warning,
    )


# ---------------------------------------------------------------------------
# Higiene de precios
# ---------------------------------------------------------------------------

def filter_price_outliers(prices: list) -> tuple[list, list]:
    """Descarta precios fuera de `[0.25x, 4x]` la mediana de su producto y
    excluye productos de prueba (`Name` empieza con `TEST_`).

    `prices`: lista de dicts con keys `price`, `pdv`, `user`, `date`, `product`
    (nombre del producto). Devuelve `(validos, descartados)`; los descartados
    conservan todos los campos originales (para el listado de "precios
    sospechosos" de fase 3).
    """
    by_product: dict = {}
    for row in prices:
        by_product.setdefault(row["product"], []).append(row["price"])
    medians = {product: median(values) for product, values in by_product.items()}

    valid, discarded = [], []
    for row in prices:
        product = row["product"]
        if product.startswith("TEST_"):
            discarded.append(row)
            continue
        med = medians[product]
        price = row["price"]
        if med > 0 and (price < 0.25 * med or price > 4 * med):
            discarded.append(row)
        else:
            valid.append(row)

    return valid, discarded
