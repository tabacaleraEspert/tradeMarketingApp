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
  `VisitAction(ActionType='pop', PhotoTaken=true)` **ejecutada**
  (`executed_action_condition()`, no solo `Status='DONE'` — hallazgo de
  producción 11-08-2026, ver docstring del helper) como fuente primaria (más
  simple de agregar) con `VisitPhoto.PhotoType LIKE 'pop%'` como OR de respaldo.
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
from datetime import date, datetime, timezone
from statistics import median
from typing import Optional
from zoneinfo import ZoneInfo

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

BUSINESS_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
"""Huso horario del negocio (UTC-3, sin horario de verano). El tablero define
"hoy" y los cortes de mes en esta hora, no en la del contenedor (UTC en prod) —
ver B2 de la auditoría del motor de KPIs: una visita de 21:00-23:59 hora
argentina del último día del mes cae, en UTC, en el día 1 del mes siguiente."""


def _business_today() -> date:
    """"Hoy" para el negocio (Argentina), no la del contenedor (UTC en prod)."""
    return datetime.now(BUSINESS_TZ).date()


def _to_business_date(opened_at: datetime) -> date:
    """Convierte un `OpenedAt` (naive, hora UTC — ver `Visit.OpenedAt` en
    Azure SQL) a la fecha de calendario de Argentina. Defensivo ante datetimes
    ya aware (se asumen UTC si no traen `tzinfo`)."""
    if opened_at.tzinfo is None:
        opened_at = opened_at.replace(tzinfo=timezone.utc)
    return opened_at.astimezone(BUSINESS_TZ).date()


def _is_current_month(year: int, month: int) -> bool:
    today = _business_today()
    return today.year == year and today.month == month


def _reference_date(year: int, month: int) -> date:
    """Fecha de vigencia a evaluar: hoy si es el mes en curso, si no el día 1."""
    return _business_today() if _is_current_month(year, month) else date(year, month, 1)


def _month_range(year: int, month: int) -> tuple[date, date]:
    """(primer día del mes, primer día del mes siguiente) — límite exclusivo.
    Fechas de calendario puras (sin hora ni huso horario): para columnas `date`
    como `RouteDay.WorkDate`, que no se convierten (ver B2 de la auditoría)."""
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def _month_datetime_range(year: int, month: int) -> tuple[datetime, datetime]:
    """(inicio, fin) del mes en hora de Argentina, convertido a UTC naive para
    comparar contra `Visit.OpenedAt` (guardado en UTC) — límite exclusivo. Ej.:
    agosto AR es `[01-ago 03:00 UTC, 01-sep 03:00 UTC)` (ver B2 de la auditoría
    del motor de KPIs). Único helper de rango de mes para OpenedAt — también lo
    usa `app/routers/kpi.py` (antes tenía su propia copia duplicada)."""
    start_date, end_date = _month_range(year, month)
    start_ar = datetime.combine(start_date, datetime.min.time(), tzinfo=BUSINESS_TZ)
    end_ar = datetime.combine(end_date, datetime.min.time(), tzinfo=BUSINESS_TZ)
    return (
        start_ar.astimezone(timezone.utc).replace(tzinfo=None),
        end_ar.astimezone(timezone.utc).replace(tzinfo=None),
    )


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


