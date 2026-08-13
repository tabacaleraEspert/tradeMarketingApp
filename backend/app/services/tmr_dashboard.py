"""Datos del Tablero TMR, partidos por recurso.

La página consume cuatro recursos independientes:

    GET /kpi/tmr/team                  equipo, KPIs de actividad y conteos
    GET /kpi/tmr/routes?user_id=       rutas foco con cobertura y precios
    GET /kpi/tmr/pdvs?user_id=         PDVs con la matriz producto x PDV + quick wins
    GET /kpi/tmr/catalog               productos, agrupación por fabricante y precios de referencia

**Por qué partido y no un solo payload**: el costo real no está repartido
parejo. `team` sale de visitas/acciones/fotos (barato, y es lo único que
necesita la vista general). `routes` y `pdvs` necesitan el escaneo de
`VisitCoverage`, que es el 80% del tiempo del request — y ese escaneo solo hace
falta para el vendedor que estás mirando, no para los 20 a la vez. Con el corte
por `user_id`, abrir el tablero deja de pagar 20 veces algo que se usa una.

**Por qué no se reusa `kpi_engine.compute_kpis` por vendedor**: el motor está
escrito por usuario y hace ~25 queries por cada uno (~500 para el equipo). Acá
el eje es el conjunto: las queries salen una sola vez con `IN (user_ids)` y el
agrupado por usuario/ruta/PDV se hace en Python.

Las definiciones de negocio no se reinventan: el criterio de "acción ejecutada"
(`executed_action_condition`), la rúbrica (`_coverage_level`), el universo foco
y la ventana del mes salen de `kpi_engine`, única fuente de verdad de la
variable mensual.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from statistics import mean
from typing import Any, Optional

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..models import (
    PDV,
    Channel,
    Product,
    Route,
    RouteDay,
    RouteDayPdv,
    RoutePdv,
    ScoringCoverageRule,
    User,
    Visit,
    VisitAction,
    VisitCheck,
    VisitCoverage,
    VisitPhoto,
    VisitPOPItem,
    Zone,
)
from . import kpi_engine as E

# Etiquetas de nivel que espera la página (el motor usa snake_case internamente).
LEVEL_LABEL = {
    "excelente": "Excelente",
    "muy_bueno": "Muy Bueno",
    "bueno": "Bueno",
    "regular": "Regular",
    "no_cuenta": "No cuenta",
}
SCORE_KEYS = ("Excelente", "Muy Bueno", "Bueno", "Regular", "No cuenta")
GOOD_LABELS = ("Excelente", "Muy Bueno", "Bueno")

MONTH_NAMES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

# Tipos de acción que la página muestra como "entregas".
DELIVERY_TYPES = ("canje_sueltos", "promo", "juego")

# Un PDV es "quick win" si le faltan a lo sumo estos SKUs para llegar a 'bueno'
# (el umbral que efectivamente cuenta para el KPI 1).
QUICK_WIN_MAX_GAP = 2


def _pct(num: int, den: int) -> int:
    return round(num / den * 100) if den else 0


def periodo_label(year: int, month: int) -> str:
    d_start, d_end = E._month_range(year, month)
    days = (d_end - d_start).days
    day = E._business_today().day if E._is_current_month(year, month) else days
    return f"{MONTH_NAMES[month]} {year} · Día {day} de {days}"


# ---------------------------------------------------------------------------
# Contexto compartido
# ---------------------------------------------------------------------------

@dataclass
class TmrContext:
    """Todo lo que los cuatro recursos comparten, cargado una sola vez.

    `with_coverage=False` saltea el escaneo de `VisitCoverage` — la parte cara,
    que solo necesitan `routes` y `pdvs`."""

    year: int
    month: int
    user_ids: list[int]
    name_of: dict[int, str] = field(default_factory=dict)
    zone_of: dict[int, str] = field(default_factory=dict)
    user_by_id: dict[int, Any] = field(default_factory=dict)
    zone_names: dict[int, str] = field(default_factory=dict)
    routes: list = field(default_factory=list)
    pdvs_by_route: dict = field(default_factory=dict)
    universe_by_user: dict = field(default_factory=dict)
    route_of_pdv: dict = field(default_factory=dict)
    pdv_by_id: dict = field(default_factory=dict)
    channel_names: dict = field(default_factory=dict)
    planned_by_route: dict = field(default_factory=dict)
    visits: list = field(default_factory=list)
    visits_by_user: dict = field(default_factory=dict)
    visits_count_by_pdv: dict = field(default_factory=dict)
    actions_by_pdv: dict = field(default_factory=dict)
    visits_with_action: set = field(default_factory=set)
    pdvs_with_material: set = field(default_factory=set)
    photo_visits: set = field(default_factory=set)
    gps_visits: set = field(default_factory=set)
    # Solo con with_coverage=True:
    latest: dict = field(default_factory=dict)
    works_by_pdv: dict = field(default_factory=dict)
    seen_by_pdv: dict = field(default_factory=dict)
    relevado: set = field(default_factory=set)
    score_by_pdv: dict = field(default_factory=dict)
    cov_rules_by_user: dict = field(default_factory=dict)

    def pdv_channel(self, p) -> str:
        return self.channel_names.get(p.ChannelId) or p.Channel or "—"

    def pdv_loc(self, p) -> str:
        return p.City or p.Address or "—"

    def routes_of(self, uid: int) -> list:
        return [r for r in self.routes if r.AssignedUserId == uid]


def load_context(
    db: Session, user_ids: list[int], year: int, month: int, *, with_coverage: bool
) -> TmrContext:
    ctx = TmrContext(year=year, month=month, user_ids=list(user_ids))
    if not user_ids:
        return ctx

    dt_start, dt_end = E._month_datetime_range(year, month)
    d_start, d_end = E._month_range(year, month)
    ref_date = E._reference_date(year, month)

    # ── Usuarios + zonas ───────────────────────────────────────────────────
    users = db.query(User).filter(User.UserId.in_(user_ids)).all()
    zone_names = {z.ZoneId: z.Name for z in db.query(Zone).all()}
    ctx.user_by_id = {u.UserId: u for u in users}
    ctx.name_of = {u.UserId: u.DisplayName for u in users}
    ctx.zone_of = {u.UserId: zone_names.get(u.ZoneId, "") for u in users}
    ctx.zone_names = zone_names

    # ── Rutas foco + PDVs ──────────────────────────────────────────────────
    ctx.routes = (
        db.query(Route)
        .filter(
            Route.IsFocus == True,  # noqa: E712
            Route.IsActive == True,  # noqa: E712
            Route.AssignedUserId.in_(user_ids),
        )
        .all()
    )
    route_ids = [r.RouteId for r in ctx.routes]
    route_by_id = {r.RouteId: r for r in ctx.routes}

    ctx.pdvs_by_route = defaultdict(list)
    ctx.universe_by_user = defaultdict(set)
    ctx.route_of_pdv = {}
    rows = (
        db.query(RoutePdv.RouteId, RoutePdv.PdvId)
        .join(PDV, PDV.PdvId == RoutePdv.PdvId)
        .filter(RoutePdv.RouteId.in_(route_ids), PDV.IsActive == True)  # noqa: E712
        .all()
        if route_ids
        else []
    )
    for route_id, pdv_id in rows:
        r = route_by_id[route_id]
        ctx.pdvs_by_route[route_id].append(pdv_id)
        ctx.universe_by_user[r.AssignedUserId].add(pdv_id)
        ctx.route_of_pdv.setdefault((r.AssignedUserId, pdv_id), r.Name)

    # La ficha completa de cada PDV (~5k filas) solo la necesitan `routes` y
    # `pdvs`; `team` trabaja con los conteos del universo, así que se saltea.
    if with_coverage:
        all_pdv_ids = {p for pdvs in ctx.pdvs_by_route.values() for p in pdvs}
        ctx.channel_names = {c.ChannelId: c.Name for c in db.query(Channel).all()}
        ctx.pdv_by_id = {
            p.PdvId: p
            for p in (db.query(PDV).filter(PDV.PdvId.in_(all_pdv_ids)).all() if all_pdv_ids else [])
        }

    # ── Planificación del mes ──────────────────────────────────────────────
    route_days = (
        db.query(RouteDay.RouteDayId, RouteDay.RouteId)
        .filter(
            RouteDay.RouteId.in_(route_ids),
            RouteDay.WorkDate >= d_start,
            RouteDay.WorkDate < d_end,
        )
        .all()
        if route_ids
        else []
    )
    route_of_day = {rd_id: r_id for rd_id, r_id in route_days}
    ctx.planned_by_route = defaultdict(set)
    planned_rows = (
        db.query(RouteDayPdv.RouteDayId, RouteDayPdv.PdvId)
        .filter(RouteDayPdv.RouteDayId.in_(list(route_of_day.keys())))
        .all()
        if route_of_day
        else []
    )
    for rd_id, pdv_id in planned_rows:
        r_id = route_of_day.get(rd_id)
        if r_id is not None:
            ctx.planned_by_route[r_id].add(pdv_id)

    # ── Visitas del mes ────────────────────────────────────────────────────
    ctx.visits = (
        db.query(Visit.VisitId, Visit.PdvId, Visit.UserId, Visit.OpenedAt, Visit.ClosedAt)
        .filter(
            Visit.UserId.in_(user_ids),
            Visit.OpenedAt >= dt_start,
            Visit.OpenedAt < dt_end,
        )
        .all()
    )
    visit_ids = [v.VisitId for v in ctx.visits]
    user_of_visit = {v.VisitId: v.UserId for v in ctx.visits}
    pdv_of_visit = {v.VisitId: v.PdvId for v in ctx.visits}

    ctx.visits_by_user = defaultdict(list)
    ctx.visits_count_by_pdv = defaultdict(int)
    for v in ctx.visits:
        ctx.visits_by_user[v.UserId].append(v)
        ctx.visits_count_by_pdv[(v.UserId, v.PdvId)] += 1

    # ── Acciones, POP, fotos, GPS ──────────────────────────────────────────
    ctx.actions_by_pdv = defaultdict(set)
    for vid, action_type in (
        db.query(VisitAction.VisitId, VisitAction.ActionType)
        .filter(VisitAction.VisitId.in_(visit_ids), E.executed_action_condition())
        .all()
        if visit_ids
        else []
    ):
        ctx.visits_with_action.add(vid)
        uid = user_of_visit.get(vid)
        if uid is not None:
            ctx.actions_by_pdv[(uid, pdv_of_visit[vid])].add(action_type)

    for (vid,) in (
        db.query(VisitPOPItem.VisitId)
        .filter(VisitPOPItem.VisitId.in_(visit_ids), VisitPOPItem.Present == True)  # noqa: E712
        .distinct()
        .all()
        if visit_ids
        else []
    ):
        uid = user_of_visit.get(vid)
        if uid is not None:
            ctx.pdvs_with_material.add((uid, pdv_of_visit[vid]))

    ctx.photo_visits = {
        vid for (vid,) in (
            db.query(VisitPhoto.VisitId).filter(VisitPhoto.VisitId.in_(visit_ids)).distinct().all()
            if visit_ids else []
        )
    }
    ctx.gps_visits = {
        vid for (vid,) in (
            db.query(VisitCheck.VisitId)
            .filter(VisitCheck.VisitId.in_(visit_ids), VisitCheck.Lat.isnot(None))
            .distinct().all()
            if visit_ids else []
        )
    }

    if with_coverage:
        _load_coverage(db, ctx, visit_ids, ref_date)
    return ctx


def _load_coverage(db: Session, ctx: TmrContext, visit_ids: list[int], ref_date) -> None:
    """El escaneo caro: `VisitCoverage` de todas las visitas del scope.

    Consolidación mensual idéntica a `kpi_engine.pdv_coverage_scores`: por cada
    (PDV, producto) manda la visita MÁS RECIENTE del mes que lo relevó."""
    cov_rows = (
        db.query(
            Visit.UserId, Visit.PdvId, Visit.OpenedAt,
            VisitCoverage.Works, VisitCoverage.Price, Product.Name,
        )
        .join(Visit, Visit.VisitId == VisitCoverage.VisitId)
        .join(Product, Product.ProductId == VisitCoverage.ProductId)
        .filter(VisitCoverage.VisitId.in_(visit_ids))
        .all()
        if visit_ids
        else []
    )
    latest: dict[tuple[int, int, str], tuple[datetime, bool, Optional[float]]] = {}
    for user_id, pdv_id, opened_at, works, price, prod_name in cov_rows:
        ctx.relevado.add((user_id, pdv_id))
        key = (user_id, pdv_id, prod_name)
        prev = latest.get(key)
        if prev is None or opened_at > prev[0]:
            latest[key] = (opened_at, bool(works), float(price) if price else None)
    ctx.latest = latest

    ctx.works_by_pdv = defaultdict(set)
    ctx.seen_by_pdv = defaultdict(set)
    for (user_id, pdv_id, prod_name), (_at, works, _price) in latest.items():
        ctx.seen_by_pdv[(user_id, pdv_id)].add(prod_name)
        if works:
            ctx.works_by_pdv[(user_id, pdv_id)].add(prod_name)

    # Las reglas se traen UNA vez para todo el scope y se resuelven por usuario en
    # Python: `_resolve_coverage_rules` haría la misma query por cada vendedor
    # (el filtro de vigencia no depende del usuario).
    rule_rows = (
        db.query(ScoringCoverageRule)
        .filter(E._vigente_filter(ScoringCoverageRule, ref_date))
        .all()
    )
    ctx.cov_rules_by_user = {
        uid: {
            key: r.MinSkus
            for key, r in E._resolve_rows(
                rule_rows,
                uid,
                ctx.user_by_id[uid].ZoneId if uid in ctx.user_by_id else None,
                lambda r: (r.Brand, r.Level),
            ).items()
        }
        for uid in ctx.user_ids
    }

    for uid in ctx.user_ids:
        rules = ctx.cov_rules_by_user[uid]
        for pdv_id in ctx.universe_by_user[uid]:
            if (uid, pdv_id) not in ctx.relevado:
                ctx.score_by_pdv[(uid, pdv_id)] = None  # sin relevar
            else:
                level = E._coverage_level(
                    ctx.works_by_pdv[(uid, pdv_id)], rules, ctx.seen_by_pdv[(uid, pdv_id)]
                )
                ctx.score_by_pdv[(uid, pdv_id)] = LEVEL_LABEL.get(level, "No cuenta")


def _missing_to_good(works: set, rules: dict, surveyed: set) -> list[str]:
    """Qué le falta a un PDV para llegar a 'bueno', marca por marca (`"+1 Van Kiff"`).

    Se saltean las marcas que el censo no relevó: sugerir "+1 Lebonn" en un PDV
    donde nunca se preguntó por Lebonn es ruido, no una oportunidad."""
    missing = []
    for brand in E.CIGS_BRANDS + E.TABACOS_BRANDS:
        min_skus = rules.get((brand, "bueno"))
        if not min_skus or not E._matched_sku_names(brand, surveyed):
            continue
        have = len(E._matched_sku_names(brand, works))
        if have < min_skus:
            missing.append(f"+{min_skus - have} {brand}")
    return missing


# ---------------------------------------------------------------------------
# GET /kpi/tmr/team
# ---------------------------------------------------------------------------

def _duration_minutes_expr(db: Session):
    """Duración de la visita en minutos, en el dialecto que toque.

    Azure SQL y la SQLite de los tests no comparten función de diferencia de
    fechas; se resuelve acá para poder promediar en SQL en vez de traer las
    marcas de tiempo de cada visita."""
    if db.bind.dialect.name == "mssql":
        # En segundos, no en minutos: `DATEDIFF(minute, ...)` cuenta cruces de
        # frontera de minuto, o sea trunca cada visita antes de promediar y el
        # promedio sale hasta un minuto por debajo del real.
        return func.datediff(text("second"), Visit.OpenedAt, Visit.ClosedAt) / 60.0
    return (func.julianday(Visit.ClosedAt) - func.julianday(Visit.OpenedAt)) * 1440


def _focus_route_join(q):
    """Acota una query a los PDVs de rutas foco activas del propio vendedor.

    El join contra `Route.AssignedUserId == Visit.UserId` es lo que evita tener
    que traer el universo a Python para intersectarlo: el "PDV con ruta
    asignada" se resuelve en la base."""
    return (
        q.join(RoutePdv, RoutePdv.PdvId == Visit.PdvId)
        .join(Route, Route.RouteId == RoutePdv.RouteId)
        .filter(
            Route.AssignedUserId == Visit.UserId,
            Route.IsFocus == True,  # noqa: E712
            Route.IsActive == True,  # noqa: E712
        )
    )


