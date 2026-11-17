"""Vista gerencial de Inteligencia: Universo y Performance de equipo.

    GET /intelligence/gerencial/filters
    GET /intelligence/gerencial/universo
    GET /intelligence/gerencial/equipo

Filtros comunes: meses (selección múltiple, pueden no ser contiguos), área
(zona) y TM Rep.

**Embudo de PDVs** (definición del negocio, 17-11-2026) — acumulado:

    Rastrillado   PDVs activos.
    En ruta foco  Rastrillados que pertenecen a una ruta foco vigente.
    Visitados     En ruta foco con al menos una visita CERRADA en el período.
    Efectivos     Visitados cuyo censo del mes llega a Regular o más en
                  cobertura Y en comunicación (POP). No exige acciones.

"Efectivo" acá NO es la "visita efectiva" del variable (`kpi_engine.
effective_visit_ids`, que además pide acción ejecutada y día planificado): es
una lectura gerencial del estado del PDV y no toca lo que cobra el vendedor.
Usa la misma rúbrica configurable (`ScoringCoverageRule` /
`ScoringCommunicationRule`) y la misma consolidación mensual del Tablero TMR:
por cada producto o material manda la visita más reciente del mes.

Dos decisiones de atribución, para que las solapas den el mismo número:

- El estado se calcula **por PDV**, con las visitas de cualquier usuario. Si la
  cartera cambió de manos en el período, el PDV no "pierde" sus visitas.
- Las reglas se resuelven para el **dueño actual** del PDV: el asignado de su
  ruta foco y, si no tiene, `PDV.AssignedUserId`.

Diferencia deliberada con el Tablero TMR: un PDV al que en el mes no se le
relevó ningún producto de las marcas de la rúbrica acá NO llega a Regular. El
motor (`_coverage_level`) no le exige nada a una marca no relevada, así que a
ese PDV lo califica "excelente"; para un embudo de efectividad eso sería contar
como efectivo un censo que no tocó Espert.

Filtros: con TM Rep elegido manda el rep y la zona se ignora (sus rutas pueden
cruzar zonas). Solo con zona, Universo corta por la zona del PDV y Equipo por la
zona del rep.

Costo: el período se resuelve con un solo `OR` de ventanas de mes por query, no
una pasada por mes. Lo único pesado son las filas de cobertura (acotadas a las
marcas de la rúbrica) y de POP del período: por eso `load_shared` (cartera +
estado por PDV) se cachea en el router por combinación de meses, y los filtros
de zona / rep se aplican en memoria sin volver a la base.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import and_, case, false, func, or_
from sqlalchemy.orm import Session

from ..models import (
    PDV,
    Holiday,
    Product,
    Role,
    Route,
    RouteDay,
    RouteDayPdv,
    RoutePdv,
    ScoringCommunicationRule,
    ScoringCoverageRule,
    User,
    UserRole,
    Visit,
    VisitAction,
    VisitCheck,
    VisitCoverage,
    VisitPhoto,
    VisitPOPItem,
    Zone,
)
from ..models.route import route_is_live
from . import kpi_engine as E
from .coverage_semantics import get_coverage_cutoff
from .pop_materials import espert_only_applies, is_espert_pop
from .tmr_dashboard import _known_coverage_sql
from .user_activity import count_user_activity

MAX_MONTHS = 6
MIN_YEAR, MAX_YEAR = 2020, 2100
MONTH_ABBR = ("Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic")
RUBRIC_BRANDS = E.CIGS_BRANDS + E.TABACOS_BRANDS
OK_LEVELS = frozenset(E.LEVELS)  # regular o más
SIN_ZONA = "Sin zona"

Month = tuple[int, int]


# ---------------------------------------------------------------------------
# Período
# ---------------------------------------------------------------------------

def parse_months(raw: Optional[str]) -> list[Month]:
    """`"2026-09,2026-11"` -> `[(2026, 9), (2026, 11)]`, ordenado y sin repetidos.
    Vacío = últimos 3 meses. Levanta `ValueError` con mensaje para el usuario."""
    if not raw or not raw.strip():
        return last_months(3)
    months: set[Month] = set()
    for part in raw.split(","):
        part = part.strip()
        try:
            year_s, month_s = part.split("-")
            year, month = int(year_s), int(month_s)
            date(year, month, 1)
            if not MIN_YEAR <= year <= MAX_YEAR:
                raise ValueError
        except ValueError:
            raise ValueError(f"Mes inválido: '{part}'. Formato esperado: AAAA-MM")
        months.add((year, month))
    if len(months) > MAX_MONTHS:
        raise ValueError(f"Se pueden elegir hasta {MAX_MONTHS} meses")
    return sorted(months)


def last_months(n: int) -> list[Month]:
    today = E._business_today()
    year, month = today.year, today.month
    out = []
    for _ in range(n):
        out.append((year, month))
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    return sorted(out)


def month_key(m: Month) -> str:
    return f"{m[0]:04d}-{m[1]:02d}"


def months_label(months: list[Month]) -> str:
    years = {y for y, _ in months}
    if len(years) == 1:
        return ", ".join(MONTH_ABBR[m - 1] for _, m in months)
    return ", ".join(f"{MONTH_ABBR[m - 1]} {y}" for y, m in months)


def _in_months_dt(col, months: list[Month]):
    """Filtro de `Visit.OpenedAt` (UTC) por las ventanas de mes en hora argentina."""
    return or_(*[
        and_(col >= start, col < end)
        for start, end in (E._month_datetime_range(y, m) for y, m in months)
    ])


def _in_months_date(col, months: list[Month]):
    """Filtro de una columna `date` (p.ej. `RouteDay.WorkDate`)."""
    return or_(*[
        and_(col >= start, col < end)
        for start, end in (E._month_range(y, m) for y, m in months)
    ])


def _month_of(opened_at: datetime) -> Month:
    d = E._to_business_date(opened_at)
    return (d.year, d.month)


def business_days(db: Session, months: list[Month]) -> int:
    """Días hábiles del período: lunes a viernes menos los feriados activos
    cargados, y hasta hoy inclusive si el mes está en curso."""
    today = E._business_today()
    holidays = {
        d for (d,) in db.query(Holiday.Date)
        .filter(Holiday.IsActive == True, _in_months_date(Holiday.Date, months))  # noqa: E712
        .all()
    }
    total = 0
    for year, month in months:
        day, end = E._month_range(year, month)
        end = min(end, today + timedelta(days=1))
        while day < end:
            if day.weekday() < 5 and day not in holidays:
                total += 1
            day += timedelta(days=1)
    return total


# ---------------------------------------------------------------------------
# Helpers numéricos
# ---------------------------------------------------------------------------

def _pct(num: float, den: float) -> Optional[float]:
    return round(100.0 * num / den, 1) if den else None


def _ratio(num: float, den: float, digits: int = 1) -> Optional[float]:
    return round(num / den, digits) if den else None


def _mean(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 1) if values else None


# ---------------------------------------------------------------------------
# Base compartida: cartera, rutas foco y nómina
# ---------------------------------------------------------------------------

class Base:
    """Lo que Universo y Equipo comparten y no depende del período."""

    def __init__(self, db: Session):
        self.zone_names: dict[int, str] = {z.ZoneId: z.Name for z in db.query(Zone).all()}

        # PDVs activos (Rastrillado): zona y dueño de cartera.
        self.pdv_zone: dict[int, Optional[int]] = {}
        self.pdv_assigned: dict[int, Optional[int]] = {}
        for pdv_id, zone_id, assigned in (
            db.query(PDV.PdvId, PDV.ZoneId, PDV.AssignedUserId)
            .filter(PDV.IsActive == True)  # noqa: E712
            .all()
        ):
            self.pdv_zone[pdv_id] = zone_id
            self.pdv_assigned[pdv_id] = assigned

        # Rutas foco vigentes y sus PDVs activos.
        self.route_user: dict[int, Optional[int]] = {}
        self.route_zone_raw: dict[int, Optional[int]] = {}
        for route_id, user_id, zone_id in (
            db.query(Route.RouteId, Route.AssignedUserId, Route.ZoneId)
            .filter(Route.IsFocus == True, route_is_live())  # noqa: E712
            .all()
        ):
            self.route_user[route_id] = user_id
            self.route_zone_raw[route_id] = zone_id

        # pdv -> dueño de su ruta foco (la de menor RouteId si está en varias,
        # para que el resultado sea estable entre requests).
        self.focus_owner: dict[int, Optional[int]] = {}
        self.focus_routes_of_pdv: dict[int, set[int]] = defaultdict(set)
        # Una ruta foco sin PDVs activos no cuenta como ruta armada.
        self.routes_with_pdvs: set[int] = set()
        for route_id, pdv_id in (
            db.query(RoutePdv.RouteId, RoutePdv.PdvId)
            .join(Route, Route.RouteId == RoutePdv.RouteId)
            .filter(Route.IsFocus == True, route_is_live())  # noqa: E712
            .order_by(RoutePdv.RouteId)
            .all()
        ):
            if pdv_id not in self.pdv_zone:  # PDV inactivo
                continue
            self.focus_routes_of_pdv[pdv_id].add(route_id)
            self.routes_with_pdvs.add(route_id)
            self.focus_owner.setdefault(pdv_id, self.route_user.get(route_id))

        # Usuarios: nombre, zona y nómina de TM Reps (rol vendedor, activos).
        self.user_name: dict[int, str] = {}
        self.user_zone: dict[int, Optional[int]] = {}
        for user_id, name, zone_id in db.query(User.UserId, User.DisplayName, User.ZoneId).all():
            self.user_name[user_id] = name
            self.user_zone[user_id] = zone_id
        self.nomina: set[int] = {
            uid for (uid,) in (
                db.query(UserRole.UserId)
                .join(Role, Role.RoleId == UserRole.RoleId)
                .join(User, User.UserId == UserRole.UserId)
                .filter(Role.Name == "vendedor", User.IsActive == True)  # noqa: E712
                .all()
            )
        }

    def route_zone(self, route_id: int) -> Optional[int]:
        """Zona de la ruta; si no la tiene cargada, la de su vendedor."""
        zone_id = self.route_zone_raw.get(route_id)
        if zone_id is None:
            zone_id = self.user_zone.get(self.route_user.get(route_id))
        return zone_id

    def focus_owners(self, pdv_id: int) -> set[int]:
        """Todos los vendedores con el PDV en una ruta foco vigente."""
        return {
            uid for uid in (self.route_user.get(r) for r in self.focus_routes_of_pdv.get(pdv_id, ()))
            if uid is not None
        }

    def rule_user(self, pdv_id: int) -> Optional[int]:
        """Dueño actual del PDV, para resolver las reglas de scoring."""
        owner = self.focus_owner.get(pdv_id)
        return owner if owner is not None else self.pdv_assigned.get(pdv_id)

    def zone_label(self, zone_id: Optional[int]) -> str:
        return self.zone_names.get(zone_id, SIN_ZONA) if zone_id is not None else SIN_ZONA

    def rep_ids(self) -> set[int]:
        """Nómina + cualquiera con una ruta foco vigente a su nombre."""
        return self.nomina | {uid for uid in self.route_user.values() if uid is not None}


# ---------------------------------------------------------------------------
# Estado de cada PDV en el período — única definición del embudo
# ---------------------------------------------------------------------------

class PdvStatus:
    """Por PDV y mes: si tuvo visita cerrada, y si su cobertura / comunicación
    llegan a Regular o más."""

    def __init__(self):
        self.visited: dict[int, set[Month]] = defaultdict(set)  # visita CERRADA
        self.cov_ok: dict[int, set[Month]] = defaultdict(set)
        self.pop_ok: dict[int, set[Month]] = defaultdict(set)

    def is_visited(self, pdv_id: int) -> bool:
        return bool(self.visited.get(pdv_id))

    def effective_months(self, pdv_id: int) -> set[Month]:
        return (
            self.visited.get(pdv_id, set())
            & self.cov_ok.get(pdv_id, set())
            & self.pop_ok.get(pdv_id, set())
        )

    def is_effective(self, pdv_id: int) -> bool:
        return bool(self.effective_months(pdv_id))


def _rules_by_month(db: Session, model, months: list[Month]) -> dict[Month, list]:
    """Filas de regla vigentes en la fecha de referencia de cada mes. Una query
    por mes (son tablas de decenas de filas)."""
    return {
        m: db.query(model).filter(E._vigente_filter(model, E._reference_date(*m))).all()
        for m in months
    }


def load_pdv_status(db: Session, base: Base, months: list[Month]) -> PdvStatus:
    st = PdvStatus()

    # ── Visitas cerradas ───────────────────────────────────────────────────
    for pdv_id, opened_at in (
        db.query(Visit.PdvId, Visit.OpenedAt)
        .filter(Visit.Status == "CLOSED", _in_months_dt(Visit.OpenedAt, months))
        .all()
    ):
        st.visited[pdv_id].add(_month_of(opened_at))

    # ── Cobertura: último dato del mes por (PDV, producto) ─────────────────
    # Agregado en SQL: una fila por PDV con, por marca de la rúbrica, cuántos
    # SKUs tienen dato y cuántos trabaja. Traer las filas crudas a Python eran
    # ~100 mil por trimestre y dominaba el tiempo del request contra Azure SQL.
    # Solo las marcas de la rúbrica: el resto del catálogo no mueve el nivel. Un
    # PDV al que no se le relevó ninguna de esas marcas no llega a Regular.
    ids_by_brand: dict[str, list[int]] = {brand: [] for brand in RUBRIC_BRANDS}
    for product_id, name in db.query(Product.ProductId, Product.Name).all():
        for brand in RUBRIC_BRANDS:
            if name.startswith(brand):
                ids_by_brand[brand].append(product_id)
    rubric_ids = [pid for ids in ids_by_brand.values() for pid in ids]

    cutoff = get_coverage_cutoff(db)
    seen: dict[tuple[int, Month], set[str]] = {}
    works_set: dict[tuple[int, Month], set[str]] = {}
    if rubric_ids:
        # Todos los meses en una sola pasada: el mes entra a la partición como
        # índice, calculado con las mismas ventanas en hora argentina.
        month_idx = case(
            *[
                (and_(Visit.OpenedAt >= start, Visit.OpenedAt < end), i)
                for i, (start, end) in enumerate(E._month_datetime_range(y, m) for y, m in months)
            ],
            else_=-1,
        )
        ranked = (
            db.query(
                Visit.PdvId.label("pdv_id"),
                month_idx.label("month_idx"),
                VisitCoverage.ProductId.label("product_id"),
                VisitCoverage.Works.label("works"),
                func.row_number().over(
                    partition_by=(Visit.PdvId, month_idx, VisitCoverage.ProductId),
                    order_by=(Visit.OpenedAt.desc(), VisitCoverage.VisitId.desc()),
                ).label("rn"),
            )
            .join(Visit, Visit.VisitId == VisitCoverage.VisitId)
            .filter(
                _in_months_dt(Visit.OpenedAt, months),
                VisitCoverage.ProductId.in_(rubric_ids),
                _known_coverage_sql(cutoff),  # filas sin dato fuera ANTES de elegir la última
            )
            .subquery()
        )
        columns = []
        for brand in RUBRIC_BRANDS:
            in_brand = ranked.c.product_id.in_(ids_by_brand[brand]) if ids_by_brand[brand] else false()
            columns.append(func.sum(case((in_brand, 1), else_=0)))
            columns.append(func.sum(case((and_(in_brand, ranked.c.works == True), 1), else_=0)))  # noqa: E712
        for row in (
            db.query(ranked.c.pdv_id, ranked.c.month_idx, *columns)
            .filter(ranked.c.rn == 1)
            .group_by(ranked.c.pdv_id, ranked.c.month_idx)
            .all()
        ):
            # `_coverage_level` trabaja con conjuntos de nombres y solo mira el
            # prefijo de marca: se le arman nombres sintéticos con los conteos.
            pdv_id, month, counts = row[0], months[row[1]], row[2:]
            surveyed, works = set(), set()
            for i, brand in enumerate(RUBRIC_BRANDS):
                n_seen, n_works = int(counts[2 * i] or 0), int(counts[2 * i + 1] or 0)
                surveyed.update(f"{brand} #{k}" for k in range(n_seen))
                works.update(f"{brand} #{k}" for k in range(n_works))
            seen[(pdv_id, month)] = surveyed
            works_set[(pdv_id, month)] = works

    cov_rule_rows = _rules_by_month(db, ScoringCoverageRule, months)
    cov_rules_cache: dict[tuple[Month, Optional[int]], dict] = {}
    for (pdv_id, month), surveyed in seen.items():
        uid = base.rule_user(pdv_id)
        rules = cov_rules_cache.get((month, uid))
        if rules is None:
            rules = {
                key: r.MinSkus
                for key, r in E._resolve_rows(
                    cov_rule_rows[month], uid, base.user_zone.get(uid),
                    lambda r: (r.Brand, r.Level),
                ).items()
            }
            cov_rules_cache[(month, uid)] = rules
        if E._coverage_level(works_set.get((pdv_id, month), set()), rules, surveyed) in OK_LEVELS:
            st.cov_ok[pdv_id].add(month)

    # ── Comunicación: materiales presentes, último dato del mes ────────────
    # Misma lógica que `kpi_engine.pdv_communication_scores`, para todo el país.
    latest_pop: dict[tuple[int, Month, str], tuple[datetime, bool]] = {}
    for pdv_id, opened_at, company, code, name, present in (
        db.query(
            Visit.PdvId, Visit.OpenedAt, VisitPOPItem.Company, VisitPOPItem.MaterialCode,
            VisitPOPItem.MaterialName, VisitPOPItem.Present,
        )
        .join(Visit, Visit.VisitId == VisitPOPItem.VisitId)
        .filter(_in_months_dt(Visit.OpenedAt, months))
        .all()
    ):
        month = _month_of(opened_at)
        if espert_only_applies(*month) and not is_espert_pop(company, code):
            continue
        key = (pdv_id, month, code or name)
        prev = latest_pop.get(key)
        if prev is None or opened_at > prev[0]:
            latest_pop[key] = (opened_at, bool(present))

    present_count: dict[tuple[int, Month], int] = defaultdict(int)
    for (pdv_id, month, _material), (_at, present) in latest_pop.items():
        if present:
            present_count[(pdv_id, month)] += 1

    pop_rule_rows = _rules_by_month(db, ScoringCommunicationRule, months)
    min_regular_cache: dict[tuple[Month, Optional[int]], Optional[int]] = {}
    for (pdv_id, month), count in present_count.items():
        uid = base.rule_user(pdv_id)
        cache_key = (month, uid)
        if cache_key not in min_regular_cache:
            resolved = E._resolve_rows(
                pop_rule_rows[month], uid, base.user_zone.get(uid),
                lambda r: (r.MaterialType, r.Level),
            )
            # "Regular o más" = alcanzar el mínimo del nivel más bajo configurado.
            mins = [
                r.MinElements for (material, _lvl), r in resolved.items()
                if material == "total" and r.MinElements is not None
            ]
            min_regular_cache[cache_key] = min(mins) if mins else None
        minimum = min_regular_cache[cache_key]
        if minimum is not None and count >= minimum:
            st.pop_ok[pdv_id].add(month)

    return st


# ---------------------------------------------------------------------------
# Filtros
# ---------------------------------------------------------------------------

def build_filters(db: Session) -> dict[str, Any]:
    base = Base(db)
    reps = sorted(base.rep_ids(), key=lambda uid: base.user_name.get(uid, ""))
    return {
        "zonas": [
            {"id": zid, "name": name}
            for zid, name in sorted(base.zone_names.items(), key=lambda kv: kv[1])
        ],
        "reps": [
            {"id": uid, "name": base.user_name.get(uid, f"Usuario {uid}"), "zoneId": base.user_zone.get(uid)}
            for uid in reps
        ],
        "meses": [
            {"key": month_key(m), "label": MONTH_ABBR[m[1] - 1]} for m in last_months(MAX_MONTHS)
        ],
        "fechaDatos": E._business_today().strftime("%d/%m/%Y"),
    }


# ---------------------------------------------------------------------------
# Universo
# ---------------------------------------------------------------------------

def _active_reps(db: Session, months: list[Month]) -> set[int]:
    """Usuarios con al menos una visita cerrada en el período."""
    return {
        uid for (uid,) in (
            db.query(Visit.UserId)
            .filter(Visit.Status == "CLOSED", _in_months_dt(Visit.OpenedAt, months))
            .distinct()
            .all()
        )
    }


class Shared:
    """Todo lo que depende solo de los meses elegidos. Son dicts y sets planos
    (sin objetos ORM), así que se puede cachear y compartir entre requests."""

    def __init__(self, db: Session, months: list[Month]):
        self.months = months
        self.base = Base(db)
        self.status = load_pdv_status(db, self.base, months)


def load_shared(db: Session, months: list[Month]) -> Shared:
    return Shared(db, months)


def build_universo(
    db: Session,
    months: list[Month],
    zone_id: Optional[int] = None,
    user_id: Optional[int] = None,
    shared: Optional[Shared] = None,
) -> dict[str, Any]:
    shared = shared or load_shared(db, months)
    base, status = shared.base, shared.status
    if user_id is not None:
        zone_id = None  # el rep manda: sus rutas pueden cruzar zonas
    active = _active_reps(db, months) & base.nomina

    # Alcance del filtro. Con TM Rep: su cartera (rastrillado) y sus rutas foco.
    def pdv_in_scope(pdv_id: int) -> bool:
        if zone_id is not None and base.pdv_zone.get(pdv_id) != zone_id:
            return False
        if user_id is not None:
            return base.pdv_assigned.get(pdv_id) == user_id or user_id in base.focus_owners(pdv_id)
        return True

    def focus_in_scope(pdv_id: int) -> bool:
        if pdv_id not in base.focus_owner:
            return False
        if user_id is not None:
            return user_id in base.focus_owners(pdv_id)
        return True

    def rep_in_scope(uid: int) -> bool:
        if user_id is not None and uid != user_id:
            return False
        return zone_id is None or base.user_zone.get(uid) == zone_id

    def route_in_scope(route_id: int) -> bool:
        if user_id is not None and base.route_user.get(route_id) != user_id:
            return False
        return zone_id is None or base.route_zone(route_id) == zone_id

    rows: dict[Optional[int], dict[str, int]] = defaultdict(
        lambda: {"rastrillado": 0, "enRutaFoco": 0, "visitados": 0, "efectivos": 0, "rutas": 0,
                 "repsActivos": 0, "repsNomina": 0}
    )
    for pdv_id, pdv_zone in base.pdv_zone.items():
        if not pdv_in_scope(pdv_id):
            continue
        row = rows[pdv_zone]
        row["rastrillado"] += 1
        if not focus_in_scope(pdv_id):
            continue
        row["enRutaFoco"] += 1
        if status.is_visited(pdv_id):
            row["visitados"] += 1
            if status.is_effective(pdv_id):
                row["efectivos"] += 1

    for route_id in base.routes_with_pdvs:
        if route_in_scope(route_id):
            rows[base.route_zone(route_id)]["rutas"] += 1
    for uid in base.nomina:
        if rep_in_scope(uid):
            rows[base.user_zone.get(uid)]["repsNomina"] += 1
            if uid in active:
                rows[base.user_zone.get(uid)]["repsActivos"] += 1

    areas = [
        {
            "zoneId": zid,
            "area": base.zone_label(zid),
            "rastrillado": r["rastrillado"],
            "enRutaFoco": r["enRutaFoco"],
            "visitados": r["visitados"],
            "efectivos": r["efectivos"],
            "rutas": r["rutas"],
            "repsActivos": r["repsActivos"],
            "pdvPorRep": _ratio(r["enRutaFoco"], r["repsActivos"], 0),
        }
        for zid, r in rows.items()
        if r["rastrillado"] or r["rutas"] or r["repsNomina"]
    ]
    areas.sort(key=lambda a: (a["zoneId"] is None, -a["rastrillado"], a["area"]))

    def total(key: str) -> int:
        return sum(r[key] for r in rows.values())

    en_ruta, rutas, reps_activos = total("enRutaFoco"), total("rutas"), total("repsActivos")
    return {
        "periodoLabel": months_label(months),
        "embudo": {
            "rastrillado": total("rastrillado"),
            "enRutaFoco": en_ruta,
            "visitados": total("visitados"),
            "efectivos": total("efectivos"),
        },
        "rutasFoco": rutas,
        "repsActivos": reps_activos,
        "repsNomina": total("repsNomina"),
        "pdvPorRuta": _ratio(en_ruta, rutas, 0),
        "pdvPorRep": _ratio(en_ruta, reps_activos, 0),
        "areas": areas,
    }


# ---------------------------------------------------------------------------
# Performance de equipo
# ---------------------------------------------------------------------------

EJECUCION_ACTIONS = {"canje_sueltos": "sueltos", "promo": "activaciones"}


def build_equipo(
    db: Session,
    months: list[Month],
    zone_id: Optional[int] = None,
    user_id: Optional[int] = None,
    shared: Optional[Shared] = None,
) -> dict[str, Any]:
    shared = shared or load_shared(db, months)
    base, status = shared.base, shared.status
    if user_id is not None:
        zone_id = None  # el rep manda (mismo criterio que Universo)
    dias = business_days(db, months)

    rep_ids = [
        uid for uid in base.rep_ids()
        if (user_id is None or uid == user_id)
        and (zone_id is None or base.user_zone.get(uid) == zone_id)
    ]
    rep_set = set(rep_ids)

    # ── Visitas cerradas: cantidad y duración ──────────────────────────────
    realizadas: dict[int, int] = defaultdict(int)
    dur_sum: dict[int, float] = defaultdict(float)
    dur_n: dict[int, int] = defaultdict(int)
    visit_user: dict[int, int] = {}
    for visit_id, uid, opened_at, closed_at in (
        db.query(Visit.VisitId, Visit.UserId, Visit.OpenedAt, Visit.ClosedAt)
        .filter(Visit.Status == "CLOSED", _in_months_dt(Visit.OpenedAt, months))
        .all()
    ):
        if uid not in rep_set:
            continue
        visit_user[visit_id] = uid
        realizadas[uid] += 1
        if closed_at is not None and closed_at >= opened_at:
            dur_sum[uid] += (closed_at - opened_at).total_seconds() / 60.0
            dur_n[uid] += 1

    def _visits_with(model, *extra) -> dict[int, int]:
        """Visitas cerradas del período con al menos una fila en `model`."""
        out: dict[int, int] = defaultdict(int)
        for (visit_id,) in (
            db.query(model.VisitId)
            .join(Visit, Visit.VisitId == model.VisitId)
            .filter(Visit.Status == "CLOSED", _in_months_dt(Visit.OpenedAt, months), *extra)
            .distinct()
            .all()
        ):
            uid = visit_user.get(visit_id)
            if uid is not None:
                out[uid] += 1
        return out

    gps = _visits_with(VisitCheck, VisitCheck.Lat.isnot(None))
    foto = _visits_with(VisitPhoto)

    # ── Planificación: visitas programadas en rutas foco del período ───────
    # Cumplimiento = realizadas / planificadas, como lo definió el negocio: las
    # realizadas incluyen visitas fuera de plan, así que puede pasar de 100%.
    planificadas: dict[int, int] = defaultdict(int)
    for route_id, n in (
        db.query(RouteDay.RouteId, func.count(RouteDayPdv.PdvId))
        .join(RouteDayPdv, RouteDayPdv.RouteDayId == RouteDay.RouteDayId)
        .filter(
            _in_months_date(RouteDay.WorkDate, months),
            # Hasta hoy: los días futuros del mes en curso todavía no se podían cumplir.
            RouteDay.WorkDate <= E._business_today(),
        )
        .group_by(RouteDay.RouteId)
        .all()
    ):
        uid = base.route_user.get(route_id)  # solo rutas foco vigentes
        if uid in rep_set:
            planificadas[uid] += n

    # ── Cartera y rutas foco por rep ───────────────────────────────────────
    clientes: dict[int, int] = defaultdict(int)
    cartera: dict[int, set[int]] = defaultdict(set)
    for pdv_id, uid in base.pdv_assigned.items():
        if uid in rep_set:
            clientes[uid] += 1
            cartera[uid].add(pdv_id)
    rutas_foco: dict[int, int] = defaultdict(int)
    for route_id in base.routes_with_pdvs:
        uid = base.route_user.get(route_id)
        if uid in rep_set:
            rutas_foco[uid] += 1

    # ── Efectividad: PDVs efectivos / visitados de sus rutas foco ──────────
    visitados: dict[int, int] = defaultdict(int)
    efectivos: dict[int, int] = defaultdict(int)
    # Un PDV en rutas foco de dos reps cuenta para los dos; en el total, una vez.
    tot_vis = tot_ef = 0
    for pdv_id in base.focus_owner:
        owners = base.focus_owners(pdv_id) & rep_set
        if not owners or not status.is_visited(pdv_id):
            continue
        effective = status.is_effective(pdv_id)
        tot_vis += 1
        tot_ef += effective
        for owner in owners:
            visitados[owner] += 1
            efectivos[owner] += effective

    # ── Ejecución en PDV: % de la cartera, promedio mensual ────────────────
    # (pdv, mes) con acción ejecutada de cada tipo, por cualquier usuario.
    action_pdvs: dict[str, dict[Month, set[int]]] = {
        k: defaultdict(set) for k in EJECUCION_ACTIONS.values()
    }
    for pdv_id, opened_at, action_type in (
        db.query(Visit.PdvId, Visit.OpenedAt, VisitAction.ActionType)
        .join(VisitAction, VisitAction.VisitId == Visit.VisitId)
        .filter(
            _in_months_dt(Visit.OpenedAt, months),
            VisitAction.ActionType.in_(list(EJECUCION_ACTIONS)),
            E.executed_action_condition(),
        )
        .all()
    ):
        action_pdvs[EJECUCION_ACTIONS[action_type]][_month_of(opened_at)].add(pdv_id)

    pop_pdvs: dict[Month, set[int]] = defaultdict(set)
    for pdv_id, ok_months in status.pop_ok.items():
        for m in ok_months:
            pop_pdvs[m].add(pdv_id)

    def monthly_avg_pct(uid: int, by_month: dict[Month, set[int]]) -> Optional[float]:
        n = clientes.get(uid, 0)
        if not n:
            return None
        mine = cartera[uid]
        return _mean([100.0 * len(by_month.get(m, set()) & mine) / n for m in months])

    # ── Movimientos en la app ──────────────────────────────────────────────
    movimientos: dict[int, int] = defaultdict(int)
    for year, month in months:
        dt_start, dt_end = E._month_datetime_range(year, month)
        for uid, slot in count_user_activity(db, dt_start, dt_end, end_exclusive=True).items():
            if uid in rep_set:
                movimientos[uid] += slot["count"]

    reps = []
    for uid in rep_ids:
        real = realizadas.get(uid, 0)
        plan = planificadas.get(uid, 0)
        reps.append({
            "id": uid,
            "nombre": base.user_name.get(uid, f"Usuario {uid}"),
            "zoneId": base.user_zone.get(uid),
            "area": base.zone_label(base.user_zone.get(uid)),
            "clientes": clientes.get(uid, 0),
            "rutasFoco": rutas_foco.get(uid, 0),
            "planificadas": plan,
            "realizadas": real,
            "cumplimientoPct": _pct(real, plan),
            "visitasPorDia": _ratio(real, dias) if real else None,
            "duracionMin": round(dur_sum[uid] / dur_n[uid]) if dur_n.get(uid) else None,
            "efectividadPct": _pct(efectivos.get(uid, 0), visitados.get(uid, 0)),
            "gpsPct": _pct(gps.get(uid, 0), real),
            "fotoPct": _pct(foto.get(uid, 0), real),
            "movimientos": movimientos.get(uid, 0),
            "comunicacionPct": monthly_avg_pct(uid, pop_pdvs),
            "sueltosPct": monthly_avg_pct(uid, action_pdvs["sueltos"]),
            "activacionesPct": monthly_avg_pct(uid, action_pdvs["activaciones"]),
        })
    reps.sort(key=lambda r: (-r["realizadas"], r["nombre"]))

    tot_real = sum(realizadas.values())
    tot_plan = sum(planificadas.values())
    reps_con_visitas = sum(1 for uid in rep_ids if realizadas.get(uid))
    tot_dur_n = sum(dur_n.values())
    return {
        "periodoLabel": months_label(months),
        "diasHabiles": dias,
        "cards": {
            "planificadas": tot_plan,
            "realizadas": tot_real,
            "cumplimientoPct": _pct(tot_real, tot_plan),
            "visitasPorDiaRep": _ratio(tot_real, dias * reps_con_visitas),
            "duracionMin": round(sum(dur_sum.values()) / tot_dur_n) if tot_dur_n else None,
            "efectividadPct": _pct(tot_ef, tot_vis),
            "efectivos": tot_ef,
            "visitados": tot_vis,
        },
        "reps": reps,
    }
