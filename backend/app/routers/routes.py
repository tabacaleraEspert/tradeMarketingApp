import json as _json
from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from ..auth import require_role, get_current_user, get_user_role, ROLE_HIERARCHY
from ..database import get_db
from ..hierarchy import get_visible_user_ids, visible_user_ids, visible_pdv_ids, get_all_subordinate_ids
from ..models import (
    Route as RouteModel,
    RouteForm as RouteFormModel,
    RoutePdv as RoutePdvModel,
    RouteDay as RouteDayModel,
    RouteDayPdv as RouteDayPdvModel,
    PDV as PDVModel,
    User as UserModel,
)
from ..models.route import ROUTE_CAMPAIGN, ROUTE_REGULAR, route_is_live
from ..models.audit import AuditEvent as AuditEventModel
from ..models.channel import Channel as ChannelModel
from ..utils.pagination import Page, PageParams, make_page, paginate
from ..utils.ttl_cache import TTLCache
from ..schemas.form import Form as FormSchema
from ..schemas.route import (
    Route,
    RouteCreate,
    RouteUpdate,
    RouteFormCreate,
    RouteFormRead,
    RouteFormWithForm,
    RoutePdv,
    RoutePdvCreate,
    RouteDay,
    RouteDayCreate,
    RouteDayUpdate,
    RouteDayShiftWeekday,
    RouteDayPdv,
    RouteDayPdvCreate,
    RouteDayPdvUpdate,
)

router = APIRouter(prefix="/routes", tags=["Rutas"])

# Zonas Bejerman (hardcodeadas; futuro: DB externa)
BEJERMAN_ZONES = ["Litoral", "GBA Sur", "GBA Norte", "Patagonia"]


def _route_to_response(r: RouteModel, db: Session) -> Route:
    pdv_count = db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == r.RouteId).count()
    assigned_user_id = getattr(r, "AssignedUserId", None)
    assigned_user_name = None
    if assigned_user_id:
        user = db.query(UserModel).filter(UserModel.UserId == assigned_user_id).first()
        if user:
            assigned_user_name = user.DisplayName
    data = {
        "RouteId": r.RouteId,
        "Name": r.Name,
        "ZoneId": r.ZoneId,
        "FormId": r.FormId,
        "IsActive": r.IsActive,
        "BejermanZone": getattr(r, "BejermanZone", None),
        "FrequencyType": getattr(r, "FrequencyType", None),
        "FrequencyConfig": getattr(r, "FrequencyConfig", None),
        "EstimatedMinutes": getattr(r, "EstimatedMinutes", None),
        "AssignedUserId": assigned_user_id,
        "AssignedUserName": assigned_user_name,
        "IsOptimized": bool(getattr(r, "IsOptimized", False)),
        "IsFocus": bool(getattr(r, "IsFocus", True)),
        "RouteType": getattr(r, "RouteType", None) or ROUTE_REGULAR,
        "EndDate": getattr(r, "EndDate", None),
        "CreatedByUserId": getattr(r, "CreatedByUserId", None),
        "PdvCount": pdv_count,
        "CreatedAt": r.CreatedAt,
    }
    return Route.model_validate(data)


def _routes_to_response_batch(rs: list[RouteModel], db: Session) -> list[Route]:
    """Como _route_to_response pero con 2 queries totales en vez de 2 por ruta."""
    if not rs:
        return []
    ids = [r.RouteId for r in rs]
    counts = dict(
        db.query(RoutePdvModel.RouteId, func.count())
        .filter(RoutePdvModel.RouteId.in_(ids))
        .group_by(RoutePdvModel.RouteId)
        .all()
    )
    user_ids = {r.AssignedUserId for r in rs if getattr(r, "AssignedUserId", None)}
    names = dict(
        db.query(UserModel.UserId, UserModel.DisplayName)
        .filter(UserModel.UserId.in_(user_ids))
        .all()
    ) if user_ids else {}
    return [
        Route.model_validate({
            "RouteId": r.RouteId,
            "Name": r.Name,
            "ZoneId": r.ZoneId,
            "FormId": r.FormId,
            "IsActive": r.IsActive,
            "BejermanZone": getattr(r, "BejermanZone", None),
            "FrequencyType": getattr(r, "FrequencyType", None),
            "FrequencyConfig": getattr(r, "FrequencyConfig", None),
            "EstimatedMinutes": getattr(r, "EstimatedMinutes", None),
            "AssignedUserId": getattr(r, "AssignedUserId", None),
            "AssignedUserName": names.get(getattr(r, "AssignedUserId", None)),
            "IsOptimized": bool(getattr(r, "IsOptimized", False)),
            "IsFocus": bool(getattr(r, "IsFocus", True)),
            "RouteType": getattr(r, "RouteType", None) or ROUTE_REGULAR,
            "EndDate": getattr(r, "EndDate", None),
            "CreatedByUserId": getattr(r, "CreatedByUserId", None),
            "PdvCount": counts.get(r.RouteId, 0),
            "CreatedAt": r.CreatedAt,
        })
        for r in rs
    ]


def _visible_routes_query(db: Session, current_user):
    """Query base de rutas filtrada por la sub-jerarquía del usuario (admin → todas)."""
    role_name = get_user_role(db, current_user.UserId)
    visible_ids = get_visible_user_ids(db, current_user, role_name)
    q = db.query(RouteModel)
    if visible_ids is not None:
        q = q.filter(or_(
            RouteModel.AssignedUserId.in_(visible_ids),
            RouteModel.CreatedByUserId == current_user.UserId,
        ))
    return q


def _assert_route_access(
    db: Session,
    current_user: UserModel,
    route: RouteModel | None,
    data: "RouteCreate | RouteUpdate | None" = None,
) -> None:
    """Autoriza crear/editar una ruta (o tocar sus PDVs) según el rol de `current_user`.

    Cierra el bloqueante B1 (auditoría): antes cualquier vendedor podía editar cualquier
    ruta vía require_role("vendedor") sin validar propiedad.

    - admin / regional_manager / ejecutivo: sin restricciones.
    - territory_manager / supervisor: sólo rutas de su sub-árbol (get_all_subordinate_ids);
      si `data` reasigna AssignedUserId, el nuevo usuario también debe estar en el sub-árbol.
    - vendedor (y cualquier otro rol): sólo sus propias rutas (AssignedUserId == su UserId).
      Al crear, sólo puede asignarlas a sí mismo. Al editar, no puede cambiar IsFocus ni
      AssignedUserId (si `data` los incluye con un valor distinto al actual → 403; si vienen
      iguales o ausentes, se permite).

    `route=None` indica creación (la ruta todavía no existe). `data=None` indica que sólo se
    valida pertenencia (delete, alta/baja/reorder de PDVs) sin chequear campos del payload.
    """
    role = get_user_role(db, current_user.UserId)
    if role in ("admin", "regional_manager", "ejecutivo"):
        return

    if role in ("territory_manager", "supervisor"):
        allowed = get_all_subordinate_ids(db, current_user.UserId)
        allowed.add(current_user.UserId)
        if route is not None and route.AssignedUserId is not None and route.AssignedUserId not in allowed:
            raise HTTPException(403, "No tiene permiso sobre rutas fuera de su equipo")
        target = getattr(data, "AssignedUserId", None) if data is not None else None
        if target is not None and target not in allowed:
            raise HTTPException(403, "No puede asignar la ruta a un usuario fuera de su equipo")
        return

    # vendedor / rol por defecto: sólo sus propias rutas
    if route is None:
        target = getattr(data, "AssignedUserId", None) if data is not None else None
        if target is not None and target != current_user.UserId:
            raise HTTPException(403, "Sólo puede crear rutas asignadas a sí mismo")
        # Un vendedor no puede crear rutas foco (el universo foco lo define el equipo
        # de gestión). El schema trae IsFocus=True por default y los flujos de modo
        # campo (RouteGeneratorPage, "Mi ruta" en RouteEditorPage) no exponen ese campo
        # al vendedor y de hecho reenvían/heredan ese default -- así que en vez de 403
        # forzamos el valor efectivo a False, sin romper esos flujos.
        if data is not None and hasattr(data, "IsFocus"):
            data.IsFocus = False
        return

    if route.AssignedUserId != current_user.UserId:
        raise HTTPException(403, "No tiene permiso para modificar esta ruta")

    if data is not None:
        changes = data.model_dump(exclude_unset=True)
        if "IsFocus" in changes and bool(changes["IsFocus"]) != bool(route.IsFocus):
            raise HTTPException(403, "No puede modificar si la ruta es foco (IsFocus)")
        if "AssignedUserId" in changes and changes["AssignedUserId"] != route.AssignedUserId:
            raise HTTPException(403, "No puede reasignar esta ruta a otro usuario")


def _is_campaign(route: RouteModel | None) -> bool:
    return route is not None and (getattr(route, "RouteType", None) or ROUTE_REGULAR) == ROUTE_CAMPAIGN


def _start_date_of(freq_config: str | None) -> _date | None:
    try:
        raw = _json.loads(freq_config).get("startDate") if freq_config else None
        return _date.fromisoformat(raw) if raw else None
    except (ValueError, TypeError, AttributeError):
        return None


def _assert_campaign_rules(
    db: Session,
    current_user: UserModel,
    route: RouteModel | None,
    data: "RouteCreate | RouteUpdate | None" = None,
    allow_manager: bool = True,
) -> None:
    """Reglas de rutas de campaña y fecha de fin (se suman a `_assert_route_access`).

    - El tipo (regular/campaña) se elige al crear y no cambia.
    - Crear o borrar una campaña: solo admin. Editarla y tocar sus PDVs y días: admin, o el
      manager que tiene al asignado en su sub-árbol (12/11: Santiago gestiona las de cadenas
      de Martín sin ser admin). El trade asignado igual la ejecuta (visitas, estados del
      día) — esos endpoints no llaman acá — pero no la edita.
    - Campaña: nunca foco (fuera de KPI/TMR) y con fecha de fin obligatoria.
    - Fecha de fin >= fecha de inicio (`FrequencyConfig.startDate`) si hay inicio.
    """
    changes = data.model_dump(exclude_unset=True) if data is not None else {}
    if route is not None and changes.get("RouteType") not in (None, route.RouteType or ROUTE_REGULAR):
        raise HTTPException(400, "El tipo de ruta (regular / campaña) no se puede cambiar")
    campaign = _is_campaign(route) or (route is None and getattr(data, "RouteType", None) == ROUTE_CAMPAIGN)
    if campaign and get_user_role(db, current_user.UserId) != "admin":
        manages = (
            allow_manager and route is not None and route.AssignedUserId is not None
            and route.AssignedUserId in get_all_subordinate_ids(db, current_user.UserId)
        )
        if not manages:
            raise HTTPException(403, "Solo un admin o el responsable del equipo puede modificar rutas de campaña")
    if data is None:
        return
    if campaign and getattr(data, "IsFocus", None):
        data.IsFocus = False
    end = changes["EndDate"] if "EndDate" in changes else getattr(route, "EndDate", None)
    if campaign and end is None:
        raise HTTPException(400, "La ruta de campaña necesita fecha de fin")
    start = _start_date_of(changes["FrequencyConfig"] if "FrequencyConfig" in changes else getattr(route, "FrequencyConfig", None))
    if end is not None and start is not None and end < start:
        raise HTTPException(400, "La fecha de fin no puede ser anterior a la fecha de inicio")


def _is_field_campaign_runner(current_user: UserModel, route: RouteModel | None) -> bool:
    """Excepción de activaciones (User.VisitFlow == "short", ej. La Plata): el activador
    ejecuta por su cuenta las campañas vigentes de su zona — arrancar el día sin
    planificación previa y sumar PDVs dados de alta en el recorrido. No aplica al
    ciclo común de trade (VisitFlow "full"), que sigue con las reglas de campaña."""
    if getattr(current_user, "VisitFlow", None) != "short" or not _is_campaign(route):
        return False
    if not route.IsActive or (route.EndDate is not None and route.EndDate < _today_ar()):
        return False
    return route.AssignedUserId == current_user.UserId or (
        route.ZoneId is not None and route.ZoneId == current_user.ZoneId
    )


def _audit(db: Session, user: UserModel, action: str, route_id: int, payload: dict) -> None:
    """Rastro de cambios de rutas (quién, qué, antes/después) en AuditEvent.
    Va en la misma transacción que el cambio."""
    db.add(AuditEventModel(
        UserId=user.UserId, Entity="Route", EntityId=str(route_id), Action=action,
        PayloadJson=_json.dumps(payload, default=str, ensure_ascii=False),
    ))


def _without_visits(db: Session, day_ids: list[int]) -> list[int]:
    """Días planificados que se pueden borrar: los que ya tienen visitas (p.ej. el de
    hoy, empezado) quedan — borrarlos rompe el FK Visit.RouteDayId (500 al cambiar
    frecuencia con la ruta en curso, 29/10)."""
    if not day_ids:
        return []
    from ..models.visit import Visit as VisitModel
    with_visits = {
        row[0] for row in db.query(VisitModel.RouteDayId).filter(VisitModel.RouteDayId.in_(day_ids)).distinct()
    }
    return [d for d in day_ids if d not in with_visits]


def _delete_planned_days(db: Session, day_ids: list[int]) -> None:
    if day_ids:
        db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId.in_(day_ids)).delete(synchronize_session=False)
        db.query(RouteDayModel).filter(RouteDayModel.RouteDayId.in_(day_ids)).delete(synchronize_session=False)