def _coverage_level(works_products: set, rules: dict, surveyed_products: set | None = None) -> str:
    """Nivel de rúbrica de un PDV a partir de los productos con `Works=true`.

    `surveyed_products` son los productos efectivamente RELEVADOS en el PDV (con
    `Works` true o false). Cuando se pasa, una marca cuyo censo no incluyó
    ningún SKU no se exige — ni suma ni resta. Sin ese dato el motor no puede
    distinguir "se preguntó y no lo trabaja" de "nunca se preguntó", y termina
    reprobando PDVs por productos que nadie relevó (hallazgo de producción
    13-08-2026: los SKUs de tabacos —Van Kiff, Lebonn— solo se relevan en ~1 de
    cada 3 PDVs, y la rúbrica exige `Total tabacos >= 1` ya en nivel 'regular',
    así que 162 de 174 PDVs de una cartera caían en `no_cuenta` por preguntas
    que el censo nunca hizo).

    `surveyed_products=None` mantiene el comportamiento histórico (se exigen
    todas las reglas), para los llamadores que no tienen el dato de relevamiento.
    """
    cigs_total = len({name for b in CIGS_BRANDS for name in _matched_sku_names(b, works_products)})
    tabacos_total = len({name for b in TABACOS_BRANDS for name in _matched_sku_names(b, works_products)})

    def _surveyed(brands) -> bool:
        """¿El censo de este PDV tocó alguna de estas marcas?"""
        if surveyed_products is None:
            return True
        return any(_matched_sku_names(b, surveyed_products) for b in brands)

    for level in reversed(LEVELS):  # excelente -> regular
        ok = True
        for brand in CIGS_BRANDS + TABACOS_BRANDS:
            min_skus = rules.get((brand, level))
            if min_skus is None or not _surveyed((brand,)):
                continue
            if len(_matched_sku_names(brand, works_products)) < min_skus:
                ok = False
                break
        if ok:
            min_cigs = rules.get(("Total cigs", level))
            if min_cigs is not None and _surveyed(CIGS_BRANDS) and cigs_total < min_cigs:
                ok = False
            min_tabacos = rules.get(("Total tabacos", level))
            if ok and min_tabacos is not None and _surveyed(TABACOS_BRANDS) and tabacos_total < min_tabacos:
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

    # 1 query agregada para todo el universo (antes: 1 query por PDV, N+1) — mismo
    # join/filtro de antes, solo que con `PdvId.in_(universe)` en vez de `== pdv_id`.
    cov_rows = (
        db.query(Visit.PdvId, VisitCoverage, Product, Visit.OpenedAt)
        .join(Visit, Visit.VisitId == VisitCoverage.VisitId)
        .join(Product, Product.ProductId == VisitCoverage.ProductId)
        .filter(
            Visit.PdvId.in_(universe),
            Visit.UserId == user_id,
            Visit.OpenedAt >= start,
            Visit.OpenedAt < end,
        )
        .all()
    )

    pdvs_with_data: set = set()
    latest_by_pdv_product: dict = {}
    for pdv_id, cov, product, opened_at in cov_rows:
        pdvs_with_data.add(pdv_id)
        key = (pdv_id, product.ProductId)
        current = latest_by_pdv_product.get(key)
        if current is None or opened_at > current[0]:
            latest_by_pdv_product[key] = (opened_at, cov.Works, product.Name)

    works_products_by_pdv: dict = {}
    surveyed_products_by_pdv: dict = {}
    for (pdv_id, _product_id), (_opened_at, works, name) in latest_by_pdv_product.items():
        surveyed_products_by_pdv.setdefault(pdv_id, set()).add(name)
        if works:
            works_products_by_pdv.setdefault(pdv_id, set()).add(name)

    result = {}
    for pdv_id in universe:
        if pdv_id not in pdvs_with_data:
            result[pdv_id] = "sin_relevar"
            continue
        works_products = works_products_by_pdv.get(pdv_id, set())
        result[pdv_id] = _coverage_level(
            works_products, rules, surveyed_products_by_pdv.get(pdv_id, set())
        )

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

    # 1 query agregada para todo el universo (antes: 1 query por PDV, N+1) — mismo
    # join/filtro de antes, solo que con `PdvId.in_(universe)` en vez de `== pdv_id`.
    pop_rows = (
        db.query(Visit.PdvId, VisitPOPItem, Visit.OpenedAt)
        .join(Visit, Visit.VisitId == VisitPOPItem.VisitId)
        .filter(
            Visit.PdvId.in_(universe),
            Visit.UserId == user_id,
            Visit.OpenedAt >= start,
            Visit.OpenedAt < end,
        )
        .all()
    )

    pdvs_with_data: set = set()
    latest_by_pdv_material: dict = {}
    for pdv_id, item, opened_at in pop_rows:
        pdvs_with_data.add(pdv_id)
        key = (pdv_id, item.MaterialName)
        current = latest_by_pdv_material.get(key)
        if current is None or opened_at > current[0]:
            latest_by_pdv_material[key] = (opened_at, item.Present)

    present_count_by_pdv: dict = {}
    for (pdv_id, _material_name), (_opened_at, present) in latest_by_pdv_material.items():
        if present:
            present_count_by_pdv[pdv_id] = present_count_by_pdv.get(pdv_id, 0) + 1

    result = {}
    for pdv_id in universe:
        if pdv_id not in pdvs_with_data:
            result[pdv_id] = "sin_relevar"
            continue

        count = present_count_by_pdv.get(pdv_id, 0)
        level = "no_cuenta"
        for lvl in reversed(LEVELS):
            min_elements = rules.get(("total", lvl))
            if min_elements is not None and count >= min_elements:
                level = lvl
                break
        result[pdv_id] = level

    return result


