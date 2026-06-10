from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from ..database import get_db
from ..auth import get_current_user
from ..models import (
    Visit as VisitModel,
    User as UserModel,
    PDV as PDVModel,
)
from ..models.visit import VisitCheck as VisitCheckModel, VisitPhoto as VisitPhotoModel, VisitAnswer as VisitAnswerModel
from ..models.channel import Channel as ChannelModel
from ..models.route import Route as RouteModel, RoutePdv as RoutePdvModel, RouteDay as RouteDayModel, RouteDayPdv as RouteDayPdvModel
from ..models.visit_form_time import VisitFormTime as VisitFormTimeModel
from ..models.user import UserRole as UserRoleModel, Role as RoleModel
from ..models.zone import Zone as ZoneModel
from ..models.product import Product as ProductModel
from ..models.visit_coverage import VisitCoverage as VisitCoverageModel
from ..models.pdv_supplier import PdvSupplier as PdvSupplierModel
from ..models.supplier_type import SupplierType as SupplierTypeModel
from ..models.visit_action import VisitAction as VisitActionModel
from ..hierarchy import get_visible_user_ids
from ..auth import get_user_role
import json as _json

router = APIRouter(prefix="/reports", tags=["Reportes"], dependencies=[Depends(get_current_user)])


def _date_range(year: int, month: int):
    first = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        last = datetime(year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(microseconds=1)
    else:
        last = datetime(year, month + 1, 1, tzinfo=timezone.utc) - timedelta(microseconds=1)
    return first, last


@router.get("/summary")
def report_summary(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
):
    """KPIs globales del mes: visitas, cobertura, GPS, fotos, tiempos."""
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    first, last = _date_range(y, m)

    visits = (
        db.query(VisitModel)
        .filter(VisitModel.OpenedAt >= first, VisitModel.OpenedAt <= last)
        .all()
    )
    total_visits = len(visits)
    closed = [v for v in visits if v.Status and v.Status.upper() in ("CLOSED", "COMPLETED")]
    total_closed = len(closed)

    # Unique PDVs visited
    pdv_ids_visited = set(v.PdvId for v in visits)
    total_pdvs = db.query(PDVModel).filter(PDVModel.IsActive== True).count()
    coverage = round((len(pdv_ids_visited) / total_pdvs * 100) if total_pdvs > 0 else 0)

    # GPS checks
    visit_ids = [v.VisitId for v in visits]
    gps_count = 0
    if visit_ids:
        gps_count = (
            db.query(sqlfunc.count(sqlfunc.distinct(VisitCheckModel.VisitId)))
            .filter(VisitCheckModel.VisitId.in_(visit_ids))
            .scalar()
        ) or 0

    # Photos
    photo_count = 0
    if visit_ids:
        photo_count = (
            db.query(sqlfunc.count(sqlfunc.distinct(VisitPhotoModel.VisitId)))
            .filter(VisitPhotoModel.VisitId.in_(visit_ids))
            .scalar()
        ) or 0

    # Average visit duration (minutes)
    durations = []
    for v in closed:
        if v.OpenedAt and v.ClosedAt:
            delta = (v.ClosedAt - v.OpenedAt).total_seconds() / 60
            if 0 < delta < 480:  # sane range
                durations.append(delta)
    avg_duration = round(sum(durations) / len(durations)) if durations else 0

    return {
        "year": y,
        "month": m,
        "totalVisits": total_visits,
        "closedVisits": total_closed,
        "totalPdvs": total_pdvs,
        "pdvsVisited": len(pdv_ids_visited),
        "coverage": coverage,
        "visitsWithGps": gps_count,
        "visitsWithPhoto": photo_count,
        "avgDurationMin": avg_duration,
    }


@router.get("/vendor-ranking")
def vendor_ranking(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
):
    """Ranking de vendedores por visitas en el mes."""
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    first, last = _date_range(y, m)

    users = db.query(UserModel).filter(UserModel.IsActive== True).all()
    visits = (
        db.query(VisitModel)
        .filter(VisitModel.OpenedAt >= first, VisitModel.OpenedAt <= last)
        .all()
    )
    visit_ids = [v.VisitId for v in visits]

    # GPS checks by visit
    gps_visits: set[int] = set()
    if visit_ids:
        rows = db.query(VisitCheckModel.VisitId).filter(VisitCheckModel.VisitId.in_(visit_ids)).distinct().all()
        gps_visits = set(r[0] for r in rows)

    # Photo visits
    photo_visits: set[int] = set()
    if visit_ids:
        rows = db.query(VisitPhotoModel.VisitId).filter(VisitPhotoModel.VisitId.in_(visit_ids)).distinct().all()
        photo_visits = set(r[0] for r in rows)

    ranking = []
    for u in users:
        user_visits = [v for v in visits if v.UserId == u.UserId]
        if not user_visits:
            continue
        total = len(user_visits)
        closed = [v for v in user_visits if v.Status and v.Status.upper() in ("CLOSED", "COMPLETED")]

        # Unique PDVs visited
        pdvs_visited = set(v.PdvId for v in user_visits)

        # Planned PDVs for this user (from routes assigned to them via RouteDays)
        planned = total  # fallback

        with_gps = sum(1 for v in user_visits if v.VisitId in gps_visits)
        with_photo = sum(1 for v in user_visits if v.VisitId in photo_visits)

        # Average duration
        durs = []
        for v in closed:
            if v.OpenedAt and v.ClosedAt:
                d = (v.ClosedAt - v.OpenedAt).total_seconds() / 60
                if 0 < d < 480:
                    durs.append(d)
        avg_time = round(sum(durs) / len(durs)) if durs else 0

        compliance = round((len(closed) / total * 100) if total > 0 else 0)

        zone_name = ""
        if u.zone:
            zone_name = u.zone.Name

        ranking.append({
            "userId": u.UserId,
            "name": u.DisplayName,
            "zone": zone_name,
            "visits": total,
            "planned": planned,
            "closed": len(closed),
            "pdvsVisited": len(pdvs_visited),
            "compliance": compliance,
            "withGps": with_gps,
            "withPhoto": with_photo,
            "avgTimeMin": avg_time,
        })

    ranking.sort(key=lambda x: x["visits"], reverse=True)
    for i, r in enumerate(ranking):
        r["rank"] = i + 1

    return ranking


@router.get("/channel-coverage")
def channel_coverage(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
):
    """Cobertura de visitas por canal."""
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    first, last = _date_range(y, m)

    channels = db.query(ChannelModel).filter(ChannelModel.IsActive== True).all()
    all_pdvs = db.query(PDVModel).filter(PDVModel.IsActive== True).all()
    visits = (
        db.query(VisitModel)
        .filter(VisitModel.OpenedAt >= first, VisitModel.OpenedAt <= last)
        .all()
    )
    visit_ids = [v.VisitId for v in visits]

    gps_visits: set[int] = set()
    photo_visits: set[int] = set()
    if visit_ids:
        rows = db.query(VisitCheckModel.VisitId).filter(VisitCheckModel.VisitId.in_(visit_ids)).distinct().all()
        gps_visits = set(r[0] for r in rows)
        rows = db.query(VisitPhotoModel.VisitId).filter(VisitPhotoModel.VisitId.in_(visit_ids)).distinct().all()
        photo_visits = set(r[0] for r in rows)

    pdv_channel = {p.PdvId: p.ChannelId for p in all_pdvs}
    visited_pdvs_by_visit = {v.VisitId: v.PdvId for v in visits}

    result = []
    for ch in channels:
        ch_pdvs = [p for p in all_pdvs if p.ChannelId == ch.ChannelId]
        total = len(ch_pdvs)
        if total == 0:
            continue
        ch_pdv_ids = set(p.PdvId for p in ch_pdvs)
        ch_visits = [v for v in visits if v.PdvId in ch_pdv_ids]
        visited = len(set(v.PdvId for v in ch_visits))
        cov = round((visited / total * 100) if total > 0 else 0)
        gps = sum(1 for v in ch_visits if v.VisitId in gps_visits)
        photo = sum(1 for v in ch_visits if v.VisitId in photo_visits)
        result.append({
            "channelId": ch.ChannelId,
            "channel": ch.Name,
            "total": total,
            "visited": visited,
            "coverage": cov,
            "gps": gps,
            "photo": photo,
        })

    result.sort(key=lambda x: x["total"], reverse=True)
    return result


@router.get("/pdv-map")
def pdv_map_data(
    zone_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """PDVs con coordenadas, visitas totales, última visita, y activador asignado."""
    from ..models.route import RouteDay as RouteDayModel

    q = db.query(PDVModel).filter(PDVModel.IsActive== True)
    if zone_id:
        q = q.filter(PDVModel.ZoneId == zone_id)
    pdvs = q.all()

    pdv_ids = [p.PdvId for p in pdvs]
    if not pdv_ids:
        return []

    # Visit counts and last visit per PDV
    visit_stats = (
        db.query(
            VisitModel.PdvId,
            sqlfunc.count(VisitModel.VisitId),
            sqlfunc.max(VisitModel.OpenedAt),
        )
        .filter(VisitModel.PdvId.in_(pdv_ids))
        .group_by(VisitModel.PdvId)
        .all()
    )
    visit_map: dict[int, dict] = {}
    for pdv_id, count, last_visit in visit_stats:
        visit_map[pdv_id] = {"count": count, "lastVisit": last_visit.isoformat() if last_visit else None}

    # Assigned user per PDV (most recent RouteDay assignment)
    # RouteDay -> Route -> RoutePdv -> PDV
    from sqlalchemy import desc
    assigned_map: dict[int, dict] = {}
    for pdv_id in pdv_ids:
        row = (
            db.query(RouteDayModel.AssignedUserId, UserModel.DisplayName)
            .join(RouteModel, RouteModel.RouteId == RouteDayModel.RouteId)
            .join(RoutePdvModel, RoutePdvModel.RouteId == RouteModel.RouteId)
            .join(UserModel, UserModel.UserId == RouteDayModel.AssignedUserId)
            .filter(RoutePdvModel.PdvId == pdv_id)
            .order_by(desc(RouteDayModel.WorkDate))
            .first()
        )
        if row:
            assigned_map[pdv_id] = {"userId": row[0], "userName": row[1]}

    # PDVs that belong to at least one route (regardless of RouteDay assignment)
    route_pdv_rows = (
        db.query(RoutePdvModel.PdvId)
        .filter(RoutePdvModel.PdvId.in_(pdv_ids))
        .distinct()
        .all()
    )
    pdv_ids_in_route = {row[0] for row in route_pdv_rows}

    # Channel names
    channels_db = db.query(ChannelModel).all()
    ch_map = {c.ChannelId: c.Name for c in channels_db}

    result = []
    for p in pdvs:
        has_coords = p.Lat is not None and p.Lon is not None
        vs = visit_map.get(p.PdvId, {"count": 0, "lastVisit": None})
        assigned = assigned_map.get(p.PdvId)
        result.append({
            "pdvId": p.PdvId,
            "name": p.Name,
            "address": p.Address or p.City or "",
            "lat": float(p.Lat) if has_coords else None,
            "lon": float(p.Lon) if has_coords else None,
            "channel": ch_map.get(p.ChannelId, p.Channel or "Sin canal"),
            "channelId": p.ChannelId,
            "zoneId": p.ZoneId,
            "visitCount": vs["count"],
            "lastVisit": vs["lastVisit"],
            "assignedUserId": assigned["userId"] if assigned else None,
            "assignedUserName": assigned["userName"] if assigned else "Sin asignar",
            "hasCoords": has_coords,
            "hasRoute": p.PdvId in pdv_ids_in_route,
        })

    return result


@router.get("/gps-alerts")
def report_gps_alerts(
    days: int = Query(default=30, description="Visitas de los últimos N días"),
    user_id: int | None = Query(default=None, description="Filtrar por TM Rep"),
    db: Session = Depends(get_db),
):
    """Visitas con alerta GPS:
    - Sin VisitCheck IN registrado (el rep no tenía o no permitió GPS), o
    - VisitCheck IN con DistanceToPdvM > 200m (rep estaba fuera del perímetro)

    Pensado para que el supervisor vea las visitas "dudosas" para revisar.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    q = db.query(VisitModel).filter(VisitModel.OpenedAt >= cutoff)
    if user_id is not None:
        q = q.filter(VisitModel.UserId == user_id)
    visits = q.order_by(VisitModel.OpenedAt.desc()).all()

    if not visits:
        return []

    visit_ids = [v.VisitId for v in visits]

    # Cargar todos los VisitCheck IN de esas visitas en una query
    checks_in = (
        db.query(VisitCheckModel)
        .filter(
            VisitCheckModel.VisitId.in_(visit_ids),
            VisitCheckModel.CheckType == "IN",
        )
        .all()
    )
    check_by_visit = {c.VisitId: c for c in checks_in}

    # Lookups de user y pdv
    user_ids = {v.UserId for v in visits}
    pdv_ids = {v.PdvId for v in visits}
    users = {u.UserId: u.DisplayName for u in db.query(UserModel).filter(UserModel.UserId.in_(user_ids)).all()}
    pdvs = {p.PdvId: p for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()}

    PERIMETER = 200  # metros
    alerts = []
    for v in visits:
        check = check_by_visit.get(v.VisitId)
        alert_type: str | None = None
        distance_m: float | None = None

        if check is None:
            alert_type = "no_gps"
        else:
            if check.DistanceToPdvM is not None:
                distance_m = float(check.DistanceToPdvM)
                if distance_m > PERIMETER:
                    alert_type = "out_of_range"
            elif check.Lat is None or check.Lon is None:
                alert_type = "no_gps"

        if alert_type is None:
            continue  # esta visita no tiene alerta

        pdv = pdvs.get(v.PdvId)
        alerts.append({
            "visitId": v.VisitId,
            "pdvId": v.PdvId,
            "pdvName": pdv.Name if pdv else f"#{v.PdvId}",
            "userId": v.UserId,
            "userName": users.get(v.UserId, f"#{v.UserId}"),
            "openedAt": v.OpenedAt.isoformat() if v.OpenedAt else None,
            "status": v.Status,
            "alertType": alert_type,  # "no_gps" | "out_of_range"
            "distanceM": round(distance_m) if distance_m is not None else None,
            "perimeterM": PERIMETER,
        })
    return alerts


@router.get("/avg-time-by-tm-pdv")
def report_avg_time_by_tm_pdv(
    user_id: int | None = Query(default=None),
    pdv_id: int | None = Query(default=None),
    days: int | None = Query(default=None, description="Sólo visitas de los últimos N días"),
    db: Session = Depends(get_db),
):
    """Tiempo promedio (en minutos) que cada TM Rep pasa en cada PDV.

    Sólo cuenta visitas cerradas (con ClosedAt). Calcula los promedios en Python para
    ser portable entre SQLite y SQL Server (evita julianday/DATEDIFF).
    """
    q = db.query(VisitModel).filter(VisitModel.ClosedAt.isnot(None))
    if user_id is not None:
        q = q.filter(VisitModel.UserId == user_id)
    if pdv_id is not None:
        q = q.filter(VisitModel.PdvId == pdv_id)
    if days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        q = q.filter(VisitModel.OpenedAt >= cutoff)

    visits = q.all()

    # Group by (UserId, PdvId), accumulate seconds + count
    buckets: dict[tuple[int, int], dict[str, float]] = {}
    for v in visits:
        if not v.ClosedAt or not v.OpenedAt:
            continue
        try:
            duration_s = (v.ClosedAt - v.OpenedAt).total_seconds()
        except Exception:
            continue
        if duration_s <= 0:
            continue
        key = (v.UserId, v.PdvId)
        b = buckets.setdefault(key, {"total": 0.0, "count": 0})
        b["total"] += duration_s
        b["count"] += 1

    if not buckets:
        return []

    user_ids = {uid for (uid, _) in buckets.keys()}
    pdv_ids = {pid for (_, pid) in buckets.keys()}
    users = {u.UserId: u.DisplayName for u in db.query(UserModel).filter(UserModel.UserId.in_(user_ids)).all()}
    pdvs = {p.PdvId: p.Name for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()}

    result = [
        {
            "userId": uid,
            "userName": users.get(uid, f"#{uid}"),
            "pdvId": pid,
            "pdvName": pdvs.get(pid, f"#{pid}"),
            "visitCount": int(b["count"]),
            "avgMinutes": round((b["total"] / b["count"]) / 60, 1),
        }
        for (uid, pid), b in buckets.items()
    ]
    # Sort by user then highest avg
    result.sort(key=lambda r: (r["userName"], -r["avgMinutes"]))
    return result


@router.get("/form-times")
def report_form_times(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
):
    """Tiempos promedio por formulario en el mes."""
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    first, last = _date_range(y, m)

    visit_ids_q = (
        db.query(VisitModel.VisitId)
        .filter(VisitModel.OpenedAt >= first, VisitModel.OpenedAt <= last)
    )
    visit_ids = [r[0] for r in visit_ids_q.all()]
    if not visit_ids:
        return []

    rows = (
        db.query(
            VisitFormTimeModel.FormId,
            sqlfunc.avg(VisitFormTimeModel.ElapsedSeconds),
            sqlfunc.count(VisitFormTimeModel.VisitFormTimeId),
            sqlfunc.sum(VisitFormTimeModel.ElapsedSeconds),
        )
        .filter(VisitFormTimeModel.VisitId.in_(visit_ids))
        .group_by(VisitFormTimeModel.FormId)
        .all()
    )

    return [
        {
            "formId": r[0],
            "avgSeconds": round(float(r[1])) if r[1] else 0,
            "count": r[2] or 0,
            "totalSeconds": int(r[3]) if r[3] else 0,
        }
        for r in rows
    ]


@router.get("/territory-overview")
def territory_overview(
    manager_user_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Complete territory overview for a Territory Manager - their reps, routes, today's status, performance."""
    from datetime import date as date_type

    today = date_type.today()
    now = datetime.now(timezone.utc)
    first_of_month, end_of_month = _date_range(now.year, now.month)

    manager = db.query(UserModel).filter(UserModel.UserId == manager_user_id).first()
    if not manager:
        return {"error": "Manager not found"}

    manager_zone = db.query(ZoneModel).filter(ZoneModel.ZoneId == manager.ZoneId).first() if manager.ZoneId else None

    # Find all subordinates via ManagerUserId hierarchy (BFS)
    from ..hierarchy import get_all_subordinate_ids
    all_sub_ids = get_all_subordinate_ids(db, manager_user_id)

    # Filter to leaf-level users (vendedor role = those who don't manage anyone, i.e. trade reps)
    # A "rep" is a subordinate who has no subordinates of their own
    managers_set = set(
        r[0] for r in db.query(UserModel.UserId).filter(
            UserModel.ManagerUserId.in_(all_sub_ids), UserModel.IsActive == True
        ).all()
    ) if all_sub_ids else set()
    all_rep_ids = [uid for uid in all_sub_ids if uid not in managers_set]
    reps = db.query(UserModel).filter(UserModel.UserId.in_(all_rep_ids), UserModel.IsActive == True).all() if all_rep_ids else []

    # Monthly visits per rep
    month_visits = (
        db.query(VisitModel)
        .filter(VisitModel.OpenedAt >= first_of_month, VisitModel.OpenedAt <= end_of_month, VisitModel.UserId.in_(all_rep_ids))
        .all()
    ) if all_rep_ids else []

    # GPS checks for month visits
    month_visit_ids = [v.VisitId for v in month_visits]
    gps_visits = set()
    if month_visit_ids:
        rows = db.query(VisitCheckModel.VisitId).filter(VisitCheckModel.VisitId.in_(month_visit_ids)).distinct().all()
        gps_visits = {r[0] for r in rows}

    # Today's route days for reps
    today_route_days = (
        db.query(RouteDayModel)
        .filter(RouteDayModel.WorkDate == today, RouteDayModel.AssignedUserId.in_(all_rep_ids))
        .all()
    ) if all_rep_ids else []

    today_rd_ids = [rd.RouteDayId for rd in today_route_days]
    today_rdp = db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId.in_(today_rd_ids)).all() if today_rd_ids else []

    # Today's visits per rep
    today_visits = (
        db.query(VisitModel)
        .filter(VisitModel.OpenedAt >= datetime(today.year, today.month, today.day, tzinfo=timezone.utc),
                VisitModel.UserId.in_(all_rep_ids))
        .all()
    ) if all_rep_ids else []

    # Build per-rep data
    rep_data = []
    for rep in reps:
        # Monthly stats
        rep_month_visits = [v for v in month_visits if v.UserId == rep.UserId]
        rep_closed = [v for v in rep_month_visits if v.Status and v.Status.upper() in ("CLOSED", "COMPLETED")]
        rep_gps = sum(1 for v in rep_month_visits if v.VisitId in gps_visits)
        rep_durations = []
        for v in rep_closed:
            if v.OpenedAt and v.ClosedAt:
                d = (v.ClosedAt - v.OpenedAt).total_seconds() / 60
                if 0 < d < 480:
                    rep_durations.append(d)
        avg_time = round(sum(rep_durations) / len(rep_durations)) if rep_durations else 0

        # Route assigned
        rep_route = db.query(RouteModel).filter(RouteModel.AssignedUserId == rep.UserId, RouteModel.IsActive== True).first()

        # Today status
        rep_today_rds = [rd for rd in today_route_days if rd.AssignedUserId == rep.UserId]
        rep_today_rdp = []
        for rd in rep_today_rds:
            rep_today_rdp.extend([p for p in today_rdp if p.RouteDayId == rd.RouteDayId])
        planned_today = len(rep_today_rdp)
        completed_today = sum(1 for p in rep_today_rdp if p.ExecutionStatus in ("COMPLETED", "DONE"))
        rep_today_visits = [v for v in today_visits if v.UserId == rep.UserId]

        # Current status
        has_open_visit = any(v.Status == "OPEN" for v in rep_today_visits)
        last_visit_time = max((v.ClosedAt or v.OpenedAt for v in rep_today_visits), default=None) if rep_today_visits else None

        if completed_today == planned_today and planned_today > 0:
            live_status = "completed"
        elif has_open_visit:
            live_status = "visiting"
        elif len(rep_today_visits) > 0:
            live_status = "in_field"
        elif planned_today > 0:
            live_status = "not_started"
        else:
            live_status = "no_route"

        compliance = round(len(rep_closed) / len(rep_month_visits) * 100) if rep_month_visits else 0

        rep_data.append({
            "userId": rep.UserId,
            "name": rep.DisplayName,
            "email": rep.Email,
            "routeName": rep_route.Name if rep_route else None,
            "routeId": rep_route.RouteId if rep_route else None,
            "liveStatus": live_status,
            "lastActivity": last_visit_time.isoformat() if last_visit_time else None,
            "today": {
                "planned": planned_today,
                "completed": completed_today,
                "visits": len(rep_today_visits),
            },
            "month": {
                "visits": len(rep_month_visits),
                "closed": len(rep_closed),
                "compliance": compliance,
                "withGps": rep_gps,
                "avgTimeMin": avg_time,
                "pdvsVisited": len(set(v.PdvId for v in rep_month_visits)),
            },
        })

    # Sort: visiting first, then in_field, not_started, completed, no_route
    status_order = {"visiting": 0, "in_field": 1, "not_started": 2, "completed": 3, "no_route": 4}
    rep_data.sort(key=lambda r: (status_order.get(r["liveStatus"], 5), -r["month"]["visits"]))

    # Territory totals
    total_planned_today = sum(r["today"]["planned"] for r in rep_data)
    total_completed_today = sum(r["today"]["completed"] for r in rep_data)
    total_month_visits = sum(r["month"]["visits"] for r in rep_data)
    total_month_closed = sum(r["month"]["closed"] for r in rep_data)

    # PDVs in territory: count unique PDVs assigned to reps' routes
    pdv_count = 0
    if all_rep_ids:
        rep_routes = db.query(RouteModel).filter(RouteModel.AssignedUserId.in_(all_rep_ids), RouteModel.IsActive == True).all()
        rep_route_ids = [r.RouteId for r in rep_routes]
        if rep_route_ids:
            pdv_count = db.query(RoutePdvModel.PdvId).filter(RoutePdvModel.RouteId.in_(rep_route_ids)).distinct().count()
    if pdv_count == 0:
        # Fallback: PDVs assigned to any subordinate
        pdv_count = db.query(PDVModel).filter(PDVModel.AssignedUserId.in_(all_sub_ids), PDVModel.IsActive == True).count() if all_sub_ids else 0

    return {
        "manager": {
            "userId": manager.UserId,
            "name": manager.DisplayName,
            "zone": manager_zone.Name if manager_zone else None,
        },
        "reps": rep_data,
        "territory": {
            "totalReps": len(rep_data),
            "totalPdvs": pdv_count,
            "today": {
                "planned": total_planned_today,
                "completed": total_completed_today,
                "progress": round(total_completed_today / total_planned_today * 100) if total_planned_today > 0 else 0,
            },
            "month": {
                "totalVisits": total_month_visits,
                "closed": total_month_closed,
                "compliance": round(total_month_closed / total_month_visits * 100) if total_month_visits > 0 else 0,
            },
        },
    }


# ============================================================
# PERFECT STORE SCORE
# ============================================================
@router.get("/perfect-store")
def perfect_store_scores(
    db: Session = Depends(get_db),
):
    """
    Perfect Store Score per PDV (0-100).
    Components:
    - Coverage (25pts): Has been visited in last 30 days
    - Frequency (25pts): Visit frequency vs planned
    - GPS compliance (25pts): Visits with GPS check-in
    - Data quality (25pts): Form answers submitted
    """
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)

    pdvs = db.query(PDVModel).filter(PDVModel.IsActive== True).all()
    ch_map = {c.ChannelId: c.Name for c in db.query(ChannelModel).all()}
    zone_map = {z.ZoneId: z.Name for z in db.query(ZoneModel).all()}

    # All visits in last 30 days
    recent_visits = db.query(VisitModel).filter(VisitModel.OpenedAt >= thirty_days_ago).all()
    visit_by_pdv: dict[int, list] = {}
    for v in recent_visits:
        visit_by_pdv.setdefault(v.PdvId, []).append(v)

    # GPS checks
    visit_ids = [v.VisitId for v in recent_visits]
    gps_visits: set[int] = set()
    if visit_ids:
        rows = db.query(VisitCheckModel.VisitId).filter(VisitCheckModel.VisitId.in_(visit_ids)).distinct().all()
        gps_visits = {r[0] for r in rows}

    # Answers
    answer_visits: set[int] = set()
    if visit_ids:
        rows = db.query(VisitAnswerModel.VisitId).filter(VisitAnswerModel.VisitId.in_(visit_ids)).distinct().all()
        answer_visits = {r[0] for r in rows}

    # Route PDV counts (how many times a PDV should be visited = route days in 30d)
    route_pdv_planned: dict[int, int] = {}
    route_days_30d = db.query(RouteDayModel).filter(RouteDayModel.WorkDate >= thirty_days_ago.date()).all()
    rd_ids = [rd.RouteDayId for rd in route_days_30d]
    if rd_ids:
        rdp_rows = db.query(RouteDayPdvModel.PdvId, sqlfunc.count()).filter(
            RouteDayPdvModel.RouteDayId.in_(rd_ids)
        ).group_by(RouteDayPdvModel.PdvId).all()
        for pdv_id, count in rdp_rows:
            route_pdv_planned[pdv_id] = count

    results = []
    for p in pdvs:
        visits_list = visit_by_pdv.get(p.PdvId, [])
        closed = [v for v in visits_list if v.Status and v.Status.upper() in ("CLOSED", "COMPLETED")]
        planned = route_pdv_planned.get(p.PdvId, 0)

        # Coverage (25): visited at all in 30 days?
        coverage_score = 25 if len(visits_list) > 0 else 0

        # Frequency (25): actual visits / planned visits
        if planned > 0:
            freq_ratio = min(len(closed) / planned, 1.0)
            freq_score = round(25 * freq_ratio)
        else:
            freq_score = 25 if len(closed) > 0 else 0

        # GPS (25): % of visits with GPS
        if len(visits_list) > 0:
            gps_count = sum(1 for v in visits_list if v.VisitId in gps_visits)
            gps_score = round(25 * gps_count / len(visits_list))
        else:
            gps_score = 0

        # Data quality (25): % of visits with form answers
        if len(visits_list) > 0:
            ans_count = sum(1 for v in visits_list if v.VisitId in answer_visits)
            data_score = round(25 * ans_count / len(visits_list))
        else:
            data_score = 0

        total = coverage_score + freq_score + gps_score + data_score

        results.append({
            "pdvId": p.PdvId,
            "name": p.Name,
            "channel": ch_map.get(p.ChannelId, p.Channel or ""),
            "zone": zone_map.get(p.ZoneId, "") if p.ZoneId else "",
            "score": total,
            "components": {
                "coverage": coverage_score,
                "frequency": freq_score,
                "gps": gps_score,
                "dataQuality": data_score,
            },
            "visits30d": len(visits_list),
            "planned30d": planned,
        })

    results.sort(key=lambda x: x["score"], reverse=True)

    # Aggregations
    scores = [r["score"] for r in results]
    avg = round(sum(scores) / len(scores)) if scores else 0
    perfect = sum(1 for s in scores if s >= 90)
    good = sum(1 for s in scores if 70 <= s < 90)
    needs_work = sum(1 for s in scores if 40 <= s < 70)
    critical = sum(1 for s in scores if s < 40)

    # By channel
    by_channel: dict[str, list[int]] = {}
    for r in results:
        by_channel.setdefault(r["channel"], []).append(r["score"])
    channel_avg = [
        {"channel": ch, "avgScore": round(sum(sc) / len(sc)), "count": len(sc)}
        for ch, sc in sorted(by_channel.items(), key=lambda x: -sum(x[1]) / len(x[1]))
    ]

    return {
        "summary": {"avgScore": avg, "perfect": perfect, "good": good, "needsWork": needs_work, "critical": critical, "total": len(results)},
        "byChannel": channel_avg,
        "pdvs": results,
    }