def _route_snapshot(r: RouteModel) -> dict:
    return {k: getattr(r, k, None) for k in (
        "Name", "RouteType", "IsActive", "IsFocus", "AssignedUserId", "FrequencyType",
        "FrequencyConfig", "EndDate", "BejermanZone", "ZoneId",
    )}


# --- Zonas Bejerman ---
@router.get("/bejerman-zones")
def list_bejerman_zones():
    return {"zones": BEJERMAN_ZONES}


# --- PDV Assignments (literal path, must be declared before /{route_id}) ---
@router.get("/pdv-assignments", dependencies=[Depends(get_current_user)])
def pdv_assignments(db: Session = Depends(get_db)):
    """Mapping of PdvId -> RouteId for every PDV currently assigned to a route.
    Used by the route editor to enforce PDV exclusivity (a PDV can only belong to one route).
    """
    rows = (
        db.query(RoutePdvModel.PdvId, RoutePdvModel.RouteId, RouteModel.RouteType, RouteModel.Name, UserModel.DisplayName)
        .join(RouteModel, RouteModel.RouteId == RoutePdvModel.RouteId)
        .outerjoin(UserModel, UserModel.UserId == RouteModel.AssignedUserId)
        .all()
    )
    # routeType: solo las regulares son exclusivas (las campañas no bloquean ni son bloqueadas).
    return [
        {"pdvId": pid, "routeId": rid, "routeType": rtype or ROUTE_REGULAR, "routeName": rname, "assignedUserName": uname}
        for pid, rid, rtype, rname, uname in rows
    ]