# ---------------------------------------------------------------------------
# Acción "ejecutada" — criterio centralizado (hallazgo de producción, 11-08-2026)
# ---------------------------------------------------------------------------

def executed_action_condition():
    """Condición SQLAlchemy para "acción ejecutada": NO es `VisitAction.Status ==
    'DONE'` a secas, pese a que ese fue el criterio original del motor.

    Hallazgo de producción (11-08-2026): la app mobile registra las acciones que
    el vendedor marca como realizadas ("Acciones realizadas" en
    VisitActionsPage → `POST /visits/{id}/actions`, ver
    `app/routers/visit_actions.py`) SIN `Status` explícito, así que quedaban en
    el default del modelo, `PENDING` (`VisitAction.Status`). Nada en el sistema
    las pasaba a `DONE` después (2 filas `DONE` en toda la historia de
    producción contra 3.731 `PENDING`): el motor, que exigía `Status == 'DONE'`,
    daba 0 en 3 de los 5 KPIs con datos reales abundantes.

    Semántica real de los datos (verificada contra producción):
    - `MandatoryActivityId IS NOT NULL`: TODO auto-sembrado desde una plantilla
      de actividad obligatoria (`app/routers/visits.py`, al abrir la visita y en
      el carry-over de BACKLOG — líneas ~503-514 y ~558-568). Ahí `PENDING`
      significa lo que dice, "pendiente de hacer": NO cuenta como ejecutada.
    - `MandatoryActivityId IS NULL`: la crea el vendedor al registrar una acción
      que YA REALIZÓ (`POST /visits/{id}/actions`) -> cuenta como ejecutada
      aunque su `Status` no sea `DONE` (con este mismo fix ese POST además crea
      la fila con `Status='DONE'` explícito desde ahora, pero esta condición
      sigue cubriendo el historial viejo, todo en `PENDING`).
    - `Status == 'BACKLOG'`: pospuesta explícitamente (carry-over a la próxima
      visita al PDV) -> nunca cuenta, ni siquiera si es ad-hoc.
    - `Status == 'DONE'`: siempre cuenta, sea ad-hoc o de plantilla.

    Devuelve la expresión para usar en `.filter(...)`; no ejecuta ninguna query.
    Único lugar donde se define el criterio — usado por `effective_visit_ids`,
    `_kpi3_sueltos`, `_kpi4_pop` y `_kpi5_promo` (motor) y por
    `app/routers/kpi.py` (`/kpi/route-summary`)."""
    return or_(
        and_(VisitAction.MandatoryActivityId.is_(None), VisitAction.Status != "BACKLOG"),
        VisitAction.Status == "DONE",
    )