def build_team(db: Session, user_ids: list[int], year: int, month: int) -> dict[str, Any]:
    """Equipo con sus KPIs de actividad.

    Todo sale de agregados `GROUP BY` — ~8 queries que devuelven una fila por
    vendedor. Antes esto traía las visitas del mes fila por fila (~1.500) más
    los PDVs de todas las rutas (~5.000) para contarlos en Python; el resultado
    es idéntico pero viaja tres órdenes de magnitud menos de datos, que es lo
    que domina el tiempo contra Azure SQL."""
    if not user_ids:
        return {
            "periodo_label": periodo_label(year, month),
            "fecha_datos": E._reference_date(year, month).strftime("%d/%m/%Y"),
            "res": {"vis": 0, "ent": 0, "foto": 0, "ef": 0, "acc": 0},
            "trades": [], "tmrs": [], "tmr_zona": {}, "zonas": {},
        }

    dt_start, dt_end = E._month_datetime_range(year, month)
    d_start, d_end = E._month_range(year, month)

    users = db.query(User).filter(User.UserId.in_(user_ids)).all()
    zone_names = {z.ZoneId: z.Name for z in db.query(Zone).all()}
    name_of = {u.UserId: u.DisplayName for u in users}
    zone_of = {u.UserId: zone_names.get(u.ZoneId, "") for u in users}

    in_month = [
        Visit.UserId.in_(user_ids),
        Visit.OpenedAt >= dt_start,
        Visit.OpenedAt < dt_end,
    ]

    # Visitas del mes y duración promedio.
    tot_by_user, dur_by_user = {}, {}
    for uid, n, avg_min in (
        db.query(Visit.UserId, func.count(Visit.VisitId), func.avg(_duration_minutes_expr(db)))
        .filter(*in_month)
        .group_by(Visit.UserId)
        .all()
    ):
        tot_by_user[uid] = n or 0
        dur_by_user[uid] = round(float(avg_min)) if avg_min is not None else 0

    # PDVs del universo foco con al menos una visita.
    vis_by_user = dict(
        _focus_route_join(db.query(Visit.UserId, func.count(func.distinct(Visit.PdvId))))
        .filter(*in_month)
        .group_by(Visit.UserId)
        .all()
    )

    # PDVs planificados que efectivamente se visitaron. Es el numerador de la
    # efectividad: tiene que ser subconjunto de los planificados, si no el
    # porcentaje pasa de 100 (un vendedor que cumple el plan y ademas visita
    # PDVs de su ruta no agendados ese mes daba 115%).
    vis_plan_by_user = dict(
        db.query(Visit.UserId, func.count(func.distinct(Visit.PdvId)))
        .join(RouteDayPdv, RouteDayPdv.PdvId == Visit.PdvId)
        .join(RouteDay, RouteDay.RouteDayId == RouteDayPdv.RouteDayId)
        .join(Route, Route.RouteId == RouteDay.RouteId)
        .filter(
            *in_month,
            Route.AssignedUserId == Visit.UserId,
            Route.IsFocus == True,  # noqa: E712
            Route.IsActive == True,  # noqa: E712
            RouteDay.WorkDate >= d_start,
            RouteDay.WorkDate < d_end,
        )
        .group_by(Visit.UserId)
        .all()
    )

    # Tamaño del universo y de la planificación del mes.
    universe_by_user = dict(
        db.query(Route.AssignedUserId, func.count(func.distinct(RoutePdv.PdvId)))
        .join(RoutePdv, RoutePdv.RouteId == Route.RouteId)
        .join(PDV, PDV.PdvId == RoutePdv.PdvId)
        .filter(
            Route.AssignedUserId.in_(user_ids),
            Route.IsFocus == True,  # noqa: E712
            Route.IsActive == True,  # noqa: E712
            PDV.IsActive == True,  # noqa: E712
        )
        .group_by(Route.AssignedUserId)
        .all()
    )
    planned_by_user = dict(
        db.query(Route.AssignedUserId, func.count(func.distinct(RouteDayPdv.PdvId)))
        .join(RouteDay, RouteDay.RouteId == Route.RouteId)
        .join(RouteDayPdv, RouteDayPdv.RouteDayId == RouteDay.RouteDayId)
        .filter(
            Route.AssignedUserId.in_(user_ids),
            Route.IsFocus == True,  # noqa: E712
            Route.IsActive == True,  # noqa: E712
            RouteDay.WorkDate >= d_start,
            RouteDay.WorkDate < d_end,
        )
        .group_by(Route.AssignedUserId)
        .all()
    )

    # Visitas con GPS registrado / con foto / con acción ejecutada.
    def _visits_matching(join_model, on_clause, *extra):
        return dict(
            db.query(Visit.UserId, func.count(func.distinct(Visit.VisitId)))
            .join(join_model, on_clause)
            .filter(*in_month, *extra)
            .group_by(Visit.UserId)
            .all()
        )

    gps_by_user = _visits_matching(
        VisitCheck, VisitCheck.VisitId == Visit.VisitId, VisitCheck.Lat.isnot(None)
    )
    foto_by_user = _visits_matching(VisitPhoto, VisitPhoto.VisitId == Visit.VisitId)
    accion_by_user = _visits_matching(
        VisitAction, VisitAction.VisitId == Visit.VisitId, E.executed_action_condition()
    )

    # Entregas: PDVs distintos del universo con cada tipo de acción ejecutada.
    ent_by_user: dict[int, dict[str, int]] = {
        uid: {t: 0 for t in DELIVERY_TYPES} for uid in user_ids
    }
    for uid, action_type, n in (
        _focus_route_join(
            db.query(
                Visit.UserId, VisitAction.ActionType, func.count(func.distinct(Visit.PdvId))
            ).join(VisitAction, VisitAction.VisitId == Visit.VisitId)
        )
        .filter(
            *in_month,
            VisitAction.ActionType.in_(DELIVERY_TYPES),
            E.executed_action_condition(),
        )
        .group_by(Visit.UserId, VisitAction.ActionType)
        .all()
    ):
        if uid in ent_by_user and action_type in ent_by_user[uid]:
            ent_by_user[uid][action_type] = n

    trades = []
    for uid in user_ids:
        tot = tot_by_user.get(uid, 0)
        vis = vis_by_user.get(uid, 0)
        plan = planned_by_user.get(uid, 0)
        vis_plan = vis_plan_by_user.get(uid, 0)
        ent = ent_by_user.get(uid, {t: 0 for t in DELIVERY_TYPES})
        trades.append({
            "id": uid,
            "n": name_of.get(uid, f"Usuario {uid}"),
            "zona": zone_of.get(uid, ""),
            "tot": tot,
            "vis": vis,
            "pdvs": universe_by_user.get(uid, 0),
            "plan": plan,
            "vis_plan": vis_plan,
            "ef_pct": _pct(vis_plan, plan),
            "gps": _pct(gps_by_user.get(uid, 0), tot),
            "foto": _pct(foto_by_user.get(uid, 0), tot),
            "dur": dur_by_user.get(uid, 0),
            "accion_pct": _pct(accion_by_user.get(uid, 0), tot),
            "tot_ent": sum(ent.values()),
            "ent": ent,
        })

    trades.sort(key=lambda t: -t["tot"])
    total_vis = sum(t["tot"] for t in trades)
    return {
        "periodo_label": periodo_label(year, month),
        "fecha_datos": E._reference_date(year, month).strftime("%d/%m/%Y"),
        "res": {
            "vis": total_vis,
            "ent": sum(t["tot_ent"] for t in trades),
            "foto": _pct(sum(foto_by_user.values()), total_vis),
            "ef": round(mean([t["ef_pct"] for t in trades])) if trades else 0,
            "acc": round(mean([t["accion_pct"] for t in trades])) if trades else 0,
        },
        "trades": trades,
        "tmrs": [t["n"] for t in trades],
        "tmr_zona": {t["n"]: t["zona"] for t in trades},
        "zonas": {z: 1 for z in sorted({t["zona"] for t in trades if t["zona"]})},
    }