# ============================================================
# TRENDING (month over month)
# ============================================================
@router.get("/trending")
def trending_report(
    months: int = Query(default=3, ge=2, le=12),
    db: Session = Depends(get_db),
):
    """Month-over-month comparison of key metrics."""
    now = datetime.now(timezone.utc)
    data = []

    for i in range(months - 1, -1, -1):
        # Calculate month
        m = now.month - i
        y = now.year
        while m <= 0:
            m += 12
            y -= 1
        first, last = _date_range(y, m)

        visits = db.query(VisitModel).filter(
            VisitModel.OpenedAt >= first, VisitModel.OpenedAt <= last
        ).all()

        total = len(visits)
        closed = [v for v in visits if v.Status and v.Status.upper() in ("CLOSED", "COMPLETED")]
        pdv_ids = set(v.PdvId for v in visits)
        total_pdvs = db.query(PDVModel).filter(PDVModel.IsActive== True).count()
        coverage = round(len(pdv_ids) / total_pdvs * 100) if total_pdvs > 0 else 0

        # GPS
        vids = [v.VisitId for v in visits]
        gps_count = 0
        if vids:
            gps_count = db.query(sqlfunc.count(sqlfunc.distinct(VisitCheckModel.VisitId))).filter(
                VisitCheckModel.VisitId.in_(vids)
            ).scalar() or 0

        # Duration
        durations = []
        for v in closed:
            if v.OpenedAt and v.ClosedAt:
                d = (v.ClosedAt - v.OpenedAt).total_seconds() / 60
                if 0 < d < 480:
                    durations.append(d)
        avg_dur = round(sum(durations) / len(durations)) if durations else 0

        month_names = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
        data.append({
            "month": f"{month_names[m]} {y}",
            "monthNum": m,
            "year": y,
            "visits": total,
            "closed": len(closed),
            "coverage": coverage,
            "pdvsVisited": len(pdv_ids),
            "gpsRate": round(gps_count / total * 100) if total > 0 else 0,
            "avgDuration": avg_dur,
        })

    return data