# ---------------------------------------------------------------------------
# Numeradores/denominadores por KPI (tabla §3 del diseño)
# ---------------------------------------------------------------------------

def _kpi1_cobertura(coverage_scores: dict, universe: set) -> tuple[int, int]:
    numerator = sum(1 for pdv_id in universe if coverage_scores.get(pdv_id) in GOOD_OR_BETTER)
    return numerator, len(universe)


def effective_visit_ids(
    db: Session, user_id: int, year: int, month: int, *, require_planned_day: bool
) -> set:
    """`VisitId` de las visitas "efectivas" del usuario en el mes — única definición
    de visita efectiva del tablero TMR (antes triplicada e inconsistente entre KPI 2,
    `/kpi/route-summary` y `/kpi/weekly-activity`, ver A3 de la auditoría del
    tablero TMR).

    SIEMPRE se exige sobre la visita: `Status='CLOSED'` + cobertura relevada
    (`VisitCoverage`) + relevamiento POP (`VisitPOPItem`) + al menos una
    `VisitAction` ejecutada (`executed_action_condition()` — ya NO
    `Status='DONE'` a secas, ver docstring de ese helper).

    `require_planned_day`:
    - `True` (el criterio que PAGA — KPI 2 y, desde A3, `/kpi/route-summary`): la
      visita debe estar atada a un `RouteDay` de una ruta foco activa asignada a
      `user_id`, ese `RouteDay` debe tener planificado ese mismo PDV
      (`RouteDayPdv`), y `OpenedAt` (convertido a fecha de Argentina, ver
      `_to_business_date`) debe coincidir con el `WorkDate` de ese `RouteDay` — una
      visita de otro usuario, o atada a un RouteDay de otro día, no acredita como
      planificada (M1/M2 de la auditoría del motor de KPIs).
    - `False` (`/kpi/weekly-activity`): cualquier visita del usuario en el mes,
      planificada o no.
    """
    if not require_planned_day:
        dt_start, dt_end = _month_datetime_range(year, month)
        candidates = (
            db.query(Visit)
            .filter(
                Visit.Status == "CLOSED", Visit.UserId == user_id,
                Visit.OpenedAt >= dt_start, Visit.OpenedAt < dt_end,
            )
            .all()
        )
    else:
        start, end = _month_range(year, month)
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
            return set()
        work_date_by_rd = {rd_id: work_date for rd_id, work_date in route_days}
        planned_route_day_ids = list(work_date_by_rd.keys())

        planned_pairs = (
            db.query(RouteDayPdv.RouteDayId, RouteDayPdv.PdvId)
            .filter(RouteDayPdv.RouteDayId.in_(planned_route_day_ids))
            .all()
        )
        planned_set = {(rd_id, pdv_id) for rd_id, pdv_id in planned_pairs}

        # El "mismo día" se evalúa en fecha de Argentina (OpenedAt está en UTC; una
        # visita de las 23:00 AR cae en el día UTC siguiente — ver B2 de la auditoría).
        all_on_planned_days = (
            db.query(Visit)
            .filter(Visit.Status == "CLOSED", Visit.UserId == user_id, Visit.RouteDayId.in_(planned_route_day_ids))
            .all()
        )
        candidates = []
        for v in all_on_planned_days:
            if (v.RouteDayId, v.PdvId) not in planned_set:
                continue
            work_date = work_date_by_rd.get(v.RouteDayId)
            if work_date is None or _to_business_date(v.OpenedAt) != work_date:
                continue
            candidates.append(v)

    if not candidates:
        return set()

    # 3 queries agregadas sobre TODOS los candidatos (antes: 3 queries por visita,
    # N+1) — mismas 3 condiciones de contenido, evaluadas con IN en vez de por visita.
    candidate_ids = [v.VisitId for v in candidates]
    cov_ids = {
        vid for (vid,) in
        db.query(VisitCoverage.VisitId).filter(VisitCoverage.VisitId.in_(candidate_ids)).distinct()
    }
    pop_ids = {
        vid for (vid,) in
        db.query(VisitPOPItem.VisitId).filter(VisitPOPItem.VisitId.in_(candidate_ids)).distinct()
    }
    action_ids = {
        vid for (vid,) in
        db.query(VisitAction.VisitId)
        .filter(VisitAction.VisitId.in_(candidate_ids), executed_action_condition())
        .distinct()
    }
    return {
        v.VisitId for v in candidates
        if v.VisitId in cov_ids and v.VisitId in pop_ids and v.VisitId in action_ids
    }


