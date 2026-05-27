"""
Aggregated dashboard endpoint for the Home screen.

Combines route-day PDVs, open visit detection, monthly stats, and alert count
into a single API call — replaces 5+ sequential calls from the frontend.
"""
from datetime import datetime, timedelta, timezone, date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user, get_user_role
from ..database import get_db
from ..models import (
    User as UserModel,
    Visit as VisitModel,
    PDV as PDVModel,
    Route as RouteModel,
    RouteDay as RouteDayModel,
    RouteDayPdv as RouteDayPdvModel,
    Incident as IncidentModel,
    Notification as NotificationModel,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/home")
def home_data(
    date_str: str = Query(alias="date", description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """All data the Home screen needs in one round-trip."""
    user_id = current_user.UserId
    role = get_user_role(db, user_id)
    is_admin = role in ("admin", "regional_manager", "territory_manager")

    # ── 1. Route day PDVs (same logic as /routes/day-detail) ──
    q = db.query(RouteDayModel).filter(RouteDayModel.WorkDate == date_str)
    if not is_admin:
        q = q.filter(RouteDayModel.AssignedUserId == user_id)
    route_days = q.all()

    route_day_pdvs = []
    if route_days:
        route_ids = {rd.RouteId for rd in route_days}
        routes_map = {r.RouteId: r for r in db.query(RouteModel).filter(RouteModel.RouteId.in_(route_ids)).all()}

        day_ids = [rd.RouteDayId for rd in route_days]
        day_pdvs = (
            db.query(RouteDayPdvModel)
            .filter(RouteDayPdvModel.RouteDayId.in_(day_ids))
            .order_by(RouteDayPdvModel.PlannedOrder)
            .all()
        )

        pdv_ids = {dp.PdvId for dp in day_pdvs}
        pdvs_map = {p.PdvId: p for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()} if pdv_ids else {}

        seen = set()
        for dp in day_pdvs:
            if dp.PdvId in seen:
                continue
            seen.add(dp.PdvId)
            pdv = pdvs_map.get(dp.PdvId)
            if not pdv:
                continue
            rd = next((rd for rd in route_days if rd.RouteDayId == dp.RouteDayId), None)
            route = routes_map.get(rd.RouteId) if rd else None
            route_day_pdvs.append({
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

    # ── 2. Open / In-progress visit ──
    open_visit = None
    visit = (
        db.query(VisitModel)
        .filter(VisitModel.UserId == user_id, VisitModel.Status.in_(("OPEN", "IN_PROGRESS")))
        .order_by(VisitModel.OpenedAt.desc())
        .first()
    )
    if visit:
        pdv = db.query(PDVModel).filter(PDVModel.PdvId == visit.PdvId).first()
        if pdv:
            open_visit = {
                "VisitId": visit.VisitId,
                "PdvId": visit.PdvId,
                "PdvName": pdv.Name,
                "Status": visit.Status,
            }

    # ── 3. Monthly stats ──
    now = datetime.now(timezone.utc)
    first_day = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 12:
        last_day = now.replace(day=31, hour=23, minute=59, second=59, microsecond=999999)
    else:
        last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(microseconds=1)

    visits_month = (
        db.query(VisitModel)
        .filter(
            VisitModel.UserId == user_id,
            VisitModel.OpenedAt >= first_day,
            VisitModel.OpenedAt <= last_day,
        )
        .all()
    )
    total_visits = len(visits_month)
    completed = sum(1 for v in visits_month if v.Status and v.Status.upper() in ("CLOSED", "COMPLETED"))
    compliance = round((completed / total_visits * 100) if total_visits > 0 else 0)

    pdv_q = db.query(PDVModel).filter(PDVModel.CreatedAt >= first_day, PDVModel.CreatedAt <= last_day)
    if current_user.ZoneId:
        pdv_q = pdv_q.filter(PDVModel.ZoneId == current_user.ZoneId)
    new_pdvs = pdv_q.count()

    monthly_stats = {"visits": total_visits, "compliance": compliance, "new_pdvs": new_pdvs}

    # ── 4. Alert count (open incidents + active notifications) ──
    incident_count = (
        db.query(IncidentModel)
        .filter(IncidentModel.Status.in_(("OPEN", "PENDING")))
        .count()
    )
    notification_count = (
        db.query(NotificationModel)
        .filter(
            NotificationModel.IsActive == True,
            NotificationModel.ExpiresAt > now,
        )
        .count()
    )

    return {
        "routeDayPdvs": route_day_pdvs,
        "openVisit": open_visit,
        "monthlyStats": monthly_stats,
        "alertCount": incident_count + notification_count,
    }