# ============================================================
# SMART ALERTS
# ============================================================
@router.get("/smart-alerts")
def smart_alerts(
    db: Session = Depends(get_db),
):
    """Auto-generated alerts based on data patterns."""
    now = datetime.now(timezone.utc)
    alerts = []

    # 1. PDVs not visited in 14+ days
    fourteen_days_ago = now - timedelta(days=14)
    active_pdvs = db.query(PDVModel).filter(PDVModel.IsActive== True).all()
    for p in active_pdvs:
        last_visit = db.query(sqlfunc.max(VisitModel.OpenedAt)).filter(VisitModel.PdvId == p.PdvId).scalar()
        if last_visit is None:
            alerts.append({
                "type": "never_visited",
                "severity": "high",
                "title": f"{p.Name} nunca fue visitado",
                "detail": f"PDV activo sin ninguna visita registrada",
                "pdvId": p.PdvId,
                "channel": p.Channel,
            })
            continue
        # Make timezone-aware for comparison
        lv = last_visit if last_visit.tzinfo else last_visit.replace(tzinfo=timezone.utc)
        if lv < fourteen_days_ago:
            days_ago = (now - lv).days
            alerts.append({
                "type": "not_visited_recently",
                "severity": "high" if days_ago > 30 else "medium",
                "title": f"{p.Name} sin visita hace {days_ago} días",
                "detail": f"Última visita: {last_visit.strftime('%d/%m/%Y')}",
                "pdvId": p.PdvId,
                "channel": p.Channel,
            })

    # 2. Reps with declining compliance (this month vs last month)
    this_month_first, this_month_last = _date_range(now.year, now.month)
    prev_month = now.month - 1 if now.month > 1 else 12
    prev_year = now.year if now.month > 1 else now.year - 1
    prev_month_first, prev_month_last = _date_range(prev_year, prev_month)

    users = db.query(UserModel).filter(UserModel.IsActive== True).all()
    for u in users:
        this_visits = db.query(VisitModel).filter(
            VisitModel.UserId == u.UserId, VisitModel.OpenedAt >= this_month_first, VisitModel.OpenedAt <= this_month_last
        ).count()
        prev_visits = db.query(VisitModel).filter(
            VisitModel.UserId == u.UserId, VisitModel.OpenedAt >= prev_month_first, VisitModel.OpenedAt <= prev_month_last
        ).count()
        if prev_visits >= 5 and this_visits < prev_visits * 0.5:
            alerts.append({
                "type": "declining_rep",
                "severity": "medium",
                "title": f"{u.DisplayName}: actividad en baja",
                "detail": f"Este mes: {this_visits} visitas vs {prev_visits} el mes anterior (-{round((1 - this_visits/prev_visits)*100)}%)",
                "userId": u.UserId,
            })

    # 3. Channels losing coverage
    ch_map = {c.ChannelId: c.Name for c in db.query(ChannelModel).all()}
    for ch_id, ch_name in ch_map.items():
        ch_pdvs = db.query(PDVModel).filter(PDVModel.ChannelId == ch_id, PDVModel.IsActive== True).all()
        if len(ch_pdvs) < 3:
            continue
        ch_pdv_ids = [p.PdvId for p in ch_pdvs]
        this_visited = db.query(sqlfunc.count(sqlfunc.distinct(VisitModel.PdvId))).filter(
            VisitModel.PdvId.in_(ch_pdv_ids), VisitModel.OpenedAt >= this_month_first
        ).scalar() or 0
        prev_visited = db.query(sqlfunc.count(sqlfunc.distinct(VisitModel.PdvId))).filter(
            VisitModel.PdvId.in_(ch_pdv_ids), VisitModel.OpenedAt >= prev_month_first, VisitModel.OpenedAt <= prev_month_last
        ).scalar() or 0
        this_cov = round(this_visited / len(ch_pdvs) * 100)
        if prev_visited > 0 and this_cov < 50:
            alerts.append({
                "type": "low_channel_coverage",
                "severity": "high",
                "title": f"Canal {ch_name}: cobertura {this_cov}%",
                "detail": f"{this_visited}/{len(ch_pdvs)} PDVs visitados este mes",
                "channel": ch_name,
            })

    # Sort by severity
    sev_order = {"high": 0, "medium": 1, "low": 2}
    alerts.sort(key=lambda a: sev_order.get(a["severity"], 3))

    return {
        "total": len(alerts),
        "high": sum(1 for a in alerts if a["severity"] == "high"),
        "medium": sum(1 for a in alerts if a["severity"] == "medium"),
        "low": sum(1 for a in alerts if a["severity"] == "low"),
        "alerts": alerts,
    }