def _kpi2_efectividad(db: Session, user_id: int, year: int, month: int) -> tuple[int, int]:
    start, end = _month_range(year, month)
    route_day_ids = [
        rd_id for (rd_id,) in
        db.query(RouteDay.RouteDayId)
        .join(Route, Route.RouteId == RouteDay.RouteId)
        .filter(
            Route.IsFocus == True, Route.IsActive == True, Route.AssignedUserId == user_id,  # noqa: E712
            RouteDay.WorkDate >= start, RouteDay.WorkDate < end,
        )
        .all()
    ]
    if not route_day_ids:
        return 0, 0

    planned_pairs = (
        db.query(RouteDayPdv.RouteDayId, RouteDayPdv.PdvId)
        .filter(RouteDayPdv.RouteDayId.in_(route_day_ids))
        .all()
    )
    denominator = len({pdv_id for _, pdv_id in planned_pairs})
    if denominator == 0:
        return 0, 0

    effective_ids = effective_visit_ids(db, user_id, year, month, require_planned_day=True)
    if not effective_ids:
        return 0, denominator

    effective_pdvs = {
        pdv_id for (pdv_id,) in db.query(Visit.PdvId).filter(Visit.VisitId.in_(effective_ids)).all()
    }
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

    # 1 query agregada (antes: 1-2 queries por PDV, N+1): PDVs distintos de
    # `sells_loose_pdvs` con al menos una visita del usuario en el mes con canje
    # ejecutado (executed_action_condition() — ya NO Status='DONE' a secas).
    pdvs_with_canje = {
        pdv_id for (pdv_id,) in
        db.query(Visit.PdvId)
        .join(VisitAction, VisitAction.VisitId == Visit.VisitId)
        .filter(
            Visit.PdvId.in_(sells_loose_pdvs), Visit.UserId == user_id,
            Visit.OpenedAt >= start, Visit.OpenedAt < end,
            VisitAction.ActionType == "canje_sueltos", executed_action_condition(),
        )
        .distinct()
    }
    numerator = len(pdvs_with_canje)

    return numerator, denominator


def _kpi4_pop(db: Session, user_id: int, communication_scores: dict, universe: set, start: datetime, end: datetime) -> tuple[int, int]:
    """PDVs del universo con nivel de comunicación bueno+ Y foto POP tomada en el
    mes (requisito excluyente del KPI 4).

    Foto POP: fuente primaria `VisitAction(ActionType='pop', PhotoTaken=true)`
    **ejecutada** (`executed_action_condition()`, ya NO `Status='DONE'` a secas
    — ver docstring de ese helper; lo que escribe VisitActionsPage.tsx), OR de
    respaldo `VisitPhoto` con `PhotoType` que empieza con `'pop'`
    (POPCensusPage.tsx usa `pop_<material>_<empresa>`, no el literal `'pop'`) —
    ver nota de módulo.

    2-3 queries agregadas sobre el universo elegible (antes: hasta 3 queries por
    PDV elegible, N+1).
    """
    eligible = {pdv_id for pdv_id in universe if communication_scores.get(pdv_id) in GOOD_OR_BETTER}
    if not eligible:
        return 0, len(universe)

    visit_rows = (
        db.query(Visit.VisitId, Visit.PdvId)
        .filter(
            Visit.PdvId.in_(eligible), Visit.UserId == user_id,
            Visit.OpenedAt >= start, Visit.OpenedAt < end,
        )
        .all()
    )
    if not visit_rows:
        return 0, len(universe)

    pdv_by_visit = {visit_id: pdv_id for visit_id, pdv_id in visit_rows}
    visit_ids = list(pdv_by_visit.keys())

    action_photo_ids = {
        vid for (vid,) in
        db.query(VisitAction.VisitId)
        .filter(
            VisitAction.VisitId.in_(visit_ids),
            VisitAction.ActionType == "pop",
            executed_action_condition(),
            VisitAction.PhotoTaken == True,  # noqa: E712
        )
        .distinct()
    }
    photo_type_ids = {
        vid for (vid,) in
        db.query(VisitPhoto.VisitId)
        .filter(VisitPhoto.VisitId.in_(visit_ids), VisitPhoto.PhotoType.like("pop%"))
        .distinct()
    }

    pdvs_with_photo = {pdv_by_visit[vid] for vid in (action_photo_ids | photo_type_ids)}
    return len(pdvs_with_photo), len(universe)