# --- Today's executive overview ---
@router.get("/today-overview")
def today_overview(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Executive view: today's routes, assigned users, and first activity time (filtrado por jerarquía)."""
    from datetime import date, datetime, timezone
    from ..models.visit import Visit as VisitModel, VisitCheck as VisitCheckModel

    today = date.today()

    # 1. Route days for today (solo de usuarios visibles; admin ve todos)
    visible = visible_user_ids(db, current_user)
    rd_q = db.query(RouteDayModel).filter(RouteDayModel.WorkDate == today)
    if visible is not None:
        rd_q = rd_q.filter(RouteDayModel.AssignedUserId.in_(visible))
    route_days = rd_q.all()

    # 2. Get route names
    route_ids = {rd.RouteId for rd in route_days}
    routes_map = {r.RouteId: r for r in db.query(RouteModel).filter(RouteModel.RouteId.in_(route_ids)).all()} if route_ids else {}

    # 3. Get assigned user info
    user_ids = {rd.AssignedUserId for rd in route_days if rd.AssignedUserId}
    users_map = {u.UserId: u for u in db.query(UserModel).filter(UserModel.UserId.in_(user_ids)).all()} if user_ids else {}

    # 4. Count PDVs per route day
    day_ids = [rd.RouteDayId for rd in route_days]
    pdv_counts: dict[int, int] = {}
    if day_ids:
        from sqlalchemy import func as sqlfunc
        counts = db.query(RouteDayPdvModel.RouteDayId, sqlfunc.count()).filter(
            RouteDayPdvModel.RouteDayId.in_(day_ids)
        ).group_by(RouteDayPdvModel.RouteDayId).all()
        pdv_counts = {row[0]: row[1] for row in counts}

    # 5. Get today's visits and first check-in per user
    today_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    today_end = datetime(today.year, today.month, today.day, 23, 59, 59, tzinfo=timezone.utc)
    today_visits = db.query(VisitModel).filter(
        VisitModel.OpenedAt >= today_start,
        VisitModel.OpenedAt <= today_end,
    ).all()

    # First activity per user: earliest OpenedAt
    first_activity: dict[int, str] = {}
    visits_count: dict[int, int] = {}
    for v in today_visits:
        uid = v.UserId
        visits_count[uid] = visits_count.get(uid, 0) + 1
        ts = v.OpenedAt.isoformat() if v.OpenedAt else None
        if ts and (uid not in first_activity or ts < first_activity[uid]):
            first_activity[uid] = ts

    # Also check VisitChecks for check-in times (might be earlier than OpenedAt)
    visit_ids = [v.VisitId for v in today_visits]
    if visit_ids:
        checks = db.query(VisitCheckModel).filter(
            VisitCheckModel.VisitId.in_(visit_ids),
            VisitCheckModel.CheckType == "IN",
        ).all()
        # Map visit to user
        visit_user = {v.VisitId: v.UserId for v in today_visits}
        for c in checks:
            uid = visit_user.get(c.VisitId)
            if uid and c.Ts:
                ts = c.Ts.isoformat()
                if uid not in first_activity or ts < first_activity[uid]:
                    first_activity[uid] = ts

    # 6. Build response
    routes_list = []
    for rd in route_days:
        route = routes_map.get(rd.RouteId)
        user = users_map.get(rd.AssignedUserId) if rd.AssignedUserId else None
        uid = rd.AssignedUserId
        routes_list.append({
            "routeDayId": rd.RouteDayId,
            "routeId": rd.RouteId,
            "routeName": route.Name if route else f"Ruta #{rd.RouteId}",
            "userId": uid,
            "userName": user.DisplayName if user else None,
            "pdvCount": pdv_counts.get(rd.RouteDayId, 0),
            "firstActivity": first_activity.get(uid) if uid else None,
            "visitsToday": visits_count.get(uid, 0) if uid else 0,
            "started": uid in first_activity if uid else False,
        })

    # Sort: not started first, then by route name
    routes_list.sort(key=lambda r: (r["started"], r["routeName"] or ""))

    return {
        "date": today.isoformat(),
        "totalRoutes": len(routes_list),
        "totalStarted": sum(1 for r in routes_list if r["started"]),
        "routes": routes_list,
    }


# --- Route Map Overview ---
# Cache TTL del mapa de rutas: lo abren pocos usuarios y las rutas cambian
# poco. Key por usuario (respeta la jerarquía). Los endpoints que escriben
# Route/RoutePdv llaman a _MAP_CACHE.clear() para que la edición se vea al
# volver al mapa, no 5 minutos después.
_MAP_CACHE = TTLCache(ttl_seconds=300.0)

# Columnas del PDV que necesita el mapa (id, nombre, dirección, coordenadas y
# canal): traer la fila entera del ORM (34 columnas con JSONs) multiplicaba
# DB, red y serialización sin aportar nada.
_MAP_PDV_COLS = (
    PDVModel.PdvId,
    PDVModel.Name,
    PDVModel.Address,
    PDVModel.City,
    PDVModel.Lat,
    PDVModel.Lon,
    PDVModel.ChannelId,
    PDVModel.Channel,
)


def _map_pdv_dict(row, ch_map: dict) -> dict:
    return {
        "pdvId": row.PdvId,
        "name": row.Name,
        "address": row.Address or row.City or "",
        "lat": float(row.Lat) if row.Lat is not None else None,
        "lon": float(row.Lon) if row.Lon is not None else None,
        "channel": ch_map.get(row.ChannelId, row.Channel or ""),
    }


@router.get("/map-overview")
def routes_map_overview(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """All routes with their PDV coordinates for map visualization (filtrado por jerarquía)."""
    return _MAP_CACHE.get_or_build(
        ("map_overview", current_user.UserId),
        lambda: _build_map_overview(db, current_user),
    )


def _build_map_overview(db: Session, current_user) -> dict:
    # La lógica de conjuntos la resuelve la DB con joins/NOT EXISTS: nada de
    # IN/NOT IN con miles de parámetros (TDS timeout en S0, App Insights
    # 2026-09-04) ni de bajar la tabla PDV completa para filtrar en memoria.
    routes_q = db.query(RouteModel).filter(route_is_live())
    visible = visible_user_ids(db, current_user)
    if visible is not None:
        routes_q = routes_q.filter(RouteModel.AssignedUserId.in_(visible))
    routes = routes_q.all()
    if not routes:
        return {"routes": [], "unroutedPdvs": []}

    ch_map = {c.ChannelId: c.Name for c in db.query(ChannelModel).all()}

    # PDVs ruteados: RoutePdv ⋈ PDV ⋈ Route en UNA query con solo las columnas
    # del mapa (el inner join descarta RoutePdv huérfanos, igual que antes).
    routed_q = (
        db.query(RoutePdvModel.RouteId, RoutePdvModel.SortOrder, *_MAP_PDV_COLS)
        .join(PDVModel, PDVModel.PdvId == RoutePdvModel.PdvId)
        .join(RouteModel, RouteModel.RouteId == RoutePdvModel.RouteId)
        .filter(route_is_live())
    )
    if visible is not None:
        routed_q = routed_q.filter(RouteModel.AssignedUserId.in_(visible))
    routed_rows = routed_q.order_by(RoutePdvModel.RouteId, RoutePdvModel.SortOrder).all()

    route_pdvs_map: dict[int, list] = {}
    for row in routed_rows:
        route_pdvs_map.setdefault(row.RouteId, []).append(
            _map_pdv_dict(row, ch_map) | {"sortOrder": row.SortOrder}
        )

    # Batch-load all assigned users (1 query instead of N)
    user_ids = {r.AssignedUserId for r in routes if r.AssignedUserId}
    user_name_map: dict[int, str] = {}
    if user_ids:
        users = db.query(UserModel).filter(UserModel.UserId.in_(user_ids)).all()
        user_name_map = {u.UserId: u.DisplayName for u in users}

    route_list = []
    for r in routes:
        pdv_list = route_pdvs_map.get(r.RouteId)
        if not pdv_list:
            continue
        route_list.append({
            "routeId": r.RouteId,
            "name": r.Name,
            "assignedUserName": user_name_map.get(r.AssignedUserId) if r.AssignedUserId else None,
            "bejermanZone": getattr(r, "BejermanZone", None),
            "frequencyType": getattr(r, "FrequencyType", None),
            "frequencyConfig": getattr(r, "FrequencyConfig", None),
            "pdvs": pdv_list,
        })

    # PDVs sin ruta (huecos de cobertura): NOT EXISTS correlacionado — la DB
    # devuelve solo los sin ruta, con cero parámetros. Mismo alcance que
    # siempre: "ruteado" = presente en alguna ruta activa VISIBLE para este
    # usuario.
    en_alguna_ruta = (
        db.query(RoutePdvModel.PdvId)
        .join(RouteModel, RouteModel.RouteId == RoutePdvModel.RouteId)
        .filter(route_is_live(), RoutePdvModel.PdvId == PDVModel.PdvId)
    )
    if visible is not None:
        en_alguna_ruta = en_alguna_ruta.filter(RouteModel.AssignedUserId.in_(visible))
    unrouted_rows = (
        db.query(*_MAP_PDV_COLS)
        .filter(
            PDVModel.IsActive == True,
            PDVModel.Lat.isnot(None),
            ~en_alguna_ruta.exists(),
        )
        .all()
    )
    unrouted_list = [_map_pdv_dict(row, ch_map) for row in unrouted_rows]

    return {
        "routes": route_list,
        "unroutedPdvs": unrouted_list,
    }


# --- RouteDay (must be before /{route_id} to avoid path conflict) ---
@router.get("/all-days", response_model=list[RouteDay])
def list_all_route_days(
    user_id: int | None = None,
    db: Session = Depends(get_db),
):
    """All route days, optionally filtered by AssignedUserId. Single query replaces N+1."""
    q = db.query(RouteDayModel)
    if user_id is not None:
        q = q.filter(RouteDayModel.AssignedUserId == user_id)
    return q.all()


@router.get("/day-detail")
def route_day_detail(
    date: str,
    user_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Returns route days for a date with PDV details embedded. Replaces N+1 pattern."""
    # 1. Find matching route days
    q = db.query(RouteDayModel).filter(RouteDayModel.WorkDate == date)
    if user_id is not None:
        q = q.filter(RouteDayModel.AssignedUserId == user_id)
    route_days = q.all()
    if not route_days:
        return []

    # 2. Get route info
    route_ids = {rd.RouteId for rd in route_days}
    routes_map = {r.RouteId: r for r in db.query(RouteModel).filter(RouteModel.RouteId.in_(route_ids)).all()}

    # 3. Get day PDVs for all matching days
    day_ids = [rd.RouteDayId for rd in route_days]
    day_pdvs = db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId.in_(day_ids)).order_by(RouteDayPdvModel.PlannedOrder).all()

    # 4. Get all PDV details in one query
    pdv_ids = {dp.PdvId for dp in day_pdvs}
    pdvs_map = {p.PdvId: p for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()} if pdv_ids else {}

    # 5. Build response
    result = []
    seen_pdv_ids = set()
    for dp in day_pdvs:
        if dp.PdvId in seen_pdv_ids:
            continue
        seen_pdv_ids.add(dp.PdvId)
        pdv = pdvs_map.get(dp.PdvId)
        if not pdv:
            continue
        rd = next((rd for rd in route_days if rd.RouteDayId == dp.RouteDayId), None)
        route = routes_map.get(rd.RouteId) if rd else None
        result.append({
            "RouteDayId": dp.RouteDayId,
            "PdvId": dp.PdvId,
            "PlannedOrder": dp.PlannedOrder,
            "ExecutionStatus": dp.ExecutionStatus,
            "Priority": dp.Priority,
            "routeName": route.Name if route else None,
            "routeId": route.RouteId if route else None,
            "pdv": {
                "PdvId": pdv.PdvId, "Name": pdv.Name, "Address": pdv.Address,
                "Lat": pdv.Lat, "Lon": pdv.Lon, "ChannelId": pdv.ChannelId,
                "SubChannelId": pdv.SubChannelId, "ZoneId": pdv.ZoneId,
                "IsActive": pdv.IsActive, "BusinessName": pdv.BusinessName,
            },
        })
    return result


@router.get("/my-routes-detail")
def my_routes_detail(
    user_id: int,
    db: Session = Depends(get_db),
):
    """Returns all routes for a user with their PDVs embedded. Replaces N+1 pattern."""
    owned = RouteModel.AssignedUserId == user_id
    # Activadores (VisitFlow short): también las campañas vigentes de su zona, para
    # salir varios a una misma zona (ver _is_field_campaign_runner / start-today).
    u = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if u is not None and u.VisitFlow == "short" and u.ZoneId is not None:
        owned = or_(owned, (RouteModel.RouteType == ROUTE_CAMPAIGN) & (RouteModel.ZoneId == u.ZoneId) & (RouteModel.IsActive == True))  # noqa: E712
    routes = (
        db.query(RouteModel)
        .filter(
            owned,
            or_(RouteModel.EndDate.is_(None), RouteModel.EndDate >= _today_ar()),  # vencidas no se muestran
        )
        .order_by(RouteModel.RouteId)
        .all()
    )
    if not routes:
        return []

    route_ids = [r.RouteId for r in routes]
    # Get all route PDVs in one query
    all_rps = db.query(RoutePdvModel).filter(RoutePdvModel.RouteId.in_(route_ids)).order_by(RoutePdvModel.SortOrder).all()
    # Get all PDV details
    pdv_ids = {rp.PdvId for rp in all_rps}
    pdvs_map = {p.PdvId: p for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()} if pdv_ids else {}

    # Get next scheduled day per route (today or future)
    from datetime import date
    today = date.today()
    next_days = db.query(
        RouteDayModel.RouteId,
        RouteDayModel.WorkDate,
    ).filter(
        RouteDayModel.RouteId.in_(route_ids),
        RouteDayModel.WorkDate >= today,
        RouteDayModel.Status == "PLANNED",
    ).order_by(RouteDayModel.WorkDate).all()
    # First upcoming day per route
    next_day_map: dict[int, str] = {}
    for rid, wdate in next_days:
        if rid not in next_day_map:
            next_day_map[rid] = wdate.isoformat() if hasattr(wdate, "isoformat") else str(wdate)

    result = []
    for r in routes:
        rps = [rp for rp in all_rps if rp.RouteId == r.RouteId]
        pdvs = []
        for rp in rps:
            pdv = pdvs_map.get(rp.PdvId)
            if pdv:
                pdvs.append({
                    "PdvId": pdv.PdvId, "Name": pdv.Name, "Address": pdv.Address,
                    "Lat": pdv.Lat, "Lon": pdv.Lon, "ChannelId": pdv.ChannelId,
                    "SubChannelId": pdv.SubChannelId, "ZoneId": pdv.ZoneId,
                    "IsActive": pdv.IsActive, "BusinessName": pdv.BusinessName,
                    "SortOrder": rp.SortOrder, "Priority": rp.Priority,
                })
        result.append({
            "RouteId": r.RouteId, "Name": r.Name, "PdvCount": len(rps),
            "AssignedUserId": r.AssignedUserId,
            "BejermanZone": r.BejermanZone, "FrequencyType": r.FrequencyType,
            "EstimatedMinutes": r.EstimatedMinutes, "IsOptimized": r.IsOptimized,
            "RouteType": r.RouteType or ROUTE_REGULAR,
            "EndDate": r.EndDate.isoformat() if r.EndDate else None,
            "nextDay": next_day_map.get(r.RouteId),
            "pdvs": pdvs,
        })
    # Sort: today first, then nearest future day, then no day (sin definir) at the end
    result.sort(key=lambda r: r["nextDay"] or "9999-99-99")
    return result


# --- Tablero de control de rutas (semana × trade) ---
BOARD_MAX_DAYS = 14


def _day_has_progress(db: Session, route_day_id: int) -> bool:
    """True si el día ya se ejecutó en parte: tiene visitas o algún PDV salió de PENDING."""
    if not _without_visits(db, [route_day_id]):
        return True
    return db.query(RouteDayPdvModel.PdvId).filter(
        RouteDayPdvModel.RouteDayId == route_day_id,
        RouteDayPdvModel.ExecutionStatus != "PENDING",
    ).first() is not None


def _assert_user_visible(db: Session, current_user: UserModel, target_user_id: int) -> UserModel:
    """El trade destino existe, está activo y cae dentro de la jerarquía del que opera."""
    target = db.query(UserModel).filter(UserModel.UserId == target_user_id).first()
    if not target or not target.IsActive:
        raise HTTPException(status_code=400, detail="El Trade Marketer destino no existe o está inactivo")
    visible = visible_user_ids(db, current_user)
    if visible is not None and target_user_id not in visible:
        raise HTTPException(status_code=403, detail="No puede asignar días a un usuario fuera de su equipo")
    return target


def _get_day_and_route(db: Session, current_user: UserModel, route_day_id: int) -> tuple[RouteDayModel, RouteModel]:
    rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == route_day_id).first()
    if not rd:
        raise HTTPException(status_code=404, detail="Día de ruta no encontrado")
    route = db.query(RouteModel).filter(RouteModel.RouteId == rd.RouteId).first()
    if not route:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    visible = visible_user_ids(db, current_user)
    if visible is not None and rd.AssignedUserId not in visible and route.AssignedUserId not in visible:
        raise HTTPException(status_code=403, detail="No tiene permiso sobre días fuera de su equipo")
    return rd, route


def _assert_planner(db: Session, current_user: UserModel) -> None:
    """Mover días o achicarlos es planificación del equipo (territory_manager o superior).
    Un trade no reprograma ni recorta sus propios días: eso cambia el denominador del
    KPI de cumplimiento (RouteDayPdv del mes)."""
    role = (get_user_role(db, current_user.UserId) or "").lower()
    if ROLE_HIERARCHY.get(role, 0) < ROLE_HIERARCHY["territory_manager"]:
        raise HTTPException(status_code=403, detail="Solo un responsable de equipo puede reprogramar días de ruta")


def _assert_day_editable(db: Session, rd: RouteDayModel, *, deleting: bool = False) -> None:
    """Guarda única del tablero (espejo de `locked`): un día que ya pasó no se toca
    (ni sumar/quitar PDVs ni borrarlo); para borrarlo además tiene que estar PLANIFICADO
    y sin ejecución (visitas o PDVs empezados)."""
    if rd.WorkDate < _today_ar():
        raise HTTPException(status_code=409, detail="El día ya pasó: no se puede modificar")
    if deleting and (rd.Status != "PLANNED" or _day_has_progress(db, rd.RouteDayId)):
        raise HTTPException(status_code=409, detail="El día ya tiene visitas cargadas o está en curso, no se puede borrar")


def _assert_day_owner(route: RouteModel | None, user_id: int) -> None:
    """Un día de ruta es del trade dueño de la ruta. "Prestar" un solo día a otro trade
    todavía no está disponible: el otro no ve esos PDVs (visible_pdv_ids mira el dueño del
    PDV / de la ruta) y sus visitas no cuentan para nadie en el KPI. Para cambiar de trade
    se reasigna la ruta entera. (start-today de activadores no pasa por acá.)"""
    if route is not None and route.AssignedUserId is not None and user_id != route.AssignedUserId:
        raise HTTPException(
            status_code=400,
            detail="Todavía no se puede asignar un solo día a otro trade: reasigná toda la ruta",
        )


def _reassign_route_cascade(db: Session, r: RouteModel, new_user: int | None, today: _date) -> None:
    """Efectos de cambiar el trade de una ruta (ya seteado en `r.AssignedUserId`): dueño de
    los PDVs (salvo campaña) y días futuros PLANIFICADOS. Lo usan PATCH /routes/{id} y el
    cambio de día de la semana con reasignación (una sola transacción)."""
    # En una campaña el dueño de los PDVs no cambia (siguen siendo del trade de su ruta regular).
    if not _is_campaign(r):
        pdv_ids = [
            row[0]
            for row in db.query(RoutePdvModel.PdvId).filter(RoutePdvModel.RouteId == r.RouteId).all()
        ]
        if pdv_ids:
            db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).update(
                {PDVModel.AssignedUserId: new_user}, synchronize_session=False
            )
    # Update future PLANNED RouteDays
    future_days = db.query(RouteDayModel).filter(
        RouteDayModel.RouteId == r.RouteId,
        RouteDayModel.WorkDate >= today,
        RouteDayModel.Status == "PLANNED",
    ).all()
    if new_user is None:
        # Desasignar: borrar días futuros planificados (hijos primero por FK)
        _delete_planned_days(db, _without_visits(db, [fd.RouteDayId for fd in future_days]))
    else:
        # Reasignar: actualizar AssignedUserId en días futuros
        for fd in future_days:
            fd.AssignedUserId = new_user


@router.get("/board", dependencies=[Depends(require_role("territory_manager"))])
def routes_board(
    date_from: _date,
    date_to: _date,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Tablero de control: trades (filas) × días planificados (RouteDay) del rango.

    Cantidad fija de queries (no depende de la cantidad de trades ni de días): usuarios,
    zonas, roles, días+ruta, conteos de PDVs por día, días con visitas y rutas vigentes.
    Filtrado por jerarquía (admin ve todo; el resto, su sub-árbol)."""
    from ..models.user import Role as RoleModel, UserRole as UserRoleModel
    from ..models.visit import Visit as VisitModel
    from ..models.zone import Zone as ZoneModel
    from sqlalchemy import case

    if date_to < date_from:
        raise HTTPException(status_code=400, detail="date_to no puede ser anterior a date_from")
    if (date_to - date_from).days >= BOARD_MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"El rango máximo es de {BOARD_MAX_DAYS} días")

    visible = visible_user_ids(db, current_user)
    today = _today_ar()

    users = db.query(
        UserModel.UserId, UserModel.DisplayName, UserModel.ZoneId, UserModel.ManagerUserId, UserModel.IsActive,
    ).all()
    user_by_id = {u.UserId: u for u in users}
    zone_names = dict(db.query(ZoneModel.ZoneId, ZoneModel.Name).all())
    role_by_user: dict[int, str] = {}
    for uid, rname in (
        db.query(UserRoleModel.UserId, RoleModel.Name).join(RoleModel, RoleModel.RoleId == UserRoleModel.RoleId).all()
    ):
        role_by_user.setdefault(uid, rname)

    in_range = (RouteDayModel.WorkDate >= date_from, RouteDayModel.WorkDate <= date_to)
    day_scope = in_range if visible is None else (*in_range, RouteDayModel.AssignedUserId.in_(visible))

    day_rows = (
        db.query(RouteDayModel, RouteModel)
        .join(RouteModel, RouteModel.RouteId == RouteDayModel.RouteId)
        .filter(*day_scope)
        .order_by(RouteDayModel.WorkDate, RouteModel.Name, RouteDayModel.RouteDayId)
        .all()
    )
    counts = {
        day_id: (int(total or 0), int(done or 0), int(started or 0))
        for day_id, total, done, started in (
            db.query(
                RouteDayPdvModel.RouteDayId,
                func.count(),
                func.sum(case((RouteDayPdvModel.ExecutionStatus == "DONE", 1), else_=0)),
                func.sum(case((RouteDayPdvModel.ExecutionStatus != "PENDING", 1), else_=0)),
            )
            .join(RouteDayModel, RouteDayModel.RouteDayId == RouteDayPdvModel.RouteDayId)
            .filter(*day_scope)
            .group_by(RouteDayPdvModel.RouteDayId)
            .all()
        )
    }
    with_visits = {
        row[0] for row in (
            db.query(VisitModel.RouteDayId)
            .join(RouteDayModel, RouteDayModel.RouteDayId == VisitModel.RouteDayId)
            .filter(*day_scope)
            .distinct()
            .all()
        )
    }

    # Rutas vigentes visibles (para el "+" de cada celda) con su cantidad de PDVs.
    pdv_count_sq = (
        db.query(RoutePdvModel.RouteId.label("rid"), func.count().label("n"))
        .group_by(RoutePdvModel.RouteId)
        .subquery()
    )
    live_q = (
        db.query(RouteModel, pdv_count_sq.c.n)
        .outerjoin(pdv_count_sq, pdv_count_sq.c.rid == RouteModel.RouteId)
        .filter(route_is_live(today))
    )
    if visible is not None:
        live_q = live_q.filter(or_(
            RouteModel.AssignedUserId.in_(visible),
            RouteModel.CreatedByUserId == current_user.UserId,
        ))

    def route_dict(r: RouteModel, pdv_count: int | None, live: bool) -> dict:
        return {
            "routeId": r.RouteId,
            "name": r.Name,
            "routeType": r.RouteType or ROUTE_REGULAR,
            "assignedUserId": r.AssignedUserId,
            "zoneId": r.ZoneId,
            "frequencyType": r.FrequencyType,
            "frequencyConfig": r.FrequencyConfig,
            "endDate": r.EndDate.isoformat() if r.EndDate else None,
            "pdvCount": pdv_count,
            "isLive": live,
        }

    routes_out: dict[int, dict] = {}
    for r, n in live_q.all():
        routes_out[r.RouteId] = route_dict(r, int(n or 0), True)

    days_out = []
    for rd, r in day_rows:
        routes_out.setdefault(r.RouteId, route_dict(r, None, False))
        total, done, started = counts.get(rd.RouteDayId, (0, 0, 0))
        has_visits = rd.RouteDayId in with_visits
        days_out.append({
            "routeDayId": rd.RouteDayId,
            "routeId": r.RouteId,
            "routeName": r.Name,
            "routeType": r.RouteType or ROUTE_REGULAR,
            "workDate": rd.WorkDate.isoformat(),
            "userId": rd.AssignedUserId,
            "status": rd.Status,
            "pdvCount": total,
            "doneCount": done,
            "hasVisits": has_visits,
            # Se puede mover / borrar: planificado, de hoy en adelante y sin ejecución.
            "locked": has_visits or started > 0 or rd.Status != "PLANNED" or rd.WorkDate < today,
        })

    # Filas: trades de campo activos visibles + cualquiera con rutas vigentes o días en el rango.
    rep_ids = {d["userId"] for d in days_out}
    rep_ids |= {r["assignedUserId"] for r in routes_out.values() if r["isLive"] and r["assignedUserId"]}
    rep_ids |= {
        u.UserId for u in users
        if u.IsActive and role_by_user.get(u.UserId, "vendedor") == "vendedor"
    }
    if visible is not None:
        rep_ids &= visible
    reps_out = []
    for uid in rep_ids:
        u = user_by_id.get(uid)
        if u is None:
            continue
        mgr = user_by_id.get(u.ManagerUserId) if u.ManagerUserId else None
        reps_out.append({
            "userId": u.UserId,
            "name": u.DisplayName,
            "zoneId": u.ZoneId,
            "zoneName": zone_names.get(u.ZoneId) if u.ZoneId else None,
            "managerId": u.ManagerUserId,
            "managerName": mgr.DisplayName if mgr else None,
            "role": role_by_user.get(u.UserId, "vendedor"),
            "isActive": bool(u.IsActive),
        })
    reps_out.sort(key=lambda x: ((x["managerName"] or "~").lower(), (x["name"] or "").lower()))

    return {
        "dateFrom": date_from.isoformat(),
        "dateTo": date_to.isoformat(),
        "today": today.isoformat(),
        "reps": reps_out,
        "days": days_out,
        "routes": sorted(routes_out.values(), key=lambda x: (x["name"] or "").lower()),
    }


@router.get("/days/{route_day_id}/detail", dependencies=[Depends(require_role("territory_manager"))])
def route_day_board_detail(route_day_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    """Panel lateral del tablero: el día, su ruta, su trade y la lista ordenada de PDVs
    del día (RouteDayPdv) con estado de ejecución y si ya tienen visita."""
    from ..models.visit import Visit as VisitModel

    rd, route = _get_day_and_route(db, current_user, route_day_id)
    user = db.query(UserModel).filter(UserModel.UserId == rd.AssignedUserId).first()
    visited = {
        row[0] for row in db.query(VisitModel.PdvId).filter(VisitModel.RouteDayId == route_day_id).distinct().all()
    }
    rows = (
        db.query(RouteDayPdvModel, PDVModel.Name, PDVModel.Address, PDVModel.City)
        .join(PDVModel, PDVModel.PdvId == RouteDayPdvModel.PdvId)
        .filter(RouteDayPdvModel.RouteDayId == route_day_id)
        .order_by(RouteDayPdvModel.PlannedOrder, RouteDayPdvModel.PdvId)
        .all()
    )
    started = any(dp.ExecutionStatus != "PENDING" for dp, *_ in rows)
    return {
        "routeDayId": rd.RouteDayId,
        "routeId": route.RouteId,
        "routeName": route.Name,
        "routeType": route.RouteType or ROUTE_REGULAR,
        "frequencyType": route.FrequencyType,
        "frequencyConfig": route.FrequencyConfig,
        "endDate": route.EndDate.isoformat() if route.EndDate else None,
        "workDate": rd.WorkDate.isoformat(),
        "userId": rd.AssignedUserId,
        "userName": user.DisplayName if user else None,
        "status": rd.Status,
        "hasVisits": bool(visited),
        "locked": bool(visited) or started or rd.Status != "PLANNED" or rd.WorkDate < _today_ar(),
        "pdvs": [
            {
                "pdvId": dp.PdvId,
                "name": name,
                "address": address,
                "city": city,
                "plannedOrder": dp.PlannedOrder,
                "executionStatus": dp.ExecutionStatus,
                "hasVisit": dp.PdvId in visited,
            }
            for dp, name, address, city in rows
        ],
    }


@router.get("/days/{route_day_id}/pdv-candidates", dependencies=[Depends(require_role("territory_manager"))])
def route_day_pdv_candidates(
    route_day_id: int,
    q: str = "",
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """PDVs que se pueden sumar a ESTE día: los de la ruta que no están en el día y, después,
    los activos de la zona de la ruta. `q` busca por nombre / dirección / código."""
    rd, route = _get_day_and_route(db, current_user, route_day_id)
    in_day = db.query(RouteDayPdvModel.PdvId).filter(RouteDayPdvModel.RouteDayId == route_day_id)
    in_route = db.query(RoutePdvModel.PdvId).filter(RoutePdvModel.RouteId == route.RouteId)
    cols = (PDVModel.PdvId, PDVModel.Name, PDVModel.Address, PDVModel.City)
    base = db.query(*cols).filter(PDVModel.IsActive == True, ~PDVModel.PdvId.in_(in_day))  # noqa: E712
    term = q.strip()
    if term:
        like = f"%{term}%"
        base = base.filter(or_(PDVModel.Name.ilike(like), PDVModel.Address.ilike(like), PDVModel.Code.ilike(like)))

    def row(r, in_route_flag: bool) -> dict:
        return {"pdvId": r[0], "name": r[1], "address": r[2], "city": r[3], "inRoute": in_route_flag}

    # 1) Los de la ruta que faltan en el día: siempre todos (son pocos), sin tope.
    out = [row(r, True) for r in base.filter(PDVModel.PdvId.in_(in_route)).order_by(PDVModel.Name).all()]
    # 2) Se completa hasta `limit` con los de la zona; un no-admin solo ve los de su jerarquía
    #    (se filtra en Python: el set puede tener miles de ids, no entra en un IN de SQL Server).
    room = limit - len(out)
    if room > 0 and route.ZoneId is not None:
        visible = visible_pdv_ids(db, current_user)
        zone_q = base.filter(PDVModel.ZoneId == route.ZoneId, ~PDVModel.PdvId.in_(in_route)).order_by(PDVModel.Name)
        if visible is None:
            out += [row(r, False) for r in zone_q.limit(room).all()]
        else:
            for r in zone_q.limit(3000).all():
                if r[0] in visible:
                    out.append(row(r, False))
                    if len(out) >= limit:
                        break
    return out


# --- Route ---
@router.get("", response_model=list[Route])
def list_routes(
    skip: int = 0,
    limit: int = Query(default=100, le=500),
    created_by: int | None = None,
    assigned_user_id: int | None = None,
    route_type: str | None = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Lista rutas. Filtra automáticamente por la sub-jerarquía del usuario que pregunta:
    - admin → ve todas
    - territory_manager / ejecutivo → ve las asignadas a sí mismo o sus subordinados
    - vendedor (TM Rep) → sólo las asignadas a sí mismo
    """
    q = _visible_routes_query(db, current_user)
    if created_by is not None:
        q = q.filter(RouteModel.CreatedByUserId == created_by)
    if assigned_user_id is not None:
        q = q.filter(RouteModel.AssignedUserId == assigned_user_id)
    if route_type:
        q = q.filter(RouteModel.RouteType == route_type)

    routes = q.order_by(RouteModel.RouteId).offset(skip).limit(limit).all()
    return _routes_to_response_batch(routes, db)


@router.get("/admin-list", response_model=Page[Route])
def admin_list_routes(
    p: PageParams = Depends(),
    assigned_user_id: int | None = None,
    is_active: bool | None = None,
    route_type: str | None = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Lista paginada de rutas para /admin/routes (Gestión).

    Devuelve envelope {items, total, page, page_size, has_more}. ``q`` busca en
    nombre de ruta, TM asignado y zona Bejerman (ILIKE). Respeta jerarquía.
    """
    q = _visible_routes_query(db, current_user)
    if assigned_user_id is not None:
        q = q.filter(RouteModel.AssignedUserId == assigned_user_id)
    if is_active is not None:
        q = q.filter(RouteModel.IsActive == is_active)
    if route_type:
        q = q.filter(RouteModel.RouteType == route_type)
    if p.q:
        like = f"%{p.q}%"
        q = q.outerjoin(UserModel, RouteModel.AssignedUserId == UserModel.UserId).filter(or_(
            RouteModel.Name.ilike(like),
            RouteModel.BejermanZone.ilike(like),
            UserModel.DisplayName.ilike(like),
        ))
    items, total = paginate(q.order_by(RouteModel.RouteId), p)
    return make_page(_routes_to_response_batch(items, db), total, p)


@router.get("/my-forms", response_model=list[FormSchema])
def my_route_forms(db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    """Formularios activos de las rutas vigentes asignadas al usuario actual.

    Es lo que ve un usuario con VisitFlow="short" en la visita: SOLO los forms de
    SUS rutas (campaña o regular), no el catálogo nacional. Sin filtro por
    CreatedByUserId a propósito: el vendedor ve forms creados por un admin.
    Sin duplicados (un form en varias rutas aparece una vez), orden por
    RouteForm.SortOrder y FormId."""
    from ..models.form import Form as FormModel

    rows = (
        db.query(FormModel, RouteFormModel.SortOrder)
        .join(RouteFormModel, RouteFormModel.FormId == FormModel.FormId)
        .join(RouteModel, RouteModel.RouteId == RouteFormModel.RouteId)
        .filter(
            RouteModel.AssignedUserId == current_user.UserId,
            route_is_live(),
            FormModel.IsActive == True,  # noqa: E712
        )
        .order_by(RouteFormModel.SortOrder, FormModel.FormId)
        .all()
    )
    seen: set[int] = set()
    out: list[FormModel] = []
    for form, _sort in rows:
        if form.FormId in seen:
            continue
        seen.add(form.FormId)
        out.append(form)
    return out


@router.get("/stats")
def route_stats(db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Totales para las cards de /admin/routes — sin traer todas las rutas."""
    base = _visible_routes_query(db, current_user)
    total = base.count()
    active = base.filter(route_is_live()).count()  # noqa: E712
    visible_route_ids = base.with_entities(RouteModel.RouteId).scalar_subquery()
    total_pdvs = (
        db.query(func.count())
        .select_from(RoutePdvModel)
        .filter(RoutePdvModel.RouteId.in_(visible_route_ids))
        .scalar()
    ) or 0
    return {
        "total_routes": total,
        "active_routes": active,
        "total_pdvs_in_routes": total_pdvs,
        "avg_pdvs_per_route": round(total_pdvs / total) if total else 0,
    }


@router.get("/{route_id}", response_model=Route)
def get_route(route_id: int, db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    return _route_to_response(r, db)


@router.post("", response_model=Route, status_code=201, dependencies=[Depends(require_role("vendedor"))])
def create_route(data: RouteCreate, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    _assert_route_access(db, current_user, None, data)
    _assert_campaign_rules(db, current_user, None, data)
    r = RouteModel(
        Name=data.Name,
        ZoneId=data.ZoneId,
        FormId=data.FormId,
        IsActive=data.IsActive,
        # Si el front no manda CreatedByUserId, lo derivamos del usuario logueado para que
        # el creador siempre pueda ver su ruta (ver filtro en list_routes).
        CreatedByUserId=data.CreatedByUserId or current_user.UserId,
        AssignedUserId=data.AssignedUserId,
        BejermanZone=data.BejermanZone,
        FrequencyType=data.FrequencyType,
        FrequencyConfig=data.FrequencyConfig,
        EstimatedMinutes=data.EstimatedMinutes,
        IsFocus=data.IsFocus,
        RouteType=data.RouteType,
        EndDate=data.EndDate,
    )
    db.add(r)
    db.flush()
    _audit(db, current_user, "ROUTE_CREATE", r.RouteId, {"despues": _route_snapshot(r)})
    if data.FormId is not None:
        rf = RouteFormModel(RouteId=r.RouteId, FormId=data.FormId, SortOrder=0)
        db.add(rf)
    db.commit()
    _MAP_CACHE.clear()
    db.refresh(r)
    return _route_to_response(r, db)


@router.patch("/{route_id}", response_model=Route, dependencies=[Depends(require_role("vendedor"))])
def update_route(route_id: int, data: RouteUpdate, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    _assert_route_access(db, current_user, r, data)
    _assert_campaign_rules(db, current_user, r, data)
    update_data = data.model_dump(exclude_unset=True)
    update_data.pop("RouteType", None)
    before = _route_snapshot(r)

    # Detectar cambios reales comparando contra valores actuales
    old_assigned = r.AssignedUserId
    old_freq_type = r.FrequencyType
    old_freq_config = r.FrequencyConfig

    new_assigned_user = update_data.get("AssignedUserId", "__unchanged__")
    assigned_actually_changed = (
        new_assigned_user != "__unchanged__" and new_assigned_user != old_assigned
    )

    freq_actually_changed = (
        ("FrequencyType" in update_data and update_data["FrequencyType"] != old_freq_type)
        or ("FrequencyConfig" in update_data and update_data["FrequencyConfig"] != old_freq_config)
    )

    for k, v in update_data.items():
        setattr(r, k, v)

    # Propagar el cambio de Trade Marketer a todos los PDVs de la ruta
    today = _today_ar()

    if assigned_actually_changed:
        _reassign_route_cascade(db, r, new_assigned_user, today)

    # Si cambió la frecuencia DE VERDAD, borrar días futuros PLANNED para que el frontend regenere
    if freq_actually_changed:
        future_planned_ids = [
            d.RouteDayId for d in db.query(RouteDayModel).filter(
                RouteDayModel.RouteId == route_id,
                RouteDayModel.WorkDate >= today,
                RouteDayModel.Status == "PLANNED",
            ).all()
        ]
        _delete_planned_days(db, _without_visits(db, future_planned_ids))

    # Fecha de fin: los días planificados posteriores sobran.
    if r.EndDate is not None and r.EndDate != before["EndDate"]:
        beyond_ids = [
            d.RouteDayId for d in db.query(RouteDayModel).filter(
                RouteDayModel.RouteId == route_id,
                RouteDayModel.WorkDate > r.EndDate,
                RouteDayModel.WorkDate >= today,
                RouteDayModel.Status == "PLANNED",
            ).all()
        ]
        _delete_planned_days(db, _without_visits(db, beyond_ids))

    after = _route_snapshot(r)
    diff = [k for k in after if after[k] != before[k]]
    if diff:
        _audit(db, current_user, "ROUTE_UPDATE", route_id,
               {"antes": {k: before[k] for k in diff}, "despues": {k: after[k] for k in diff}})

    db.commit()
    _MAP_CACHE.clear()
    db.refresh(r)
    return _route_to_response(r, db)


@router.delete("/{route_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_route(route_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    _assert_campaign_rules(db, current_user, r, allow_manager=False)
    _audit(db, current_user, "ROUTE_DELETE", route_id, {"antes": _route_snapshot(r)})

    # PDVs keep their AssignedUserId — deleting a route does NOT unassign the TM.
    # Only removing a PDV from a route or explicitly unassigning clears the TM.

    # Manually delete children (MSSQL may not enforce CASCADE reliably via ORM)
    day_ids = [d.RouteDayId for d in db.query(RouteDayModel).filter(RouteDayModel.RouteId == route_id).all()]
    if day_ids:
        # SET NULL on Visits that reference these RouteDays (FK constraint)
        from ..models.visit import Visit as VisitModel
        db.query(VisitModel).filter(VisitModel.RouteDayId.in_(day_ids)).update(
            {VisitModel.RouteDayId: None}, synchronize_session=False
        )
        db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId.in_(day_ids)).delete(synchronize_session=False)
    db.query(RouteDayModel).filter(RouteDayModel.RouteId == route_id).delete(synchronize_session=False)
    db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id).delete(synchronize_session=False)
    db.query(RouteFormModel).filter(RouteFormModel.RouteId == route_id).delete(synchronize_session=False)

    # SET NULL on MandatoryActivity
    from ..models.mandatory_activity import MandatoryActivity as MandatoryActivityModel
    db.query(MandatoryActivityModel).filter(MandatoryActivityModel.RouteId == route_id).update(
        {MandatoryActivityModel.RouteId: None}, synchronize_session=False
    )

    db.delete(r)
    db.commit()
    _MAP_CACHE.clear()


# --- RoutePdv ---
@router.get("/{route_id}/pdvs", response_model=list[RoutePdv])
def list_route_pdvs(route_id: int, db: Session = Depends(get_db)):
    return db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id).order_by(RoutePdvModel.SortOrder).all()


@router.post("/{route_id}/pdvs", response_model=RoutePdv, status_code=201, dependencies=[Depends(require_role("vendedor"))])
def add_route_pdv(route_id: int, data: RoutePdvCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    route = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    if not _is_field_campaign_runner(current_user, route):
        _assert_route_access(db, current_user, route)
        _assert_campaign_rules(db, current_user, route)

    same = db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id, RoutePdvModel.PdvId == data.PdvId).first()
    if same:
        # Ya está en esta ruta — actualizar el SortOrder en vez de fallar (reordenamiento)
        same.SortOrder = data.SortOrder
        same.Priority = data.Priority
        db.commit()
        _MAP_CACHE.clear()
        db.refresh(same)
        return same

    # Exclusividad: un PDV está en una sola ruta REGULAR (no vencida). Las campañas
    # no bloquean ni son bloqueadas: usan PDVs de otras rutas sin quitárselos.
    if not _is_campaign(route):
        other = (
            db.query(RouteModel)
            .join(RoutePdvModel, RoutePdvModel.RouteId == RouteModel.RouteId)
            .filter(
                RoutePdvModel.PdvId == data.PdvId,
                RouteModel.RouteId != route_id,
                RouteModel.RouteType == ROUTE_REGULAR,
                or_(RouteModel.EndDate.is_(None), RouteModel.EndDate >= _today_ar()),
            )
            .first()
        )
        if other:
            raise HTTPException(
                status_code=409,
                detail=f"El PDV ya está asignado a la ruta '{other.Name}'. Quitalo primero de esa ruta.",
            )
    rp = RoutePdvModel(
        RouteId=route_id,
        PdvId=data.PdvId,
        SortOrder=data.SortOrder,
        Priority=data.Priority,
    )
    db.add(rp)

    # Auto-asignar Trade Marketer al PDV si la ruta tiene uno (task 13).
    # En campaña NO: el PDV sigue siendo del trade de su ruta regular.
    if route.AssignedUserId is not None and not _is_campaign(route):
        pdv = db.query(PDVModel).filter(PDVModel.PdvId == data.PdvId).first()
        if pdv:
            pdv.AssignedUserId = route.AssignedUserId

    # Cualquier modificación de PDVs invalida la optimización (task 11)
    route.IsOptimized = False

    _audit(db, current_user, "ROUTE_PDV_ADD", route_id, {"pdvId": data.PdvId})

    # Auto-add PDV to today's and future RouteDays (so it appears immediately in Home)
    today = _today_ar()
    future_days = (
        db.query(RouteDayModel)
        .filter(
            RouteDayModel.RouteId == route_id,
            RouteDayModel.WorkDate >= today,
        )
        .all()
    )
    for rd in future_days:
        exists = db.query(RouteDayPdvModel).filter(
            RouteDayPdvModel.RouteDayId == rd.RouteDayId,
            RouteDayPdvModel.PdvId == data.PdvId,
        ).first()
        if not exists:
            db.add(RouteDayPdvModel(
                RouteDayId=rd.RouteDayId,
                PdvId=data.PdvId,
                PlannedOrder=data.SortOrder,
                Priority=data.Priority or 3,
                ExecutionStatus="PENDING",
            ))

    db.commit()
    _MAP_CACHE.clear()
    db.refresh(rp)
    return rp


@router.delete("/{route_id}/pdvs/{pdv_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def remove_route_pdv(route_id: int, pdv_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    rp = db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id, RoutePdvModel.PdvId == pdv_id).first()
    if not rp:
        raise HTTPException(status_code=404, detail="PDV no encontrado en la ruta")
    route = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    _assert_route_access(db, current_user, route)
    _assert_campaign_rules(db, current_user, route)
    db.delete(rp)
    _audit(db, current_user, "ROUTE_PDV_DEL", route_id, {"pdvId": pdv_id})

    # NO tocar pdv.AssignedUserId: quitar un PDV de la ruta no desasigna al Trade Rep.

    # Limpiar RouteDayPdv de días futuros para este PDV
    future_day_ids = [
        rd.RouteDayId for rd in
        db.query(RouteDayModel).filter(
            RouteDayModel.RouteId == route_id,
            RouteDayModel.WorkDate >= _today_ar(),
        ).all()
    ]
    if future_day_ids:
        db.query(RouteDayPdvModel).filter(
            RouteDayPdvModel.RouteDayId.in_(future_day_ids),
            RouteDayPdvModel.PdvId == pdv_id,
        ).delete(synchronize_session=False)

    # Invalidar optimización (task 11)
    route.IsOptimized = False

    db.commit()
    _MAP_CACHE.clear()


@router.put("/{route_id}/pdvs/reorder", response_model=list[RoutePdv])
def reorder_route_pdvs(
    route_id: int,
    pdv_ids: list[int],
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reorder PDVs in a route. Receives the full list of PdvIds in the desired order."""
    if len(pdv_ids) > 500:
        raise HTTPException(400, "Demasiados PDVs para reordenar")
    route = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not route:
        raise HTTPException(404, "Ruta no encontrada")
    _assert_route_access(db, current_user, route)
    for i, pid in enumerate(pdv_ids):
        rp = db.query(RoutePdvModel).filter(
            RoutePdvModel.RouteId == route_id, RoutePdvModel.PdvId == pid
        ).first()
        if rp:
            rp.SortOrder = i
    route.IsOptimized = False

    # Sync PlannedOrder to future RouteDayPdv records
    today = _today_ar()
    future_day_ids = [
        rd.RouteDayId
        for rd in db.query(RouteDayModel).filter(
            RouteDayModel.RouteId == route_id,
            RouteDayModel.WorkDate >= today,
        ).all()
    ]
    if future_day_ids:
        order_map = {pid: i for i, pid in enumerate(pdv_ids)}
        future_rdps = db.query(RouteDayPdvModel).filter(
            RouteDayPdvModel.RouteDayId.in_(future_day_ids)
        ).all()
        for rdp in future_rdps:
            if rdp.PdvId in order_map:
                rdp.PlannedOrder = order_map[rdp.PdvId]

    db.commit()
    _MAP_CACHE.clear()
    return db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id).order_by(RoutePdvModel.SortOrder).all()


# --- RouteForm ---
@router.get("/{route_id}/forms", response_model=list[RouteFormWithForm])
def list_route_forms(route_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(RouteFormModel)
        .filter(RouteFormModel.RouteId == route_id)
        .order_by(RouteFormModel.SortOrder, RouteFormModel.FormId)
        .all()
    )
    return [RouteFormWithForm(RouteId=r.RouteId, FormId=r.FormId, SortOrder=r.SortOrder, Form=r.Form) for r in rows]


@router.post("/{route_id}/forms", response_model=RouteFormRead, status_code=201)
def add_route_form(
    route_id: int,
    data: RouteFormCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    from ..auth import get_user_role
    from ..models.form import Form as FormModel2

    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")

    # Check: if the form being added is NOT created by an admin,
    # enforce max 2 non-admin forms per route
    form = db.query(FormModel2).filter(FormModel2.FormId == data.FormId).first()
    if form and form.CreatedByUserId:
        creator_role = get_user_role(db, form.CreatedByUserId)
        if creator_role != "admin":
            # Count existing non-admin forms on this route
            existing_forms = (
                db.query(RouteFormModel)
                .join(FormModel2, FormModel2.FormId == RouteFormModel.FormId)
                .filter(
                    RouteFormModel.RouteId == route_id,
                    FormModel2.CreatedByUserId.isnot(None),
                )
                .all()
            )
            non_admin_count = sum(
                1 for ef in existing_forms
                if get_user_role(db, ef.Form.CreatedByUserId) != "admin"
            )
            if non_admin_count >= 2:
                raise HTTPException(
                    status_code=409,
                    detail="Máximo 2 formularios regionales por ruta. Los formularios nacionales (admin) no tienen límite.",
                )

    rf = RouteFormModel(RouteId=route_id, FormId=data.FormId, SortOrder=data.SortOrder)
    db.add(rf)
    db.commit()
    db.refresh(rf)
    return rf


@router.delete("/{route_id}/forms/{form_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def remove_route_form(route_id: int, form_id: int, db: Session = Depends(get_db)):
    rf = db.query(RouteFormModel).filter(
        RouteFormModel.RouteId == route_id,
        RouteFormModel.FormId == form_id,
    ).first()
    if not rf:
        raise HTTPException(status_code=404, detail="Formulario no encontrado en la ruta")
    db.delete(rf)
    db.commit()


@router.get("/{route_id}/days", response_model=list[RouteDay])
def list_route_days(route_id: int, db: Session = Depends(get_db)):
    return db.query(RouteDayModel).filter(RouteDayModel.RouteId == route_id).all()


@router.post("/{route_id}/days", response_model=RouteDay, status_code=201)
def create_route_day(route_id: int, data: RouteDayCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    _assert_route_access(db, current_user, r)
    _assert_campaign_rules(db, current_user, r)
    if r.EndDate is not None and data.WorkDate > r.EndDate:
        raise HTTPException(status_code=400, detail=f"La ruta termina el {r.EndDate.strftime('%d/%m/%Y')}")
    # Use route's assigned user if not specified
    user_id = data.AssignedUserId or getattr(r, "AssignedUserId", None)
    if not user_id:
        raise HTTPException(status_code=400, detail="Se requiere un Trade Marketer asignado")
    _assert_day_owner(r, user_id)
    if user_id != r.AssignedUserId:  # ruta sin asignar: el trade del día tiene que ser del equipo
        _assert_user_visible(db, current_user, user_id)
    # Una ruta no se planifica dos veces el mismo día para el mismo trade (los editores
    # generan en lote y saltean los errores; el tablero muestra el mensaje). Otro usuario sí
    # puede tener su día de la misma ruta esa fecha (activadores, start-today).
    if db.query(RouteDayModel.RouteDayId).filter(
        RouteDayModel.RouteId == route_id, RouteDayModel.WorkDate == data.WorkDate,
        RouteDayModel.AssignedUserId == user_id,
    ).first():
        raise HTTPException(status_code=409, detail=f"La ruta ya tiene un día planificado el {data.WorkDate.strftime('%d/%m/%Y')}")
    rd = RouteDayModel(
        RouteId=route_id,
        WorkDate=data.WorkDate,
        AssignedUserId=user_id,
        Status=data.Status,
    )
    db.add(rd)
    db.flush()  # para obtener RouteDayId
    # Copiar PDVs de la ruta al día
    route_pdvs = db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id).order_by(RoutePdvModel.SortOrder).all()
    for i, rp in enumerate(route_pdvs):
        rdp = RouteDayPdvModel(
            RouteDayId=rd.RouteDayId,
            PdvId=rp.PdvId,
            PlannedOrder=rp.SortOrder,
            Priority=rp.Priority,
        )
        db.add(rdp)
    if data.Origin:
        _audit(db, current_user, "ROUTE_DAY_CREATE", route_id, {
            "origen": data.Origin, "routeDayId": rd.RouteDayId,
            "despues": {"WorkDate": data.WorkDate, "AssignedUserId": user_id, "pdvs": len(route_pdvs)},
        })
    db.commit()
    _MAP_CACHE.clear()
    db.refresh(rd)
    return rd


@router.post("/{route_id}/start-today", response_model=RouteDay)
def start_route_today(route_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Activadores (VisitFlow short): entrar a una campaña de su zona sin día planificado.
    Crea (o reusa) el RouteDay de hoy para el usuario que la arranca, con los PDVs de la
    ruta — así Inicio, Ruta foco (mapa) y el avance funcionan igual que un día planificado."""
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    if not _is_field_campaign_runner(current_user, r):
        raise HTTPException(status_code=403, detail="Solo activadores, en campañas vigentes de su zona")
    today = _today_ar()
    rd = (
        db.query(RouteDayModel)
        .filter(RouteDayModel.RouteId == route_id, RouteDayModel.AssignedUserId == current_user.UserId,
                RouteDayModel.WorkDate == today)
        .first()
    )
    if rd:
        return rd
    rd = RouteDayModel(RouteId=route_id, WorkDate=today, AssignedUserId=current_user.UserId, Status="PLANNED")
    db.add(rd)
    db.flush()
    for rp in db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id).all():
        db.add(RouteDayPdvModel(RouteDayId=rd.RouteDayId, PdvId=rp.PdvId, PlannedOrder=rp.SortOrder, Priority=rp.Priority))
    _audit(db, current_user, "ROUTE_DAY_START", route_id, {"workDate": today.isoformat()})
    db.commit()
    db.refresh(rd)
    return rd


@router.delete("/days/{route_day_id}", status_code=204)
def delete_route_day(route_day_id: int, origin: str | None = None, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == route_day_id).first()
    if not rd:
        raise HTTPException(status_code=404, detail="Día de ruta no encontrado")
    route = db.query(RouteModel).filter(RouteModel.RouteId == rd.RouteId).first()
    if origin:
        # Baja desde el tablero: planificador, dentro de su jerarquía (también ejecutivo /
        # regional, a los que _assert_route_access deja pasar) y solo días sin ejecutar de
        # hoy en adelante. Sin `origin` (editores de ruta) el comportamiento no cambia.
        _assert_planner(db, current_user)
        _get_day_and_route(db, current_user, route_day_id)
        _assert_day_editable(db, rd, deleting=True)
    if route:
        _assert_route_access(db, current_user, route)
    if not _without_visits(db, [route_day_id]):
        raise HTTPException(status_code=409, detail="El día ya tiene visitas cargadas, no se puede borrar")
    if origin:
        # Baja manual desde el tablero de control (los editores regeneran en lote y no lo mandan).
        _audit(db, current_user, "ROUTE_DAY_DELETE", rd.RouteId, {
            "origen": origin, "routeDayId": rd.RouteDayId,
            "antes": {"WorkDate": rd.WorkDate, "AssignedUserId": rd.AssignedUserId, "Status": rd.Status},
        })
    db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId == route_day_id).delete()
    db.delete(rd)
    db.commit()
    _MAP_CACHE.clear()


@router.get("/days/{route_day_id}", response_model=RouteDay)
def get_route_day(route_day_id: int, db: Session = Depends(get_db)):
    rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == route_day_id).first()
    if not rd:
        raise HTTPException(status_code=404, detail="Día de ruta no encontrado")
    return rd


@router.get("/days/{route_day_id}/forms", response_model=list[RouteFormWithForm])
def list_route_day_forms(route_day_id: int, db: Session = Depends(get_db)):
    """Formularios de la ruta para un día (para Relevamiento)."""
    rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == route_day_id).first()
    if not rd:
        raise HTTPException(status_code=404, detail="Día de ruta no encontrado")
    rows = (
        db.query(RouteFormModel)
        .filter(RouteFormModel.RouteId == rd.RouteId)
        .order_by(RouteFormModel.SortOrder, RouteFormModel.FormId)
        .all()
    )
    return [RouteFormWithForm(RouteId=r.RouteId, FormId=r.FormId, SortOrder=r.SortOrder, Form=r.Form) for r in rows]


@router.patch("/days/{route_day_id}", response_model=RouteDay)
def update_route_day(route_day_id: int, data: RouteDayUpdate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == route_day_id).first()
    if not rd:
        raise HTTPException(status_code=404, detail="Día de ruta no encontrado")
    route = db.query(RouteModel).filter(RouteModel.RouteId == rd.RouteId).first()
    if route:
        _assert_route_access(db, current_user, route)

    # Mover SOLO este día (tablero de control): otra fecha y/o otro trade.
    new_date = data.WorkDate if data.WorkDate is not None and data.WorkDate != rd.WorkDate else None
    new_user = data.AssignedUserId if data.AssignedUserId is not None and data.AssignedUserId != rd.AssignedUserId else None
    if new_date is not None or new_user is not None:
        _assert_planner(db, current_user)
        _get_day_and_route(db, current_user, route_day_id)  # jerarquía (incluye ejecutivo / regional)
        if route:
            _assert_campaign_rules(db, current_user, route)
        today = _today_ar()
        if _day_has_progress(db, route_day_id) or rd.Status != "PLANNED":
            raise HTTPException(status_code=409, detail="El día ya tiene visitas o está en curso, no se puede mover")
        if rd.WorkDate < today:
            raise HTTPException(status_code=400, detail="No se puede mover un día que ya pasó")
        if new_date is not None:
            if new_date < today:
                raise HTTPException(status_code=400, detail="No se puede mover un día a una fecha pasada")
            if route and route.EndDate is not None and new_date > route.EndDate:
                raise HTTPException(status_code=400, detail=f"La ruta termina el {route.EndDate.strftime('%d/%m/%Y')}")
        if new_user is not None:
            _assert_day_owner(route, new_user)
            _assert_user_visible(db, current_user, new_user)
        target_date, target_user = new_date or rd.WorkDate, new_user or rd.AssignedUserId
        if db.query(RouteDayModel.RouteDayId).filter(
            RouteDayModel.RouteId == rd.RouteId,
            RouteDayModel.WorkDate == target_date,
            RouteDayModel.AssignedUserId == target_user,
            RouteDayModel.RouteDayId != route_day_id,
        ).first():
            raise HTTPException(status_code=409, detail=f"La ruta ya tiene un día planificado el {target_date.strftime('%d/%m/%Y')}")
        before = {"WorkDate": rd.WorkDate, "AssignedUserId": rd.AssignedUserId}
        if new_date is not None:
            rd.WorkDate = new_date
        if new_user is not None:
            rd.AssignedUserId = new_user
        after = {"WorkDate": rd.WorkDate, "AssignedUserId": rd.AssignedUserId}
        diff = [k for k in after if after[k] != before[k]]
        _audit(db, current_user, "ROUTE_DAY_MOVE", rd.RouteId, {
            "routeDayId": rd.RouteDayId,
            "antes": {k: before[k] for k in diff}, "despues": {k: after[k] for k in diff},
        })

    if data.Status is not None:
        rd.Status = data.Status
    db.commit()
    if new_date is not None or new_user is not None:
        _MAP_CACHE.clear()
    db.refresh(rd)
    return rd


def _monday_index(d: _date) -> int:
    return d.weekday()  # 0 = lunes … 6 = domingo


@router.post("/days/{route_day_id}/shift-weekday", dependencies=[Depends(require_role("territory_manager"))])
def shift_route_weekday(route_day_id: int, data: RouteDayShiftWeekday, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Tablero de control → "Toda la ruta de acá en adelante": cambia el día de la semana
    de la frecuencia (semanal / quincenal / días específicos) y corre a ese día los días
    PLANIFICADOS sin visitas desde el día arrastrado en adelante. Todo en una transacción.

    `data.WorkDate` es el destino del día arrastrado: misma semana (lun–dom), otro día.
    Días con visitas o ya empezados no se tocan; los que caerían después de la fecha de fin
    o sobre otro día ya planificado de la misma ruta se eliminan (quedarían duplicados)."""
    rd, route = _get_day_and_route(db, current_user, route_day_id)
    _assert_route_access(db, current_user, route)
    _assert_campaign_rules(db, current_user, route)
    # Reasignación en la misma transacción (soltar en otro día Y otro trade → "toda la ruta").
    new_owner = data.AssignedUserId if data.AssignedUserId is not None and data.AssignedUserId != route.AssignedUserId else None
    if new_owner is not None:
        _assert_route_access(db, current_user, route, RouteUpdate(AssignedUserId=new_owner))
        _assert_user_visible(db, current_user, new_owner)

    freq = route.FrequencyType
    if freq not in ("weekly", "biweekly", "specific_days"):
        raise HTTPException(status_code=400, detail="La frecuencia de esta ruta no tiene día de la semana: mové solo este día")
    today = _today_ar()
    src, dst = rd.WorkDate, data.WorkDate
    if src < today or dst < today:
        raise HTTPException(status_code=400, detail="No se pueden mover días que ya pasaron")
    delta = (dst - src).days
    if delta == 0 or (src - _timedelta(days=_monday_index(src))) != (dst - _timedelta(days=_monday_index(dst))):
        raise HTTPException(status_code=400, detail="El destino tiene que ser otro día de la misma semana")
    if _day_has_progress(db, route_day_id) or rd.Status != "PLANNED":
        raise HTTPException(status_code=409, detail="El día ya tiene visitas o está en curso, no se puede mover")
    if route.EndDate is not None and dst > route.EndDate:
        raise HTTPException(status_code=400, detail=f"La ruta termina el {route.EndDate.strftime('%d/%m/%Y')}")

    try:
        config = _json.loads(route.FrequencyConfig) if route.FrequencyConfig else {}
    except ValueError:
        config = {}
    js_from, js_to = (src.weekday() + 1) % 7, (dst.weekday() + 1) % 7  # JS: 0 = domingo
    before = _route_snapshot(route)
    if freq == "specific_days":
        days_cfg = list(config.get("days") or [])
        if js_from not in days_cfg:
            raise HTTPException(status_code=400, detail="Ese día no es parte de la frecuencia de la ruta: mové solo este día")
        if js_to in days_cfg:
            raise HTTPException(status_code=409, detail="La ruta ya se visita ese día de la semana")
        config["days"] = sorted(js_to if d == js_from else d for d in days_cfg)
    else:
        if config.get("day") != js_from:
            raise HTTPException(status_code=400, detail="Ese día no es parte de la frecuencia de la ruta: mové solo este día")
        config["day"] = js_to
        # Quincenal: la fase (qué semanas toca) se ancla en startDate; se corre igual que
        # los días para que al regenerar caiga en las mismas semanas.
        start = _start_date_of(route.FrequencyConfig)
        if freq == "biweekly" and start is not None:
            anchor = start + _timedelta(days=(js_from - (start.weekday() + 1) % 7) % 7)
            config["startDate"] = (anchor + _timedelta(days=delta)).isoformat()
    # Si el nuevo día cae antes del inicio de la ruta, el inicio se adelanta con él.
    start_now = _start_date_of(_json.dumps(config))
    if start_now is not None and dst < start_now:
        config["startDate"] = dst.isoformat()
    route.FrequencyConfig = _json.dumps(config)

    future = (
        db.query(RouteDayModel)
        .filter(RouteDayModel.RouteId == route.RouteId, RouteDayModel.WorkDate >= src, RouteDayModel.Status == "PLANNED")
        .order_by(RouteDayModel.WorkDate)
        .all()
    )
    # Solo los días del mismo trade que el arrastrado: los de otro usuario sobre la misma
    # ruta y fecha (activadores, start-today) no se mueven ni se borran.
    candidates = [d for d in future if d.WorkDate.weekday() == src.weekday() and d.AssignedUserId == rd.AssignedUserId]
    movable = set(_without_visits(db, [d.RouteDayId for d in candidates]))
    started = {
        row[0] for row in db.query(RouteDayPdvModel.RouteDayId).filter(
            RouteDayPdvModel.RouteDayId.in_(list(movable)), RouteDayPdvModel.ExecutionStatus != "PENDING",
        ).distinct()
    } if movable else set()
    movable -= started
    taken = {
        wd for (wd,) in db.query(RouteDayModel.WorkDate).filter(
            RouteDayModel.RouteId == route.RouteId, RouteDayModel.WorkDate >= today,
            RouteDayModel.AssignedUserId == rd.AssignedUserId,
        ).all()
    }
    moved, removed, kept = [], [], []
    for d in candidates:
        if d.RouteDayId not in movable:
            kept.append(d.WorkDate)
            continue
        target = d.WorkDate + _timedelta(days=delta)
        if target in taken or (route.EndDate is not None and target > route.EndDate):
            removed.append(d.RouteDayId)
            continue
        moved.append((d.WorkDate, target))
        taken.add(target)
        d.WorkDate = target
    _delete_planned_days(db, removed)

    antes = {"FrequencyConfig": before["FrequencyConfig"], "dias": [a for a, _ in moved]}
    despues = {"FrequencyConfig": route.FrequencyConfig, "dias": [b for _, b in moved]}
    if new_owner is not None:
        antes["AssignedUserId"], despues["AssignedUserId"] = route.AssignedUserId, new_owner
        route.AssignedUserId = new_owner
        db.flush()  # los días corridos ya tienen su fecha nueva antes de reasignarlos
        _reassign_route_cascade(db, route, new_owner, today)
    _audit(db, current_user, "ROUTE_SHIFT_WEEKDAY", route.RouteId, {
        "routeDayId": rd.RouteDayId,
        "antes": antes, "despues": despues,
        "eliminados": len(removed), "sinTocar": kept,
    })
    db.commit()
    _MAP_CACHE.clear()
    return {
        "routeId": route.RouteId,
        "frequencyType": freq,
        "frequencyConfig": route.FrequencyConfig,
        "assignedUserId": route.AssignedUserId,
        "moved": len(moved),
        "removed": len(removed),
        "kept": len(kept),
    }


# --- RouteDayPdv ---
@router.get("/days/{route_day_id}/pdvs", response_model=list[RouteDayPdv])
def list_route_day_pdvs(route_day_id: int, db: Session = Depends(get_db)):
    return db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId == route_day_id).order_by(RouteDayPdvModel.PlannedOrder).all()


@router.post("/days/{route_day_id}/pdvs", response_model=RouteDayPdv, status_code=201)
def add_route_day_pdv(route_day_id: int, data: RouteDayPdvCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    rd, route = _get_day_and_route(db, current_user, route_day_id)  # jerarquía (incluye ejecutivo / regional)
    _assert_route_access(db, current_user, route)
    _assert_campaign_rules(db, current_user, route)
    _assert_day_editable(db, rd)
    if db.query(RouteDayPdvModel.PdvId).filter(
        RouteDayPdvModel.RouteDayId == route_day_id, RouteDayPdvModel.PdvId == data.PdvId,
    ).first():
        raise HTTPException(status_code=409, detail="El PDV ya está en este día")
    if not db.query(PDVModel.PdvId).filter(PDVModel.PdvId == data.PdvId).first():
        raise HTTPException(status_code=404, detail="PDV no encontrado")
    # Solo PDVs de la propia ruta o dentro de la jerarquía del que opera.
    visible_pdvs = visible_pdv_ids(db, current_user)
    if visible_pdvs is not None and data.PdvId not in visible_pdvs and not db.query(RoutePdvModel.PdvId).filter(
        RoutePdvModel.RouteId == rd.RouteId, RoutePdvModel.PdvId == data.PdvId,
    ).first():
        raise HTTPException(status_code=403, detail="No tenés acceso a ese PDV")
    _audit(db, current_user, "ROUTE_DAY_PDV_ADD", rd.RouteId, {
        "routeDayId": route_day_id, "workDate": rd.WorkDate, "pdvId": data.PdvId,
    })
    rdp = RouteDayPdvModel(
        RouteDayId=route_day_id,
        PdvId=data.PdvId,
        PlannedOrder=data.PlannedOrder,
        PlannedWindowFrom=data.PlannedWindowFrom,
        PlannedWindowTo=data.PlannedWindowTo,
        Priority=data.Priority,
        ExecutionStatus=data.ExecutionStatus,
    )
    db.add(rdp)
    db.commit()
    db.refresh(rdp)
    return rdp


@router.delete("/days/{route_day_id}/pdvs/{pdv_id}", status_code=204)
def remove_route_day_pdv(route_day_id: int, pdv_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Saca un PDV de ESTE día solamente (la ruta y sus otros días no cambian)."""
    from ..models.visit import Visit as VisitModel

    _assert_planner(db, current_user)
    rd, route = _get_day_and_route(db, current_user, route_day_id)  # jerarquía (incluye ejecutivo / regional)
    _assert_route_access(db, current_user, route)
    _assert_campaign_rules(db, current_user, route)
    _assert_day_editable(db, rd)
    rdp = db.query(RouteDayPdvModel).filter(
        RouteDayPdvModel.RouteDayId == route_day_id,
        RouteDayPdvModel.PdvId == pdv_id,
    ).first()
    if not rdp:
        raise HTTPException(status_code=404, detail="PDV no encontrado en el día de ruta")
    has_visit = db.query(VisitModel.VisitId).filter(
        VisitModel.RouteDayId == route_day_id, VisitModel.PdvId == pdv_id,
    ).first() is not None
    if has_visit or rdp.ExecutionStatus != "PENDING":
        raise HTTPException(status_code=409, detail="El PDV ya tiene una visita ese día, no se puede quitar")
    _audit(db, current_user, "ROUTE_DAY_PDV_DEL", rd.RouteId, {
        "routeDayId": route_day_id, "workDate": rd.WorkDate, "pdvId": pdv_id,
        "antes": {"PlannedOrder": rdp.PlannedOrder, "ExecutionStatus": rdp.ExecutionStatus},
    })
    db.delete(rdp)
    db.commit()


@router.patch("/days/{route_day_id}/pdvs/{pdv_id}", response_model=RouteDayPdv)
def update_route_day_pdv(route_day_id: int, pdv_id: int, data: RouteDayPdvUpdate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    rdp = db.query(RouteDayPdvModel).filter(
        RouteDayPdvModel.RouteDayId == route_day_id,
        RouteDayPdvModel.PdvId == pdv_id,
    ).first()
    if not rdp:
        raise HTTPException(status_code=404, detail="PDV no encontrado en el día de ruta")
    if data.ExecutionStatus is not None:
        rdp.ExecutionStatus = data.ExecutionStatus
    db.commit()
    db.refresh(rdp)
    return rdp


# ── Traspaso masivo de cartera (solo admin) ─────────────
class PortfolioTransfer(BaseModel):
    """Exactamente uno de `from_user_id` (cartera completa) o `pdv_ids` (parcial)."""
    to_user_id: int
    from_user_id: int | None = None
    pdv_ids: list[int] | None = None
    dry_run: bool = True


def _chunks(ids: list[int], n: int = 900):
    # SQL Server admite ~2100 parámetros por sentencia
    for i in range(0, len(ids), n):
        yield ids[i:i + n]


@router.post("/transfer-portfolio", dependencies=[Depends(require_role("admin"))])
def transfer_portfolio(
    data: PortfolioTransfer,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pasa PDVs de un trade a otro sin armar rutas foco a mano.

    - Cartera completa (`from_user_id`): rutas regulares del origen + sus días futuros
      PLANNED + todos sus PDVs pasan al destino (las rutas siguen armadas).
    - Parcial (`pdv_ids`): los PDVs pasan al destino y salen de las rutas regulares que
      no sean del destino (y de sus días futuros pendientes); quedan en cartera sin ruta.
    Las rutas de campaña no se tocan. El historial de visitas no cambia de dueño.
    `dry_run` (default) devuelve el resumen sin escribir. Todo en una transacción + auditoría.
    """
    whole = data.from_user_id is not None
    if whole == bool(data.pdv_ids):
        raise HTTPException(status_code=422, detail="Indicar from_user_id (cartera completa) o pdv_ids (parcial), no ambos")
    to_user = db.query(UserModel).filter(UserModel.UserId == data.to_user_id).first()
    if not to_user or not to_user.IsActive:
        raise HTTPException(status_code=422, detail="El usuario destino no existe o está inactivo")
    to_id = to_user.UserId
    today = _today_ar()
    not_campaign = or_(RouteModel.RouteType.is_(None), RouteModel.RouteType != ROUTE_CAMPAIGN)

    if whole:
        if data.from_user_id == to_id:
            raise HTTPException(status_code=422, detail="Origen y destino son el mismo usuario")
        if not db.query(UserModel.UserId).filter(UserModel.UserId == data.from_user_id).first():
            raise HTTPException(status_code=404, detail="Usuario origen no encontrado")
        routes = db.query(RouteModel).filter(RouteModel.AssignedUserId == data.from_user_id, not_campaign).all()
        route_ids = [r.RouteId for r in routes]
        days = db.query(RouteDayModel).filter(
            RouteDayModel.RouteId.in_(route_ids), RouteDayModel.WorkDate >= today, RouteDayModel.Status == "PLANNED",
        ).all() if route_ids else []
        owners = {pid: data.from_user_id for (pid,) in
                  db.query(PDVModel.PdvId).filter(PDVModel.AssignedUserId == data.from_user_id).all()}
        summary = {
            "mode": "whole", "from_user_id": data.from_user_id, "to_user_id": to_id, "to_user_name": to_user.DisplayName,
            "pdvs": len(owners), "already_owned": 0,
            "routes": [{"RouteId": r.RouteId, "Name": r.Name, "pdvs": None} for r in routes],
            "future_days": len(days), "dry_run": data.dry_run,
        }
        if data.dry_run:
            return summary
        for r in routes:
            _audit(db, current_user, "ROUTE_UPDATE", r.RouteId, {
                "antes": {"AssignedUserId": r.AssignedUserId}, "despues": {"AssignedUserId": to_id},
                "motivo": "traspaso de cartera completa",
            })
            r.AssignedUserId = to_id
        for d in days:
            d.AssignedUserId = to_id
        db.query(PDVModel).filter(PDVModel.AssignedUserId == data.from_user_id).update(
            {PDVModel.AssignedUserId: to_id}, synchronize_session=False
        )
    else:
        ids = sorted(set(data.pdv_ids))
        owners: dict[int, int | None] = {}
        for ch in _chunks(ids):
            owners.update(db.query(PDVModel.PdvId, PDVModel.AssignedUserId).filter(PDVModel.PdvId.in_(ch)).all())
        missing = [i for i in ids if i not in owners]
        if missing:
            raise HTTPException(status_code=404, detail=f"PDVs inexistentes: {missing[:20]}")
        already = sum(1 for o in owners.values() if o == to_id)
        # Membresías en rutas regulares que no son del destino → el PDV sale de esas rutas
        foreign = or_(RouteModel.AssignedUserId.is_(None), RouteModel.AssignedUserId != to_id)
        by_route: dict[int, list[int]] = {}
        route_names: dict[int, str] = {}
        for ch in _chunks(ids):
            rows = (
                db.query(RoutePdvModel.RouteId, RoutePdvModel.PdvId, RouteModel.Name)
                .join(RouteModel, RouteModel.RouteId == RoutePdvModel.RouteId)
                .filter(RoutePdvModel.PdvId.in_(ch), not_campaign, foreign)
                .all()
            )
            for rid, pid, name in rows:
                by_route.setdefault(rid, []).append(pid)
                route_names[rid] = name
        summary = {
            "mode": "partial", "from_user_id": None, "to_user_id": to_id, "to_user_name": to_user.DisplayName,
            "pdvs": len(ids), "already_owned": already,
            "routes": [{"RouteId": rid, "Name": route_names[rid], "pdvs": len(p)} for rid, p in sorted(by_route.items())],
            "future_days": 0, "dry_run": data.dry_run,
        }
        if data.dry_run:
            return summary
        for rid, pids in by_route.items():
            day_ids = [d[0] for d in db.query(RouteDayModel.RouteDayId).filter(
                RouteDayModel.RouteId == rid, RouteDayModel.WorkDate >= today).all()]
            for ch in _chunks(pids):
                db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == rid, RoutePdvModel.PdvId.in_(ch)).delete(synchronize_session=False)
                if day_ids:
                    # Solo lo pendiente: lo ya ejecutado hoy queda para el contador del día
                    db.query(RouteDayPdvModel).filter(
                        RouteDayPdvModel.RouteDayId.in_(day_ids), RouteDayPdvModel.PdvId.in_(ch),
                        RouteDayPdvModel.ExecutionStatus == "PENDING",
                    ).delete(synchronize_session=False)
            db.query(RouteModel).filter(RouteModel.RouteId == rid).update({RouteModel.IsOptimized: False}, synchronize_session=False)
            _audit(db, current_user, "ROUTE_PDV_DEL", rid, {"pdvIds": pids, "motivo": f"traspaso a usuario {to_id}"})
        for ch in _chunks(ids):
            db.query(PDVModel).filter(PDVModel.PdvId.in_(ch)).update({PDVModel.AssignedUserId: to_id}, synchronize_session=False)

    # Resumen del traspaso: dueño anterior de cada PDV (antes) → destino (después)
    db.add(AuditEventModel(
        UserId=current_user.UserId, Entity="User", EntityId=str(to_id), Action="PDV_TRANSFER",
        PayloadJson=_json.dumps({
            "modo": summary["mode"], "hacia": to_id, "desde": data.from_user_id,
            "duenoAnterior": {str(k): v for k, v in owners.items()},
            "rutas": [r["RouteId"] for r in summary["routes"]],
        }, ensure_ascii=False),
    ))
    db.commit()
    _MAP_CACHE.clear()
    return summary


# ── Mover un PDV de ruta (Gestión de PDV) + re-optimización automática ──
def _optimize_route_order(db: Session, route: RouteModel) -> None:
    """Reordena los PDVs de la ruta por vecino más cercano (mismo criterio que el botón
    "Optimizar" del editor: arranca en el primero del orden actual; sin coordenadas al
    final) y lleva el orden a los días futuros que todavía no empezaron."""
    from ..utils.geo import haversine_km
    rows = (
        db.query(RoutePdvModel, PDVModel.Lat, PDVModel.Lon)
        .join(PDVModel, PDVModel.PdvId == RoutePdvModel.PdvId)
        .filter(RoutePdvModel.RouteId == route.RouteId)
        .order_by(RoutePdvModel.SortOrder, RoutePdvModel.PdvId)
        .all()
    )
    pending = [(rp, float(lat), float(lon)) for rp, lat, lon in rows if lat is not None and lon is not None]
    no_coords = [rp for rp, lat, lon in rows if lat is None or lon is None]
    ordered = []
    if pending:
        cur = pending.pop(0)
        ordered.append(cur[0])
        while pending:
            i = min(range(len(pending)), key=lambda k: haversine_km(cur[1], cur[2], pending[k][1], pending[k][2]))
            cur = pending.pop(i)
            ordered.append(cur[0])
    ordered += no_coords
    order_map = {}
    for i, rp in enumerate(ordered):
        rp.SortOrder = i
        order_map[rp.PdvId] = i
    route.IsOptimized = True
    day_ids = [d[0] for d in db.query(RouteDayModel.RouteDayId).filter(
        RouteDayModel.RouteId == route.RouteId, RouteDayModel.WorkDate >= _today_ar(), RouteDayModel.Status == "PLANNED",
    ).all()]
    if day_ids:
        for rdp in db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId.in_(day_ids)).all():
            if rdp.PdvId in order_map:
                rdp.PlannedOrder = order_map[rdp.PdvId]


class PdvRouteMove(BaseModel):
    pdv_id: int
    to_route_id: int | None = None  # None = dejarlo sin ruta


@router.post("/move-pdv", dependencies=[Depends(require_role("territory_manager"))])
def move_pdv_to_route(
    data: PdvRouteMove,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cambia la ruta regular de un PDV en un paso: lo saca de la(s) ruta(s) regular(es)
    vigente(s) donde está, lo suma a la ruta destino (con su trade y sus días futuros) y
    re-optimiza el orden de las rutas tocadas. Las campañas no se tocan."""
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == data.pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")
    dest = None
    if data.to_route_id is not None:
        dest = db.query(RouteModel).filter(RouteModel.RouteId == data.to_route_id).first()
        if not dest:
            raise HTTPException(status_code=404, detail="Ruta destino no encontrada")
        if _is_campaign(dest):
            raise HTTPException(status_code=400, detail="El destino tiene que ser una ruta regular, no una campaña")
        _assert_route_access(db, current_user, dest)

    today = _today_ar()
    origins = (
        db.query(RouteModel)
        .join(RoutePdvModel, RoutePdvModel.RouteId == RouteModel.RouteId)
        .filter(
            RoutePdvModel.PdvId == pdv.PdvId,
            or_(RouteModel.RouteType.is_(None), RouteModel.RouteType != ROUTE_CAMPAIGN),
            or_(RouteModel.EndDate.is_(None), RouteModel.EndDate >= today),
        )
        .all()
    )
    origins = [o for o in origins if dest is None or o.RouteId != dest.RouteId]
    already_in_dest = dest is not None and db.query(RoutePdvModel).filter(
        RoutePdvModel.RouteId == dest.RouteId, RoutePdvModel.PdvId == pdv.PdvId).first() is not None
    if not origins and (dest is None or already_in_dest):
        return {"changed": False, "from": [], "to": dest.Name if dest else None}

    for o in origins:
        _assert_route_access(db, current_user, o)
        db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == o.RouteId, RoutePdvModel.PdvId == pdv.PdvId).delete(synchronize_session=False)
        day_ids = [d[0] for d in db.query(RouteDayModel.RouteDayId).filter(
            RouteDayModel.RouteId == o.RouteId, RouteDayModel.WorkDate >= today).all()]
        if day_ids:
            db.query(RouteDayPdvModel).filter(
                RouteDayPdvModel.RouteDayId.in_(day_ids), RouteDayPdvModel.PdvId == pdv.PdvId,
                RouteDayPdvModel.ExecutionStatus == "PENDING",
            ).delete(synchronize_session=False)
        _audit(db, current_user, "ROUTE_PDV_DEL", o.RouteId, {"pdvId": pdv.PdvId, "motivo": "cambio de ruta", "hacia": dest.RouteId if dest else None})

    if dest is not None and not already_in_dest:
        last = db.query(func.max(RoutePdvModel.SortOrder)).filter(RoutePdvModel.RouteId == dest.RouteId).scalar()
        order = (last + 1) if last is not None else 0
        db.add(RoutePdvModel(RouteId=dest.RouteId, PdvId=pdv.PdvId, SortOrder=order, Priority=3))
        if dest.AssignedUserId is not None:
            pdv.AssignedUserId = dest.AssignedUserId
        for (rd_id,) in db.query(RouteDayModel.RouteDayId).filter(
                RouteDayModel.RouteId == dest.RouteId, RouteDayModel.WorkDate >= today).all():
            exists = db.query(RouteDayPdvModel).filter(
                RouteDayPdvModel.RouteDayId == rd_id, RouteDayPdvModel.PdvId == pdv.PdvId).first()
            if not exists:
                db.add(RouteDayPdvModel(RouteDayId=rd_id, PdvId=pdv.PdvId, PlannedOrder=order, Priority=3, ExecutionStatus="PENDING"))
        _audit(db, current_user, "ROUTE_PDV_ADD", dest.RouteId, {"pdvId": pdv.PdvId, "motivo": "cambio de ruta", "desde": [o.RouteId for o in origins]})

    db.flush()
    for r in origins + ([dest] if dest is not None else []):
        _optimize_route_order(db, r)
    db.commit()
    _MAP_CACHE.clear()
    return {"changed": True, "from": [o.Name for o in origins], "to": dest.Name if dest else None}


# ── Route Overlap Detection ──────────────────────────────
import json as _json
from datetime import date as _date, timedelta as _timedelta, datetime as _datetime, timezone as _tz

def _today_ar() -> _date:
    """Today's date in Argentina timezone (UTC-3). Servers may be in UTC."""
    ar_tz = _tz(_timedelta(hours=-3))
    return _datetime.now(ar_tz).date()


def monthly_dates(start: _date, end: _date, anchor_iso: str | None) -> list[_date]:
    """Frecuencia mensual: el mismo día del mes que la fecha de inicio (`anchor`);
    en meses más cortos, el último día (inicio 31 → 30/11, 28 ó 29/02).
    Espejo de `monthlyDates` en frontend/src/lib/routeDays.ts."""
    import calendar
    anchor = _date.fromisoformat(anchor_iso) if anchor_iso else start
    out: list[_date] = []
    y, m = start.year, start.month
    while True:
        day = min(anchor.day, calendar.monthrange(y, m)[1])
        d = _date(y, m, day)
        if d > end:
            break
        if d >= start and d >= anchor:
            out.append(d)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


OVERLAP_WEEKS = 8


def planned_dates(freq: str | None, config_str: str | None, end_date: _date | None = None,
                  weeks: int = OVERLAP_WEEKS) -> set[_date]:
    """Días que la frecuencia de una ruta programaría en las próximas `weeks`
    semanas (desde hoy o el inicio, hasta la fecha de fin). Espejo de
    `planRouteDates` (frontend/src/lib/routeDays.ts). `day`/`days` en JS: 0 = domingo."""
    if not freq:
        return set()
    try:
        config = _json.loads(config_str) if config_str else {}
    except ValueError:
        config = {}
    today = _today_ar()
    end = today + _timedelta(weeks=weeks)
    if end_date is not None and end_date < end:
        end = end_date
    anchor = _date.fromisoformat(config["startDate"]) if config.get("startDate") else today
    start = max(anchor, today)
    if start > end:
        return set()

    def every(n: int) -> set[_date]:
        d, out = anchor, set()
        while d < start:
            d += _timedelta(days=n)
        while d <= end:
            out.add(d)
            d += _timedelta(days=n)
        return out

    def weekdays(keep) -> set[_date]:
        out, d = set(), start
        while d <= end:
            if keep((d.weekday() + 1) % 7):
                out.add(d)
            d += _timedelta(days=1)
        return out

    def first_on_or_after(d: _date, js_day: int) -> _date:
        return d + _timedelta(days=(js_day - (d.weekday() + 1) % 7) % 7)

    if freq == "daily":
        return weekdays(lambda js: 1 <= js <= 5)
    if freq in ("weekly", "biweekly") and config.get("day") is not None:
        step = 7 if freq == "weekly" else 14
        d = first_on_or_after(start, config["day"])
        if freq == "biweekly":
            off = (d - first_on_or_after(anchor, config["day"])).days % 14
            if off:
                d += _timedelta(days=14 - off)
        out = set()
        while d <= end:
            out.add(d)
            d += _timedelta(days=step)
        return out
    if freq == "every_15_days":
        return every(15)
    if freq == "every_x_days":
        return every(int(config.get("interval") or 15))
    if freq == "monthly":
        return set(monthly_dates(start, end, config.get("startDate")))
    if freq == "specific_days":
        days = set(config.get("days") or [])
        return weekdays(lambda js: js in days) if days else set()
    return set()


def find_overlaps(db: Session, user_id: int, dates: set[_date], exclude_route_id: int | None = None) -> list[dict]:
    """Otras rutas vigentes del trade que caen en alguno de `dates`: por sus días
    programados (RouteDay, incluye los cargados a mano) y por su frecuencia (por
    si todavía no generaron días). Solo informa: tener 2 rutas el mismo día está
    permitido."""
    if not dates:
        return []
    others = db.query(RouteModel).filter(RouteModel.AssignedUserId == user_id, route_is_live())
    if exclude_route_id is not None:
        others = others.filter(RouteModel.RouteId != exclude_route_id)
    others = others.all()
    if not others:
        return []
    by_route: dict[int, set[_date]] = {r.RouteId: set() for r in others}
    for rid, wd in (
        db.query(RouteDayModel.RouteId, RouteDayModel.WorkDate)
        .filter(
            RouteDayModel.RouteId.in_(list(by_route)),
            RouteDayModel.AssignedUserId == user_id,
            RouteDayModel.WorkDate >= min(dates),
            RouteDayModel.WorkDate <= max(dates),
        )
        .all()
    ):
        if wd in dates:
            by_route[rid].add(wd)
    out = []
    for r in others:
        common = by_route[r.RouteId] | (planned_dates(r.FrequencyType, r.FrequencyConfig, r.EndDate) & dates)
        if common:
            ordered = sorted(common)
            out.append({
                "routeId": r.RouteId,
                "routeName": r.Name,
                "routeType": r.RouteType or ROUTE_REGULAR,
                "overlapDates": [d.isoformat() for d in ordered[:5]],
                "overlapCount": len(ordered),
            })
    out.sort(key=lambda o: (o["overlapDates"][0], o["routeName"]))
    return out


class OverlapPreviewIn(BaseModel):
    AssignedUserId: int
    RouteId: int | None = None
    FrequencyType: str | None = None
    FrequencyConfig: str | None = None
    EndDate: _date | None = None


@router.post("/overlap-preview")
def overlap_preview(data: OverlapPreviewIn, db: Session = Depends(get_db)):
    """Antes de guardar: ¿el trade ya tiene otra ruta alguno de los días que
    programaría esta? Para avisar en el editor al asignar/cambiar frecuencia
    (no restringe). Con RouteId se suman sus días ya programados (manuales)."""
    dates = planned_dates(data.FrequencyType, data.FrequencyConfig, data.EndDate)
    if data.RouteId is not None:
        today = _today_ar()
        dates |= {
            wd for (wd,) in db.query(RouteDayModel.WorkDate).filter(
                RouteDayModel.RouteId == data.RouteId,
                RouteDayModel.WorkDate >= today,
                RouteDayModel.WorkDate <= today + _timedelta(weeks=OVERLAP_WEEKS),
            ).all()
            if data.EndDate is None or wd <= data.EndDate
        }
    overlaps = find_overlaps(db, data.AssignedUserId, dates, data.RouteId)
    return {"overlaps": overlaps, "hasOverlap": bool(overlaps)}


@router.get("/{route_id}/check-overlap")
def check_route_overlap(route_id: int, db: Session = Depends(get_db)):
    """Después de guardar: otras rutas del mismo trade en los días de esta
    (frecuencia + días ya programados). Informativo."""
    route = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    if not route.AssignedUserId:
        return {"overlaps": [], "hasOverlap": False}
    today = _today_ar()
    dates = planned_dates(route.FrequencyType, route.FrequencyConfig, route.EndDate) | {
        wd for (wd,) in db.query(RouteDayModel.WorkDate).filter(
            RouteDayModel.RouteId == route_id,
            RouteDayModel.WorkDate >= today,
            RouteDayModel.WorkDate <= today + _timedelta(weeks=OVERLAP_WEEKS),
        ).all()
    }
    overlaps = find_overlaps(db, route.AssignedUserId, dates, route_id)
    return {"overlaps": overlaps, "hasOverlap": bool(overlaps)}