# ─── Product Analytics ───────────────────────────────────────────────

@router.get("/product-analytics")
def product_analytics(db: Session = Depends(get_db)):
    """Analytics de productos basado en datos de cobertura de visitas.

    Para cada producto, calcula métricas del último relevamiento por PDV
    (evita duplicar si un PDV fue visitado múltiples veces).
    """
    import statistics

    # Subquery: último VisitCoverageId por (ProductId, PdvId)
    # = la entrada de cobertura más reciente para cada producto en cada PDV
    latest_sq = (
        db.query(
            VisitCoverageModel.ProductId,
            VisitModel.PdvId,
            sqlfunc.max(VisitCoverageModel.VisitCoverageId).label("latest_id"),
        )
        .join(VisitModel, VisitModel.VisitId == VisitCoverageModel.VisitId)
        .group_by(VisitCoverageModel.ProductId, VisitModel.PdvId)
        .subquery()
    )

    # Fetch all latest coverage rows with product info
    rows = (
        db.query(
            VisitCoverageModel.ProductId,
            VisitCoverageModel.Works,
            VisitCoverageModel.Price,
            VisitCoverageModel.Availability,
            VisitModel.PdvId,
            VisitCoverageModel.CreatedAt,
        )
        .join(latest_sq, VisitCoverageModel.VisitCoverageId == latest_sq.c.latest_id)
        .join(VisitModel, VisitModel.VisitId == VisitCoverageModel.VisitId)
        .all()
    )

    # Group by product
    product_data: dict[int, list] = {}
    for r in rows:
        product_data.setdefault(r.ProductId, []).append(r)

    # Load all products
    products = {p.ProductId: p for p in db.query(ProductModel).all()}

    by_product = []
    for pid, entries in product_data.items():
        p = products.get(pid)
        if not p:
            continue
        pdv_count = len(entries)
        works_entries = [e for e in entries if e.Works]
        works_count = len(works_entries)
        prices = [float(e.Price) for e in works_entries if e.Price is not None and float(e.Price) > 0]
        available_count = sum(1 for e in works_entries if e.Availability == "disponible")
        out_of_stock_count = sum(1 for e in works_entries if e.Availability == "quiebre")
        last_seen = max((e.CreatedAt for e in entries), default=None)

        avg_price = round(statistics.mean(prices), 2) if prices else None
        median_price = round(statistics.median(prices), 2) if prices else None
        min_price = round(min(prices), 2) if prices else None
        max_price = round(max(prices), 2) if prices else None
        std_dev = round(statistics.stdev(prices), 2) if len(prices) >= 2 else None

        by_product.append({
            "ProductId": pid,
            "Name": p.Name,
            "Category": p.Category,
            "IsOwn": p.IsOwn,
            "Manufacturer": p.Manufacturer,
            "pdvCount": pdv_count,
            "worksCount": works_count,
            "avgPrice": avg_price,
            "medianPrice": median_price,
            "minPrice": min_price,
            "maxPrice": max_price,
            "stdDev": std_dev,
            "availableCount": available_count,
            "outOfStockCount": out_of_stock_count,
            "lastSeen": last_seen.isoformat() if last_seen else None,
        })

    by_product.sort(key=lambda x: (x["Category"] or "", x["Name"]))

    # Category summary
    cat_map: dict[str, list] = {}
    for bp in by_product:
        cat_map.setdefault(bp["Category"] or "Sin categoría", []).append(bp)

    by_category = []
    total_pdvs = db.query(PDVModel).filter(PDVModel.IsActive == True).count()
    for cat, items in sorted(cat_map.items()):
        pdvs_with_cat = set()
        for item in items:
            pdvs_with_cat.update(e.PdvId for e in product_data.get(item["ProductId"], []) if e.Works)
        avg_coverage = round(len(pdvs_with_cat) / total_pdvs * 100, 1) if total_pdvs else 0
        by_category.append({
            "Category": cat,
            "productCount": len(items),
            "avgCoverage": avg_coverage,
        })

    # Totals
    all_pdv_ids = set()
    all_visit_ids = set()
    for entries in product_data.values():
        for e in entries:
            all_pdv_ids.add(e.PdvId)

    total_visits_with_coverage = (
        db.query(sqlfunc.count(sqlfunc.distinct(VisitCoverageModel.VisitId))).scalar() or 0
    )

    return {
        "byProduct": by_product,
        "byCategory": by_category,
        "totalPdvsWithCoverage": len(all_pdv_ids),
        "totalVisitsWithCoverage": total_visits_with_coverage,
    }