# ---------------------------------------------------------------------------
# GET /kpi/tmr/routes
# ---------------------------------------------------------------------------

def build_routes(
    db: Session, user_ids: list[int], year: int, month: int, *, with_products: bool = True
) -> dict[str, Any]:
    """Rutas foco con cobertura, precios y distribución de niveles.

    `with_products=False` omite `prod_cob`/`precios_ruta` (las matrices por
    producto, que son el grueso del payload) para quien solo quiere los
    agregados de la ruta."""
    ctx = load_context(db, user_ids, year, month, with_coverage=True)
    all_prod_names = sorted({name for (_u, _p, name) in ctx.latest})

    rutas = []
    for r in ctx.routes:
        uid = r.AssignedUserId
        pdv_list = ctx.pdvs_by_route[r.RouteId]
        planned = ctx.planned_by_route.get(r.RouteId, set())
        visited = [p for p in pdv_list if ctx.visits_count_by_pdv.get((uid, p), 0) > 0]
        # Solo los planificados que se visitaron cuentan para la efectividad.
        vis_plan = len(planned & set(visited))
        relev = [p for p in pdv_list if (uid, p) in ctx.relevado]
        buenos = [p for p in pdv_list if ctx.score_by_pdv.get((uid, p)) in GOOD_LABELS]

        dist = {k: 0 for k in SCORE_KEYS}
        for p in pdv_list:
            s = ctx.score_by_pdv.get((uid, p))
            if s in dist:
                dist[s] += 1

        vende_sueltos = [
            p for p in pdv_list
            if ctx.pdv_by_id.get(p) and ctx.pdv_by_id[p].SellsLooseCigarettes
        ]
        row = {
            "nombre": r.Name,
            "trade": ctx.name_of.get(uid, ""),
            "user_id": uid,
            "zona": ctx.zone_names.get(r.ZoneId, "") or ctx.zone_of.get(uid, ""),
            "pdvs": len(pdv_list),
            "relevados": len(relev),
            "buenos": len(buenos),
            "vis_pdvs_jul": len(visited),
            "vis_plan": vis_plan,
            "planned_mes": len(planned),
            "vende_sueltos": len(vende_sueltos),
            "con_canje": sum(
                1 for p in vende_sueltos if "canje_sueltos" in ctx.actions_by_pdv.get((uid, p), ())
            ),
            "con_promo": sum(
                1 for p in pdv_list if "promo" in ctx.actions_by_pdv.get((uid, p), ())
            ),
            "con_material": sum(1 for p in pdv_list if (uid, p) in ctx.pdvs_with_material),
            "ef_jul": _pct(vis_plan, len(planned)),
            "cob_score_pct": _pct(len(buenos), len(relev)),
            "freq": "biweekly" if (r.FrequencyType or "").lower() == "biweekly" else "monthly",
            "score_dist": dist,
        }

        if with_products:
            prod_cob, precios_ruta = {}, {}
            for prod_name in all_prod_names:
                con = sum(1 for p in pdv_list if prod_name in ctx.works_by_pdv.get((uid, p), ()))
                if con:
                    prod_cob[prod_name] = _pct(con, len(pdv_list))
                vals = [
                    ctx.latest[(uid, p, prod_name)][2]
                    for p in pdv_list
                    if (uid, p, prod_name) in ctx.latest and ctx.latest[(uid, p, prod_name)][2]
                ]
                if vals:
                    precios_ruta[prod_name] = {
                        "avg": round(mean(vals)), "min": round(min(vals)),
                        "max": round(max(vals)), "n": len(vals),
                    }
            row["prod_cob"] = prod_cob
            row["precios_ruta"] = precios_ruta

        rutas.append(row)

    rutas.sort(key=lambda r: -r["vis_pdvs_jul"])
    return {"rutas": rutas}


