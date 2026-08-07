"""Endpoints del tablero TMR (docs/tablero-tmr-plan-fase1.md T3).

Los endpoints de consulta (`/variable`, `/pdv-scoring`, `/route-summary`) reusan el
motor de `app/services/kpi_engine.py` (no reimplementan cálculo de KPI); solo agregan
las queries de conteo que el motor no expone (planificado/visitado/acciones por ruta
para `/route-summary`, nombre de ruta y última visita por PDV para `/pdv-scoring`).
`/weekly-activity` es una vista de detalle individual (entrada/salida por PDV agrupada
en semana/día, DD.visits_semanal del prototipo) — `user_id` es obligatorio.

Todos pasan por `visible_user_ids()` (app/hierarchy.py), mismo patrón que audit.py:
- sin `user_id`: si el rol ve todo (admin, `visible=None`) se calcula para todos los
  usuarios con al menos una ruta foco activa asignada; si el rol tiene un sub-árbol
  (`visible=set(...)`) se calcula para ese set completo.
- con `user_id`: 403 si no está en el set visible.

El CRUD de configuración (`/definitions`, `/config`, `/scoring-rules`) tiene los verbos
de escritura (POST/DELETE) solo admin; la lectura (GET) además admite territory_manager
y superior (config/reglas globales, no hay scoping por equipo para estos endpoints).
Usa vigencias (ValidFrom/ValidTo) en vez de borrado físico, igual que el resto del
motor. `/config/resolved` es de solo lectura para cualquier rol, con la misma
validación de visibilidad.
"""
from datetime import date, datetime, timedelta, timezone
from statistics import median

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_role
from ..database import get_db
from ..hierarchy import visible_user_ids
from ..models import (
    User as UserModel,
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
    KpiMonthlySnapshot as KpiMonthlySnapshotModel,
    ScoringCoverageRule as ScoringCoverageRuleModel,
    ScoringCommunicationRule as ScoringCommunicationRuleModel,
)
from ..services.kpi_engine import (
    GOOD_OR_BETTER,
    compute_kpis,
    filter_price_outliers,
    focus_universe,
    pdv_coverage_scores,
    pdv_communication_scores,
    resolve_config,
)
from ..schemas.kpi import (
    KpiDefinitionOut,
    KpiConfigCreate,
    KpiConfigBulkCreate,
    KpiConfigOut,
    ScoringCoverageRuleCreate,
    ScoringCoverageRuleOut,
    ScoringCommunicationRuleCreate,
    ScoringCommunicationRuleOut,
)

router = APIRouter(prefix="/kpi", tags=["Tablero TMR"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1)
    end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    return start, end


_MONTH_ABBR_ES = [
    "", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
]
_WEEKDAY_ABBR_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]


def _day_short(d: date) -> str:
    """`'4 Ago'` — sin depender del locale del SO (T3, DD.visits_semanal)."""
    return f"{d.day} {_MONTH_ABBR_ES[d.month]}"


def _week_start(d: date) -> date:
    """Lunes de la semana ISO que contiene `d`."""
    return d - timedelta(days=d.weekday())


def _resolve_target_user_ids(db: Session, current_user: UserModel, user_id: int | None) -> list[int]:
    """Usuarios a computar: con `user_id`, valida pertenencia a visibles (403 si no).
    Sin `user_id`: el set visible completo; si el rol ve todo (admin, `None`), todos
    los usuarios con al menos una ruta foco activa asignada."""
    visible = visible_user_ids(db, current_user)
    if user_id is not None:
        if visible is not None and user_id not in visible:
            raise HTTPException(403, "No tenés acceso a los datos de este usuario")
        return [user_id]
    if visible is not None:
        return sorted(visible)
    rows = (
        db.query(RouteModel.AssignedUserId)
        .filter(RouteModel.IsFocus == True, RouteModel.IsActive == True, RouteModel.AssignedUserId.isnot(None))  # noqa: E712
        .distinct()
        .all()
    )
    return [r[0] for r in rows]


# ---------------------------------------------------------------------------
# GET /kpi/variable
# ---------------------------------------------------------------------------