# ─── Supplier Analytics ──────────────────────────────────────────────

@router.get("/supplier-analytics")
def supplier_analytics(db: Session = Depends(get_db)):
    """Analytics de proveedores censados por PDV."""
    import json as _json

    suppliers = db.query(PdvSupplierModel).filter(PdvSupplierModel.IsActive == True).all()
    types = {t.SupplierTypeId: t.Name for t in db.query(SupplierTypeModel).all()}
    zones = {z.ZoneId: z.Name for z in db.query(ZoneModel).all()}

    total = len(suppliers)
    # PdvId NULL = entrada de catálogo de zona, no cuenta como PDV censado
    pdv_ids = set(s.PdvId for s in suppliers if s.PdvId is not None)
    total_pdvs = len(pdv_ids)

    # By type
    by_type: dict[str, int] = {}
    for s in suppliers:
        tname = types.get(s.SupplierTypeId, "Sin tipo")
        by_type[tname] = by_type.get(tname, 0) + 1

    # By zone
    by_zone: dict[str, int] = {}
    for s in suppliers:
        zname = zones.get(s.ZoneId, "Sin zona") if s.ZoneId else "Sin zona"
        by_zone[zname] = by_zone.get(zname, 0) + 1

    # By product
    by_product: dict[str, int] = {}
    for s in suppliers:
        if s.Products:
            try:
                prods = _json.loads(s.Products)
                for p in prods:
                    by_product[p] = by_product.get(p, 0) + 1
            except (ValueError, TypeError):
                pass

    # Top suppliers (most PDVs)
    supplier_pdv_count: dict[str, set] = {}
    for s in suppliers:
        # phone as unique identifier; sin teléfono, el nombre evita mezclar proveedores
        key = s.Phone or f"name:{s.Name.strip().lower()}"
        supplier_pdv_count.setdefault(key, {"name": s.Name, "phone": s.Phone, "pdvs": set(), "type": types.get(s.SupplierTypeId, "-")})
        if s.PdvId is not None:
            supplier_pdv_count[key]["pdvs"].add(s.PdvId)

    top_suppliers = sorted(
        [{"name": v["name"], "phone": v["phone"], "type": v["type"], "pdvCount": len(v["pdvs"])} for v in supplier_pdv_count.values()],
        key=lambda x: -x["pdvCount"],
    )[:20]

    return {
        "totalSuppliers": total,
        "totalPdvsWithSuppliers": total_pdvs,
        "byType": [{"type": k, "count": v} for k, v in sorted(by_type.items(), key=lambda x: -x[1])],
        "byZone": [{"zone": k, "count": v} for k, v in sorted(by_zone.items(), key=lambda x: -x[1])],
        "byProduct": [{"product": k, "count": v} for k, v in sorted(by_product.items(), key=lambda x: -x[1])],
        "topSuppliers": top_suppliers,
    }