def _kpi5_promo(db: Session, user_id: int, universe: set, start: datetime, end: datetime) -> tuple[int, int]:
    if not universe:
        return 0, 0
    # 1 query agregada (antes: 1-2 queries por PDV, N+1): PDVs distintos del
    # universo con al menos una visita del usuario en el mes con promo ejecutada
    # (executed_action_condition() — ya NO Status='DONE' a secas).
    pdvs_with_promo = {
        pdv_id for (pdv_id,) in
        db.query(Visit.PdvId)
        .join(VisitAction, VisitAction.VisitId == Visit.VisitId)
        .filter(
            Visit.PdvId.in_(universe), Visit.UserId == user_id,
            Visit.OpenedAt >= start, Visit.OpenedAt < end,
            VisitAction.ActionType == "promo", executed_action_condition(),
        )
        .distinct()
    }
    return len(pdvs_with_promo), len(universe)


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

    dt_start, dt_end = _month_datetime_range(year, month)

    kpi_calcs = {
        "cobertura_skus": _kpi1_cobertura(coverage_scores, universe),
        "efectividad_visitas": _kpi2_efectividad(db, user_id, year, month),
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
    day = _business_today().day if is_current else days_in_month

    return KpiResult(
        user_id=user_id, year=year, month=month, partial=is_current,
        day=day, days_in_month=days_in_month, kpis=kpis,
        variable_total=variable_total, config_warning=config_warning,
    )


# ---------------------------------------------------------------------------
# Higiene de precios
# ---------------------------------------------------------------------------

MIN_PRICE_SAMPLES = 3
"""Mínimo de precios de un producto para que la regla de mediana sea confiable.
Con n<3 la mediana puede coincidir con uno de los dos únicos valores (o directamente
ser un extremo), volviendo la regla `[0.25x, 4x]` degenerada: p.ej. con precios
[2100, 21000] la mediana es 11550 y descarta el precio legítimo (2100) mientras
acepta el outlier (21000). Por eso, por debajo de este umbral no hay evidencia
suficiente para juzgar y no se descarta ningún precio del producto."""


def filter_price_outliers(prices: list) -> tuple[list, list]:
    """Descarta precios fuera de `[0.25x, 4x]` la mediana de su producto y
    excluye productos de prueba (`Name` empieza con `TEST_`).

    Si un producto tiene menos de `MIN_PRICE_SAMPLES` precios en la muestra, no se
    le aplica la regla de mediana (se conservan todos sus precios sin marcar
    ninguno como sospechoso) — ver docstring de `MIN_PRICE_SAMPLES`.

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
        if len(by_product[product]) < MIN_PRICE_SAMPLES:
            valid.append(row)
            continue
        med = medians[product]
        price = row["price"]
        if med > 0 and (price < 0.25 * med or price > 4 * med):
            discarded.append(row)
        else:
            valid.append(row)

    return valid, discarded