# ---------------------------------------------------------------------------
# GET /kpi/tmr/pdvs
# ---------------------------------------------------------------------------

def build_pdvs(db: Session, user_ids: list[int], year: int, month: int) -> dict[str, Any]:
    """PDVs por vendedor con la matriz producto x PDV, más los quick wins."""
    ctx = load_context(db, user_ids, year, month, with_coverage=True)
    espert_prods = sorted(
        p.Name
        for p in db.query(Product).filter(
            Product.IsActive == True, Product.IsOwn == True  # noqa: E712
        ).all()
    )

    tmr_pdvs: dict[str, list] = {}
    quick_wins = []
    for uid in ctx.user_ids:
        tname = ctx.name_of.get(uid, f"Usuario {uid}")
        rules = ctx.cov_rules_by_user.get(uid, {})
        rows = []
        for pdv_id in sorted(ctx.universe_by_user[uid]):
            p = ctx.pdv_by_id.get(pdv_id)
            if p is None:
                continue
            works = ctx.works_by_pdv.get((uid, pdv_id), set())
            seen = ctx.seen_by_pdv.get((uid, pdv_id), set())
            score = ctx.score_by_pdv.get((uid, pdv_id))
            nvis = ctx.visits_count_by_pdv.get((uid, pdv_id), 0)
            acts = sorted(ctx.actions_by_pdv.get((uid, pdv_id), ()))
            ruta = ctx.route_of_pdv.get((uid, pdv_id), "Sin ruta asignada")
            rows.append({
                "n": p.Name,
                "loc": ctx.pdv_loc(p),
                "canal": ctx.pdv_channel(p),
                "vis": nvis,
                "ha": bool(acts),
                "at": acts,
                "vs": "Sí" if p.SellsLooseCigarettes
                      else ("No" if p.SellsLooseCigarettes is False else "Sin dato"),
                "score": score,
                # `pr`: 1 trabaja / 0 no trabaja / None no relevado, en el mismo
                # orden que `espert_prods` (la página lo indexa posicionalmente).
                "pr": [
                    1 if name in works else (0 if name in seen else None)
                    for name in espert_prods
                ],
                "ruta": ruta,
            })

            if score is not None and score not in GOOD_LABELS:
                missing = _missing_to_good(works, rules, seen)
                gaps = sum(int(m.split()[0].lstrip("+")) for m in missing) if missing else 0
                if missing and gaps <= QUICK_WIN_MAX_GAP:
                    quick_wins.append({
                        "n": p.Name, "loc": ctx.pdv_loc(p), "canal": ctx.pdv_channel(p),
                        "vis": nvis, "gaps": gaps, "missing": missing, "ruta": ruta,
                        "trade": tname, "zona": ctx.zone_of.get(uid, ""),
                    })
        tmr_pdvs[tname] = rows

    quick_wins.sort(key=lambda q: (q["gaps"], -q["vis"]))
    return {"tmr_pdvs": tmr_pdvs, "quick_wins": quick_wins, "espert_prods": espert_prods}