# ─── Route Analytics ─────────────────────────────────────────────────

@router.get("/route-analytics")
def route_analytics(db: Session = Depends(get_db)):
    """Analytics de rutas: cumplimiento, cobertura, días."""
    today = datetime.now(timezone.utc).date()
    thirty_days_ago = today - timedelta(days=30)

    routes = db.query(RouteModel).filter(RouteModel.IsActive == True).all()
    zones = {z.ZoneId: z.Name for z in db.query(ZoneModel).all()}
    users = {u.UserId: u.DisplayName for u in db.query(UserModel).all()}

    result = []
    for r in routes:
        # PDV count
        pdv_count = db.query(sqlfunc.count(RoutePdvModel.PdvId)).filter(RoutePdvModel.RouteId == r.RouteId).scalar() or 0

        # Route days in last 30 days
        days = db.query(RouteDayModel).filter(
            RouteDayModel.RouteId == r.RouteId,
            RouteDayModel.WorkDate >= thirty_days_ago,
            RouteDayModel.WorkDate <= today,
        ).all()
        total_days = len(days)
        completed_days = sum(1 for d in days if d.Status in ("COMPLETED", "CLOSED"))

        # Future planned days
        future_days = db.query(sqlfunc.count(RouteDayModel.RouteDayId)).filter(
            RouteDayModel.RouteId == r.RouteId,
            RouteDayModel.WorkDate > today,
            RouteDayModel.Status == "PLANNED",
        ).scalar() or 0

        # Visits in last 30 days for this route's PDVs
        route_pdv_ids = [row[0] for row in db.query(RoutePdvModel.PdvId).filter(RoutePdvModel.RouteId == r.RouteId).all()]
        visit_count = 0
        if route_pdv_ids:
            visit_count = db.query(sqlfunc.count(VisitModel.VisitId)).filter(
                VisitModel.PdvId.in_(route_pdv_ids),
                VisitModel.OpenedAt >= datetime.combine(thirty_days_ago, datetime.min.time()).replace(tzinfo=timezone.utc),
                VisitModel.Status.in_(["CLOSED", "COMPLETED"]),
            ).scalar() or 0

        compliance = round(completed_days / total_days * 100) if total_days > 0 else 0

        result.append({
            "RouteId": r.RouteId,
            "Name": r.Name,
            "Zone": zones.get(r.ZoneId, "-") if r.ZoneId else "-",
            "AssignedUser": users.get(r.AssignedUserId, "Sin asignar") if r.AssignedUserId else "Sin asignar",
            "FrequencyType": r.FrequencyType or "-",
            "pdvCount": pdv_count,
            "totalDays30d": total_days,
            "completedDays30d": completed_days,
            "compliance30d": compliance,
            "futurePlannedDays": future_days,
            "visits30d": visit_count,
        })

    result.sort(key=lambda x: -x["compliance30d"])

    total_routes = len(routes)
    total_pdvs_in_routes = sum(r["pdvCount"] for r in result)
    avg_compliance = round(sum(r["compliance30d"] for r in result) / total_routes) if total_routes else 0

    return {
        "totalRoutes": total_routes,
        "totalPdvsInRoutes": total_pdvs_in_routes,
        "avgCompliance": avg_compliance,
        "routes": result,
    }