@router.get("/variable")
def get_kpi_variable(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    target_ids = _resolve_target_user_ids(db, current_user, user_id)
    if not target_ids:
        return []

    users = {u.UserId: u for u in db.query(UserModel).filter(UserModel.UserId.in_(target_ids)).all()}

    manager_ids = {u.ManagerUserId for u in users.values() if u.ManagerUserId is not None}
    managers = {
        m.UserId: m
        for m in (db.query(UserModel).filter(UserModel.UserId.in_(manager_ids)).all() if manager_ids else [])
    }

    result = []
    for uid in target_ids:
        r = compute_kpis(db, uid, year, month)
        u = users.get(uid)
        manager = managers.get(u.ManagerUserId) if u and u.ManagerUserId is not None else None
        result.append({
            "userId": uid,
            "name": u.DisplayName if u else None,
            "managerUserId": u.ManagerUserId if u else None,
            "managerName": manager.DisplayName if manager else None,
            "partial": r.partial,
            "day": r.day,
            "kpis": [
                {
                    "key": k.key,
                    "name": k.name,
                    "actual": k.actual,
                    "target": k.target,
                    "weight": k.weight,
                    "achieved": k.achieved,
                    "numerator": k.numerator,
                    "denominator": k.denominator,
                    "scopeApplied": k.scope_applied,
                }
                for k in r.kpis
            ],
            "variableTotal": r.variable_total,
            "configWarning": r.config_warning,
        })
    return result


# ---------------------------------------------------------------------------
# GET /kpi/pdv-scoring
# ---------------------------------------------------------------------------

@router.get("/pdv-scoring")
def get_pdv_scoring(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    user_id: int = Query(...),
    route_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    visible = visible_user_ids(db, current_user)
    if visible is not None and user_id not in visible:
        raise HTTPException(403, "No tenés acceso a los datos de este usuario")

    universe = focus_universe(db, user_id, year, month)

    route_by_pdv: dict[int, tuple[int, str]] = {}
    if universe:
        route_rows = (
            db.query(RoutePdvModel.PdvId, RouteModel.RouteId, RouteModel.Name)
            .join(RouteModel, RouteModel.RouteId == RoutePdvModel.RouteId)
            .filter(
                RouteModel.IsFocus == True, RouteModel.IsActive == True,  # noqa: E712
                RouteModel.AssignedUserId == user_id, RoutePdvModel.PdvId.in_(universe),
            )
            .all()
        )
        for pdv_id, r_id, r_name in route_rows:
            if route_id is not None and r_id != route_id:
                continue
            route_by_pdv.setdefault(pdv_id, (r_id, r_name))

    if route_id is not None:
        universe = {pdv_id for pdv_id in universe if pdv_id in route_by_pdv}

    coverage_scores = pdv_coverage_scores(db, user_id, year, month)
    communication_scores = pdv_communication_scores(db, user_id, year, month)

    start, end = _month_bounds(year, month)
    last_visit_by_pdv: dict[int, datetime] = {}
    if universe:
        for pdv_id, last_ts in (
            db.query(VisitModel.PdvId, func.max(VisitModel.OpenedAt))
            .filter(
                VisitModel.UserId == user_id, VisitModel.PdvId.in_(universe),
                VisitModel.OpenedAt >= start, VisitModel.OpenedAt < end,
            )
            .group_by(VisitModel.PdvId)
            .all()
        ):
            last_visit_by_pdv[pdv_id] = last_ts

    pdv_names = {}
    if universe:
        pdv_names = {p.PdvId: p.Name for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(universe)).all()}

    # scoreDist agregado sobre TODO el universo filtrado (no solo la página), para el
    # donut del prototipo — paginar la distribución la haría inconsistente entre páginas.
    score_dist: dict[str, dict[str, int]] = {"coverage": {}, "communication": {}}
    for pdv_id in universe:
        cov = coverage_scores.get(pdv_id, "sin_relevar")
        com = communication_scores.get(pdv_id, "sin_relevar")
        score_dist["coverage"][cov] = score_dist["coverage"].get(cov, 0) + 1
        score_dist["communication"][com] = score_dist["communication"].get(com, 0) + 1

    ordered_ids = sorted(universe, key=lambda pid: pdv_names.get(pid, ""))
    total = len(ordered_ids)
    offset = (page - 1) * page_size
    page_ids = ordered_ids[offset: offset + page_size]

    items = []
    for pdv_id in page_ids:
        r_id, r_name = route_by_pdv.get(pdv_id, (None, None))
        last_visit = last_visit_by_pdv.get(pdv_id)
        items.append({
            "pdvId": pdv_id,
            "name": pdv_names.get(pdv_id, f"PDV #{pdv_id}"),
            "route": r_name,
            "coverageScore": coverage_scores.get(pdv_id, "sin_relevar"),
            "communicationScore": communication_scores.get(pdv_id, "sin_relevar"),
            "lastVisit": last_visit.isoformat() if last_visit else None,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "scoreDist": score_dist,
    }


# ---------------------------------------------------------------------------
# GET /kpi/weekly-activity
# ---------------------------------------------------------------------------

def _visit_is_effective(db: Session, visit_id: int) -> bool:
    """Las 3 condiciones de visita efectiva (KPI 2, docs/tablero-tmr-diseno.md):
    cobertura + relevamiento POP + ≥1 acción DONE. A diferencia de
    `kpi_engine._kpi2_efectividad`, acá NO se exige que sea el día planificado —
    esta vista de actividad lista todas las visitas del mes, planificadas o no."""
    has_cov = db.query(VisitCoverageModel).filter(VisitCoverageModel.VisitId == visit_id).first() is not None
    has_pop = db.query(VisitPOPItemModel).filter(VisitPOPItemModel.VisitId == visit_id).first() is not None
    has_action = db.query(VisitActionModel).filter(
        VisitActionModel.VisitId == visit_id, VisitActionModel.Status == "DONE"
    ).first() is not None
    return has_cov and has_pop and has_action


@router.get("/weekly-activity")
def get_weekly_activity(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    user_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Actividad de visitas del mes agrupada por semana y día, con detalle por PDV
    (referencia funcional: DD.visits_semanal, docs/tablero-tmr-diseno.md). Todas las
    visitas del usuario en el mes, planificadas o no, en orden cronológico. Solo se
    devuelven semanas/días con al menos una visita."""
    visible = visible_user_ids(db, current_user)
    if visible is not None and user_id not in visible:
        raise HTTPException(403, "No tenés acceso a los datos de este usuario")

    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()

    start, end = _month_bounds(year, month)
    visits = (
        db.query(VisitModel)
        .filter(VisitModel.UserId == user_id, VisitModel.OpenedAt >= start, VisitModel.OpenedAt < end)
        .order_by(VisitModel.OpenedAt)
        .all()
    )

    pdv_ids = {v.PdvId for v in visits}
    pdv_names = {p.PdvId: p.Name for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()} if pdv_ids else {}

    # weekStart (lunes) -> dayDate -> lista de visitas de ese día, en orden cronológico
    weeks: dict[date, dict[date, list[VisitModel]]] = {}
    for v in visits:
        day = v.OpenedAt.date()
        week_start = _week_start(day)
        weeks.setdefault(week_start, {}).setdefault(day, []).append(v)

    result_weeks = []
    for week_start in sorted(weeks.keys()):
        days_map = weeks[week_start]
        # Lunes a domingo: los TMRs también visitan fines de semana; una etiqueta
        # Lun-Vie confunde cuando las visitas de la semana caen en sábado/domingo.
        week_end = week_start + timedelta(days=6)

        result_days = []
        total_visits = 0
        for day in sorted(days_map.keys()):
            day_visits = days_map[day]
            total_visits += len(day_visits)

            closed_at_list = [v.ClosedAt for v in day_visits if v.ClosedAt is not None]
            durations = [
                (v.ClosedAt - v.OpenedAt).total_seconds() / 60.0
                for v in day_visits if v.ClosedAt is not None
            ]

            result_days.append({
                "date": day.isoformat(),
                "dayLabel": f"{_WEEKDAY_ABBR_ES[day.weekday()]} {_day_short(day)}",
                "count": len(day_visits),
                "firstOpen": day_visits[0].OpenedAt.strftime("%H:%M"),
                "lastClose": max(closed_at_list).strftime("%H:%M") if closed_at_list else None,
                "avgDurationMin": round(sum(durations) / len(durations), 1) if durations else None,
                "visits": [
                    {
                        "pdvId": v.PdvId,
                        "pdvName": pdv_names.get(v.PdvId, f"PDV #{v.PdvId}"),
                        "openedAt": v.OpenedAt.strftime("%H:%M"),
                        "closedAt": v.ClosedAt.strftime("%H:%M") if v.ClosedAt else None,
                        "status": v.Status,
                        "effective": _visit_is_effective(db, v.VisitId),
                    }
                    for v in day_visits
                ],
            })

        result_weeks.append({
            "weekStart": week_start.isoformat(),
            "label": f"{_day_short(week_start)} – {_day_short(week_end)}",
            "totalVisits": total_visits,
            "days": result_days,
        })

    return {
        "userId": user_id,
        "name": user.DisplayName if user else None,
        "weeks": result_weeks,
    }


# ---------------------------------------------------------------------------
# GET /kpi/route-summary
# ---------------------------------------------------------------------------

@router.get("/route-summary")
def get_route_summary(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    target_ids = _resolve_target_user_ids(db, current_user, user_id)
    if not target_ids:
        return []

    routes = (
        db.query(RouteModel)
        .filter(
            RouteModel.IsFocus == True, RouteModel.IsActive == True,  # noqa: E712
            RouteModel.AssignedUserId.in_(target_ids),
        )
        .all()
    )
    if not routes:
        return []

    start, end = _month_bounds(year, month)
    communication_cache: dict[int, dict] = {}
    result = []

    for route in routes:
        pdv_ids = {
            rp.PdvId for rp in db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route.RouteId).all()
        }

        route_day_ids = [
            rd.RouteDayId for rd in
            db.query(RouteDayModel).filter(
                RouteDayModel.RouteId == route.RouteId,
                RouteDayModel.WorkDate >= start.date(), RouteDayModel.WorkDate < end.date(),
            )
        ]

        planned_pdv_ids: set = set()
        if route_day_ids:
            planned_pdv_ids = {
                rdp.PdvId for rdp in
                db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId.in_(route_day_ids)).all()
            }

        visited_pdv_ids: set = set()
        effective_pdv_ids: set = set()
        actions_count = 0
        if route_day_ids:
            visits = (
                db.query(VisitModel)
                .filter(
                    VisitModel.Status == "CLOSED",
                    VisitModel.UserId == route.AssignedUserId,
                    VisitModel.RouteDayId.in_(route_day_ids),
                )
                .all()
            )
            visit_ids = [v.VisitId for v in visits]
            for v in visits:
                if v.PdvId in planned_pdv_ids:
                    visited_pdv_ids.add(v.PdvId)
            if visit_ids:
                actions_count = (
                    db.query(VisitActionModel)
                    .filter(VisitActionModel.VisitId.in_(visit_ids), VisitActionModel.Status == "DONE")
                    .count()
                )
            for v in visits:
                if v.PdvId in effective_pdv_ids or v.PdvId not in planned_pdv_ids:
                    continue
                has_cov = db.query(VisitCoverageModel).filter(VisitCoverageModel.VisitId == v.VisitId).first() is not None
                has_pop = db.query(VisitPOPItemModel).filter(VisitPOPItemModel.VisitId == v.VisitId).first() is not None
                has_action = db.query(VisitActionModel).filter(
                    VisitActionModel.VisitId == v.VisitId, VisitActionModel.Status == "DONE"
                ).first() is not None
                if has_cov and has_pop and has_action:
                    effective_pdv_ids.add(v.PdvId)

        planned = len(planned_pdv_ids)
        effectiveness = round(100.0 * len(effective_pdv_ids) / planned, 2) if planned else 0.0

        comm_scores = communication_cache.get(route.AssignedUserId)
        if comm_scores is None:
            comm_scores = pdv_communication_scores(db, route.AssignedUserId, year, month)
            communication_cache[route.AssignedUserId] = comm_scores
        with_material = sum(1 for pid in pdv_ids if comm_scores.get(pid) in GOOD_OR_BETTER)

        loose_pdv_ids: set = set()
        if pdv_ids:
            loose_pdv_ids = {
                p.PdvId for p in
                db.query(PDVModel.PdvId).filter(PDVModel.PdvId.in_(pdv_ids), PDVModel.SellsLooseCigarettes == True)  # noqa: E712
            }

        with_exchange = 0
        for pdv_id in loose_pdv_ids:
            has_canje = (
                db.query(VisitActionModel)
                .join(VisitModel, VisitModel.VisitId == VisitActionModel.VisitId)
                .filter(
                    VisitModel.PdvId == pdv_id, VisitModel.UserId == route.AssignedUserId,
                    VisitModel.OpenedAt >= start, VisitModel.OpenedAt < end,
                    VisitActionModel.ActionType == "canje_sueltos", VisitActionModel.Status == "DONE",
                )
                .first() is not None
            )
            if has_canje:
                with_exchange += 1

        result.append({
            "routeId": route.RouteId,
            "name": route.Name,
            "pdvs": len(pdv_ids),
            "planned": planned,
            "visited": len(visited_pdv_ids),
            "effectiveness": effectiveness,
            "actions": actions_count,
            "withMaterial": with_material,
            "sellsLoose": len(loose_pdv_ids),
            "withExchange": with_exchange,
        })

    return result


# ---------------------------------------------------------------------------
# Higiene de precios — /kpi/price-matrix, /kpi/suspicious-prices
# ---------------------------------------------------------------------------

def _price_rows_for_users(db: Session, user_ids: list[int], year: int, month: int) -> list[dict]:
    """Precios relevados (`VisitCoverage.Price`) del mes para los usuarios dados, en
    el formato que espera `filter_price_outliers` (`price`/`product`), enriquecido
    con lo necesario para las dos respuestas de este router (`pdvId`/`pdvName`/
    `userId`/`userName`/`productId`/`date`)."""
    if not user_ids:
        return []
    start, end = _month_bounds(year, month)

    rows = (
        db.query(VisitCoverageModel, VisitModel, ProductModel)
        .join(VisitModel, VisitModel.VisitId == VisitCoverageModel.VisitId)
        .join(ProductModel, ProductModel.ProductId == VisitCoverageModel.ProductId)
        .filter(
            VisitModel.UserId.in_(user_ids),
            VisitModel.OpenedAt >= start, VisitModel.OpenedAt < end,
            VisitCoverageModel.Price.isnot(None),
        )
        .all()
    )
    if not rows:
        return []

    pdv_ids = {v.PdvId for _cov, v, _p in rows}
    pdv_names = {p.PdvId: p.Name for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()}
    row_user_ids = {v.UserId for _cov, v, _p in rows}
    user_names = {u.UserId: u.DisplayName for u in db.query(UserModel).filter(UserModel.UserId.in_(row_user_ids)).all()}

    return [
        {
            "price": float(cov.Price),
            "product": product.Name,
            "productId": product.ProductId,
            "pdvId": visit.PdvId,
            "pdvName": pdv_names.get(visit.PdvId),
            "userId": visit.UserId,
            "userName": user_names.get(visit.UserId),
            "date": visit.OpenedAt,
        }
        for cov, visit, product in rows
    ]


def _focus_route_by_user_pdv(db: Session, user_ids: list[int]) -> dict[tuple[int, int], tuple[int, str]]:
    """(userId, pdvId) -> (routeId, routeName) de la ruta foco activa de ese usuario
    que incluye ese PDV (misma convención que `route_by_pdv` de `/pdv-scoring`: si un
    PDV está en más de una ruta foco del mismo usuario, gana la primera)."""
    if not user_ids:
        return {}
    rows = (
        db.query(RoutePdvModel.PdvId, RouteModel.RouteId, RouteModel.Name, RouteModel.AssignedUserId)
        .join(RouteModel, RouteModel.RouteId == RoutePdvModel.RouteId)
        .filter(
            RouteModel.IsFocus == True, RouteModel.IsActive == True,  # noqa: E712
            RouteModel.AssignedUserId.in_(user_ids),
        )
        .all()
    )
    result: dict[tuple[int, int], tuple[int, str]] = {}
    for pdv_id, route_id, route_name, assigned_user_id in rows:
        result.setdefault((assigned_user_id, pdv_id), (route_id, route_name))
    return result


@router.get("/price-matrix")
def get_price_matrix(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    group_by: str = Query(default="user"),
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Matriz de precios relevados por producto x grupo (`route` = ruta foco del
    vendedor que incluye el PDV relevado, `user` = vendedor), con outliers y
    productos `TEST_` descartados por `filter_price_outliers` (motor de KPIs)."""
    if group_by not in ("route", "user"):
        raise HTTPException(422, "group_by debe ser route o user")

    target_ids = _resolve_target_user_ids(db, current_user, user_id)
    if not target_ids:
        return []

    price_rows = _price_rows_for_users(db, target_ids, year, month)
    valid, _discarded = filter_price_outliers(price_rows)

    route_by_user_pdv = _focus_route_by_user_pdv(db, target_ids) if group_by == "route" else {}

    agg: dict[tuple[int, str, int | None, str | None], list[float]] = {}
    for row in valid:
        if group_by == "route":
            group = route_by_user_pdv.get((row["userId"], row["pdvId"]))
            if group is None:
                continue
            group_id, group_name = group
        else:
            group_id, group_name = row["userId"], row["userName"]
        key = (row["productId"], row["product"], group_id, group_name)
        agg.setdefault(key, []).append(row["price"])

    items = [
        {
            "productId": product_id,
            "productName": product_name,
            "groupId": group_id,
            "groupName": group_name,
            "avg": round(sum(prices) / len(prices), 2),
            "min": min(prices),
            "max": max(prices),
            "n": len(prices),
        }
        for (product_id, product_name, group_id, group_name), prices in agg.items()
    ]
    items.sort(key=lambda it: (it["productName"], it["groupName"] or ""))
    return items


@router.get("/suspicious-prices")
def get_suspicious_prices(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Precios descartados por `filter_price_outliers` (fuera de `[0.25x, 4x]` la
    mediana de su producto, o producto `TEST_`), enriquecidos con PDV/vendedor/fecha
    y la mediana contra la que se descartaron."""
    target_ids = _resolve_target_user_ids(db, current_user, user_id)
    if not target_ids:
        return []

    price_rows = _price_rows_for_users(db, target_ids, year, month)
    _valid, discarded = filter_price_outliers(price_rows)

    by_product: dict[str, list[float]] = {}
    for row in price_rows:
        by_product.setdefault(row["product"], []).append(row["price"])
    medians = {product: median(prices) for product, prices in by_product.items()}

    items = [
        {
            "productName": row["product"],
            "price": row["price"],
            "medianPrice": round(medians[row["product"]], 2),
            "pdvId": row["pdvId"],
            "pdvName": row["pdvName"],
            "userId": row["userId"],
            "userName": row["userName"],
            "date": row["date"].isoformat(),
        }
        for row in sorted(discarded, key=lambda r: r["date"], reverse=True)
    ]
    return items


# ---------------------------------------------------------------------------
# POST /kpi/close-month — snapshot de cierre mensual (solo admin, T5)
# ---------------------------------------------------------------------------

@router.post("/close-month", dependencies=[Depends(require_role("admin"))])
def close_month(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """Congela `KpiMonthlySnapshot` para todos los usuarios con ≥1 ruta foco activa
    asignada. Solo meses ya terminados (mes en curso o futuro -> 422). Idempotente:
    si ya hay snapshots de ese (year, month) -> 409, salvo `force=true` que los borra
    y recalcula en vivo (al no quedar snapshot previo, `compute_kpis` calcula en vivo
    aunque el mes esté cerrado — ver kpi_engine.compute_kpis).

    Antes de tocar cualquier snapshot existente (incluso con `force=true`) se valida
    que al menos un usuario tenga config vigente (`resolve_config` no vacío) para ese
    mes: si NINGUNO tiene, 422 sin borrar nada (ver B3 de la auditoría del motor de
    KPIs). Si solo ALGUNOS tienen, se cierran esos y el resto se reporta en
    `usersSkipped`."""
    today = date.today()
    if (year, month) >= (today.year, today.month):
        raise HTTPException(422, "Solo se pueden cerrar meses ya terminados")

    user_ids = [
        r[0] for r in
        db.query(RouteModel.AssignedUserId)
        .filter(RouteModel.IsFocus == True, RouteModel.IsActive == True, RouteModel.AssignedUserId.isnot(None))  # noqa: E712
        .distinct()
        .all()
    ]

    users_with_config = []
    users_skipped = []
    for user_id in user_ids:
        configs, _warning = resolve_config(db, user_id, year, month)
        (users_with_config if configs else users_skipped).append(user_id)

    if not users_with_config:
        raise HTTPException(422, f"Sin configuración vigente para {year}-{month:02d}")

    existing_q = db.query(KpiMonthlySnapshotModel).filter(
        KpiMonthlySnapshotModel.Year == year, KpiMonthlySnapshotModel.Month == month,
    )
    if existing_q.first() is not None:
        if not force:
            raise HTTPException(409, f"Ya existe un cierre para {year}-{month:02d}. Usá ?force=true para regenerarlo.")
        existing_q.delete(synchronize_session=False)
        db.flush()

    def_ids_by_key = {d.KpiKey: d.KpiDefinitionId for d in db.query(KpiDefinitionModel).all()}

    snapshots_created = 0
    for user_id in users_with_config:
        result = compute_kpis(db, user_id, year, month)
        for k in result.kpis:
            definition_id = def_ids_by_key.get(k.key)
            if definition_id is None:
                continue
            db.add(KpiMonthlySnapshotModel(
                UserId=user_id, Year=year, Month=month, KpiDefinitionId=definition_id,
                Actual=k.actual, Target=k.target, Weight=k.weight, ScopeApplied=k.scope_applied,
                Achieved=k.achieved, Numerator=k.numerator, Denominator=k.denominator,
                FrozenAt=datetime.now(timezone.utc),
            ))
            snapshots_created += 1

    db.commit()

    return {
        "year": year,
        "month": month,
        "usersClosed": len(users_with_config),
        "snapshotsCreated": snapshots_created,
        "forced": force,
        "usersSkipped": users_skipped,
    }


# ---------------------------------------------------------------------------
# CRUD de configuración — solo admin
# ---------------------------------------------------------------------------

@router.get("/definitions", response_model=list[KpiDefinitionOut], dependencies=[Depends(require_role("territory_manager"))])
def list_kpi_definitions(db: Session = Depends(get_db)):
    return db.query(KpiDefinitionModel).order_by(KpiDefinitionModel.KpiDefinitionId).all()


@router.get("/config", response_model=list[KpiConfigOut], dependencies=[Depends(require_role("territory_manager"))])
def list_kpi_config(
    scope_type: str | None = Query(default=None),
    scope_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    # "Vigente" para este listado admin = sin fecha de cierre (ValidTo IS NULL). Un
    # DELETE (cierre de vigencia) setea ValidTo=hoy y la saca de este listado de
    # inmediato, aunque el día de hoy caiga dentro de [ValidFrom, ValidTo] — distinto
    # del filtro de `resolve_config` (kpi_engine.py), que evalúa vigencia en un
    # instante puntual del mes para calcular KPIs, no para administrar config.
    q = db.query(KpiConfigModel).filter(KpiConfigModel.ValidTo.is_(None))
    if scope_type is not None:
        q = q.filter(KpiConfigModel.ScopeType == scope_type)
    if scope_id is not None:
        q = q.filter(KpiConfigModel.ScopeId == scope_id)
    return q.order_by(KpiConfigModel.KpiConfigId).all()


def _affected_user_ids(db: Session, scope_type: str, scope_id: int | None) -> list[int]:
    if scope_type == "user":
        return [scope_id] if scope_id is not None else []
    if scope_type == "zone":
        return [u.UserId for u in db.query(UserModel.UserId).filter(UserModel.ZoneId == scope_id).all()]
    return [u.UserId for u in db.query(UserModel.UserId).all()]


def _validate_scope_type(scope_type: str, scope_id: int | None) -> None:
    if scope_type not in ("global", "zone", "user"):
        raise HTTPException(422, "ScopeType debe ser global, zone o user")
    if scope_type in ("zone", "user") and scope_id is None:
        raise HTTPException(422, f"ScopeId es requerido para ScopeType={scope_type}")


def _close_and_create_kpi_config(
    db: Session,
    definition_id: int,
    weight: int,
    target: float,
    scope_type: str,
    scope_id: int | None,
    created_by_user_id: int,
) -> KpiConfigModel:
    """Cierra la vigencia previa de (definition_id, scope) y crea la fila nueva —
    NO valida suma=100 (eso lo hace el caller, una sola vez, al final: así el POST
    individual valida tras un solo cambio y el bulk (`/config/bulk`) puede aplicar
    varios cambios del mismo alcance como una unidad sin que el estado intermedio
    entre items rompa la validación)."""
    definition = db.query(KpiDefinitionModel).filter(KpiDefinitionModel.KpiDefinitionId == definition_id).first()
    if not definition:
        raise HTTPException(404, "KPI no encontrado")

    today = date.today()
    scope_filter = KpiConfigModel.ScopeId.is_(None) if scope_id is None else KpiConfigModel.ScopeId == scope_id
    existing = db.query(KpiConfigModel).filter(
        KpiConfigModel.KpiDefinitionId == definition_id,
        KpiConfigModel.ScopeType == scope_type,
        scope_filter,
        KpiConfigModel.ValidTo.is_(None),
    ).all()
    for row in existing:
        row.ValidTo = today

    new_row = KpiConfigModel(
        KpiDefinitionId=definition_id, Weight=weight, Target=target,
        ScopeType=scope_type, ScopeId=scope_id, ValidFrom=today, ValidTo=None,
        CreatedByUserId=created_by_user_id,
    )
    db.add(new_row)
    db.flush()
    return new_row


def _bad_sum_100_users(db: Session, scope_type: str, scope_id: int | None) -> list[dict]:
    today = date.today()
    affected = _affected_user_ids(db, scope_type, scope_id)
    bad = []
    for uid in affected:
        configs, _warning = resolve_config(db, uid, today.year, today.month)
        total = sum(c.weight for c in configs)
        if total != 100:
            bad.append({"userId": uid, "total": total})
    return bad


@router.post("/config", response_model=KpiConfigOut, status_code=201, dependencies=[Depends(require_role("admin"))])
def create_kpi_config(
    data: KpiConfigCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    _validate_scope_type(data.ScopeType, data.ScopeId)

    new_row = _close_and_create_kpi_config(
        db, data.KpiDefinitionId, data.Weight, data.Target, data.ScopeType, data.ScopeId, current_user.UserId,
    )

    bad = _bad_sum_100_users(db, data.ScopeType, data.ScopeId)
    if bad:
        db.rollback()
        raise HTTPException(422, detail={
            "message": "La suma de pesos resuelta no da 100% para algunos usuarios afectados",
            "users": bad,
        })

    db.commit()
    db.refresh(new_row)
    return new_row


@router.post("/config/bulk", response_model=list[KpiConfigOut], status_code=201, dependencies=[Depends(require_role("admin"))])
def create_kpi_config_bulk(
    data: KpiConfigBulkCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Aplica varios cambios de peso/meta del MISMO alcance en una sola transacción:
    por cada item cierra la vigencia previa y crea la fila nueva (mismo helper que el
    POST individual), y valida suma=100 una única vez al final, contra el set
    resuelto de todos los usuarios afectados por el alcance. Pensado para permitir
    intercambiar peso entre 2+ KPIs sin que el primer cambio, evaluado aislado, deje
    la suma intermedia != 100 (ver docs/tablero-tmr-plan-fase1.md). Si algo falla
    (item con KPI inexistente o suma final != 100), rollback completo: nada queda
    aplicado."""
    _validate_scope_type(data.ScopeType, data.ScopeId)
    if not data.items:
        raise HTTPException(422, "items no puede estar vacío")

    try:
        new_rows = [
            _close_and_create_kpi_config(
                db, item.KpiDefinitionId, item.Weight, item.Target, data.ScopeType, data.ScopeId, current_user.UserId,
            )
            for item in data.items
        ]
    except HTTPException:
        db.rollback()
        raise

    bad = _bad_sum_100_users(db, data.ScopeType, data.ScopeId)
    if bad:
        db.rollback()
        raise HTTPException(422, detail={
            "message": "La suma de pesos resuelta no da 100% para algunos usuarios afectados",
            "users": bad,
        })

    db.commit()
    for row in new_rows:
        db.refresh(row)
    return new_rows


@router.delete("/config/{config_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_kpi_config(config_id: int, db: Session = Depends(get_db)):
    """Cierra la vigencia (ValidTo=hoy) y revalida que el set resuelto post-cierre siga
    sumando 100% para los usuarios afectados — misma semántica bloqueante que el POST
    (ver B2 de la auditoría del motor de KPIs): si no suma 100, se rechaza con 422 y el
    cierre NO se aplica."""
    row = db.query(KpiConfigModel).filter(KpiConfigModel.KpiConfigId == config_id).first()
    if not row:
        raise HTTPException(404, "Config no encontrada")

    today = date.today()
    row.ValidTo = today
    db.flush()

    affected = _affected_user_ids(db, row.ScopeType, row.ScopeId)
    bad = []
    for uid in affected:
        configs, _warning = resolve_config(db, uid, today.year, today.month)
        total = sum(c.weight for c in configs)
        if total != 100:
            bad.append({"userId": uid, "total": total})

    if bad:
        db.rollback()
        raise HTTPException(422, detail={
            "message": "La suma de pesos resuelta no da 100% para algunos usuarios afectados",
            "users": bad,
        })

    db.commit()


_SCORING_MODELS = {
    "coverage": (ScoringCoverageRuleModel, ScoringCoverageRuleCreate, ScoringCoverageRuleOut),
    "communication": (ScoringCommunicationRuleModel, ScoringCommunicationRuleCreate, ScoringCommunicationRuleOut),
}


def _scoring_model(rule_type: str):
    entry = _SCORING_MODELS.get(rule_type)
    if entry is None:
        raise HTTPException(422, "type debe ser coverage o communication")
    return entry


@router.get("/scoring-rules", dependencies=[Depends(require_role("territory_manager"))])
def list_scoring_rules(
    type: str = Query(...),
    db: Session = Depends(get_db),
):
    model, _create_schema, out_schema = _scoring_model(type)
    rows = db.query(model).filter(model.ValidTo.is_(None)).order_by(model.RuleId).all()
    return [out_schema.model_validate(r) for r in rows]


@router.post("/scoring-rules", status_code=201, dependencies=[Depends(require_role("admin"))])
def create_scoring_rule(
    type: str = Query(...),
    data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    model, create_schema, out_schema = _scoring_model(type)
    parsed = create_schema.model_validate(data)

    if parsed.ScopeType not in ("global", "zone", "user"):
        raise HTTPException(422, "ScopeType debe ser global, zone o user")
    if parsed.ScopeType in ("zone", "user") and parsed.ScopeId is None:
        raise HTTPException(422, f"ScopeId es requerido para ScopeType={parsed.ScopeType}")

    today = date.today()
    key_field = "Brand" if type == "coverage" else "MaterialType"
    scope_filter = model.ScopeId.is_(None) if parsed.ScopeId is None else model.ScopeId == parsed.ScopeId
    existing = db.query(model).filter(
        getattr(model, key_field) == getattr(parsed, key_field),
        model.Level == parsed.Level,
        model.ScopeType == parsed.ScopeType,
        scope_filter,
        model.ValidTo.is_(None),
    ).all()
    for row in existing:
        row.ValidTo = today

    kwargs = parsed.model_dump()
    kwargs["ValidFrom"] = today
    kwargs["ValidTo"] = None
    kwargs["CreatedByUserId"] = current_user.UserId
    new_row = model(**kwargs)
    db.add(new_row)
    db.commit()
    db.refresh(new_row)
    return out_schema.model_validate(new_row)


@router.delete("/scoring-rules/{rule_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_scoring_rule(
    rule_id: int,
    type: str = Query(...),
    db: Session = Depends(get_db),
):
    model, _create_schema, _out_schema = _scoring_model(type)
    row = db.query(model).filter(model.RuleId == rule_id).first()
    if not row:
        raise HTTPException(404, "Regla no encontrada")
    row.ValidTo = date.today()
    db.commit()


@router.get("/config/resolved")
def get_resolved_config(
    user_id: int | None = Query(default=None),
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Solo lectura: config resuelta (peso/meta ya aplicados) para un usuario, con la
    misma validación de visibilidad que el resto del router (TM ve su equipo,
    vendedor solo a sí mismo)."""
    target_user_id = user_id if user_id is not None else current_user.UserId
    visible = visible_user_ids(db, current_user)
    if visible is not None and target_user_id not in visible:
        raise HTTPException(403, "No tenés acceso a los datos de este usuario")

    today = date.today()
    y = year or today.year
    m = month or today.month

    configs, warning = resolve_config(db, target_user_id, y, m)
    return {
        "userId": target_user_id,
        "year": y,
        "month": m,
        "configs": [
            {
                "kpiDefinitionId": c.kpi_definition_id,
                "kpiKey": c.kpi_key,
                "name": c.name,
                "weight": c.weight,
                "target": c.target,
                "scopeApplied": c.scope_applied,
            }
            for c in configs
        ],
        "configWarning": warning,
    }