# ---------------------------------------------------------------------------
# GET /kpi/tmr/catalog
# ---------------------------------------------------------------------------

def build_catalog(db: Session, year: int, month: int) -> dict[str, Any]:
    """Catálogo de productos + precio de referencia por producto.

    Los precios salen agregados en SQL (una query, una fila por producto) en vez
    de traer los relevamientos y promediar en Python. Ojo con la diferencia
    respecto de `precios_ruta`: acá entran TODOS los relevamientos del mes, no
    el último por (PDV, producto) — alcanza para lo que se usa, que es una línea
    de base contra la cual comparar el precio de una ruta."""
    products = db.query(Product).filter(Product.IsActive == True).all()  # noqa: E712
    fab_groups: dict[str, list[str]] = defaultdict(list)
    for p in products:
        fab_groups[p.Manufacturer or "Sin fabricante"].append(p.Name)
    for f in fab_groups:
        fab_groups[f].sort()

    dt_start, dt_end = E._month_datetime_range(year, month)
    price_rows = (
        db.query(
            Product.Name,
            func.avg(VisitCoverage.Price),
            func.min(VisitCoverage.Price),
            func.max(VisitCoverage.Price),
            func.count(VisitCoverage.Price),
        )
        .join(VisitCoverage, VisitCoverage.ProductId == Product.ProductId)
        .join(Visit, Visit.VisitId == VisitCoverage.VisitId)
        .filter(
            VisitCoverage.Price.isnot(None),
            VisitCoverage.Price > 0,
            Visit.OpenedAt >= dt_start,
            Visit.OpenedAt < dt_end,
        )
        .group_by(Product.Name)
        .all()
    )
    return {
        "espert_prods": sorted(p.Name for p in products if p.IsOwn),
        "all_prods": sorted(p.Name for p in products),
        "prod_fab_groups": dict(fab_groups),
        "precios": {
            "prod": {
                name: {"avg": round(float(avg)), "min": round(float(mn)),
                       "max": round(float(mx)), "n": n}
                for name, avg, mn, mx, n in price_rows
            },
            "zona": {},
            "trade": {},
        },
    }