# ─── PDV Analytics ───────────────────────────────────────────────────

@router.get("/pdv-analytics")
def pdv_analytics(db: Session = Depends(get_db)):
    """Analytics de PDVs: estado, distribución, actividad."""
    pdvs = db.query(PDVModel).all()
    zones = {z.ZoneId: z.Name for z in db.query(ZoneModel).all()}
    channels = {c.ChannelId: c.Name for c in db.query(ChannelModel).all()}

    total = len(pdvs)
    active = sum(1 for p in pdvs if p.IsActive)
    inactive = total - active
    with_coords = sum(1 for p in pdvs if p.Lat and p.Lon)
    assigned = sum(1 for p in pdvs if p.AssignedUserId)

    # By channel
    by_channel: dict[str, int] = {}
    for p in pdvs:
        ch = channels.get(p.ChannelId, p.Channel or "Sin canal")
        by_channel[ch] = by_channel.get(ch, 0) + 1

    # By zone
    by_zone: dict[str, int] = {}
    for p in pdvs:
        z = zones.get(p.ZoneId, "Sin zona") if p.ZoneId else "Sin zona"
        by_zone[z] = by_zone.get(z, 0) + 1

    # By category (volume)
    by_category: dict[str, int] = {}
    for p in pdvs:
        cat = p.Category or "Sin categorizar"
        by_category[cat] = by_category.get(cat, 0) + 1

    # Recent visit activity (last 30 days)
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    visit_counts = dict(
        db.query(VisitModel.PdvId, sqlfunc.count(VisitModel.VisitId))
        .filter(VisitModel.OpenedAt >= thirty_days_ago, VisitModel.Status.in_(["CLOSED", "COMPLETED"]))
        .group_by(VisitModel.PdvId)
        .all()
    )
    visited_30d = len(visit_counts)
    never_visited = sum(1 for p in pdvs if p.IsActive and p.PdvId not in visit_counts)

    return {
        "total": total,
        "active": active,
        "inactive": inactive,
        "withCoords": with_coords,
        "assigned": assigned,
        "visited30d": visited_30d,
        "neverVisited": never_visited,
        "byChannel": [{"channel": k, "count": v} for k, v in sorted(by_channel.items(), key=lambda x: -x[1])],
        "byZone": [{"zone": k, "count": v} for k, v in sorted(by_zone.items(), key=lambda x: -x[1])],
        "byCategory": [{"category": k, "count": v} for k, v in sorted(by_category.items(), key=lambda x: -x[1])],
    }


# ── Product deliveries report (canje, promo, juego actions) ──────────

_DELIVERY_ACTION_TYPES = {"canje_sueltos", "promo", "juego"}


@router.get("/product-deliveries")
def product_deliveries(
    date_from: str | None = None,
    date_to: str | None = None,
    user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Actions that involve product delivery (canje, promo, juego), filtered by hierarchy."""
    role = get_user_role(db, current_user.UserId)
    visible = get_visible_user_ids(db, current_user, role)

    q = (
        db.query(
            VisitActionModel,
            VisitModel.OpenedAt,
            UserModel.DisplayName.label("UserName"),
            UserModel.Email.label("UserEmail"),
            PDVModel.Name.label("PdvName"),
            PDVModel.Address.label("PdvAddress"),
            ZoneModel.Name.label("ZoneName"),
        )
        .join(VisitModel, VisitActionModel.VisitId == VisitModel.VisitId)
        .join(UserModel, VisitModel.UserId == UserModel.UserId)
        .join(PDVModel, VisitModel.PdvId == PDVModel.PdvId)
        .outerjoin(ZoneModel, PDVModel.ZoneId == ZoneModel.ZoneId)
        .filter(VisitActionModel.ActionType.in_(_DELIVERY_ACTION_TYPES))
    )

    # Hierarchy filter
    if visible is not None:
        q = q.filter(VisitModel.UserId.in_(visible))
    if user_id is not None:
        q = q.filter(VisitModel.UserId == user_id)

    # Date filter
    if date_from:
        try:
            q = q.filter(VisitModel.OpenedAt >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            end = datetime.fromisoformat(date_to) + timedelta(days=1)
            q = q.filter(VisitModel.OpenedAt < end)
        except ValueError:
            pass

    q = q.order_by(VisitModel.OpenedAt.desc())
    rows = q.all()

    result = []
    for action, opened_at, user_name, user_email, pdv_name, pdv_address, zone_name in rows:
        details = {}
        if action.DetailsJson:
            try:
                details = _json.loads(action.DetailsJson)
            except _json.JSONDecodeError:
                details = {}

        result.append({
            "VisitActionId": action.VisitActionId,
            "VisitId": action.VisitId,
            "Date": opened_at.isoformat() if opened_at else None,
            "UserName": user_name,
            "UserEmail": user_email,
            "PdvName": pdv_name,
            "PdvAddress": pdv_address or "",
            "ZoneName": zone_name or "",
            "ActionType": action.ActionType,
            "Description": action.Description or "",
            "Details": details,
        })

    return result
