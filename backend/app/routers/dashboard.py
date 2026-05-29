"""
Aggregated dashboard endpoint for the Home screen.

Combines route-day PDVs, open visit detection, monthly stats, and alert count
into a single API call — replaces 5+ sequential calls from the frontend.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func as sa_func, case, and_
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

    # ── 1. Route day PDVs — single joined query instead of 4 sequential ones ──
    rdp_query = (
        db.query(
            RouteDayPdvModel.RouteDayId,
            RouteDayPdvModel.PdvId,
            RouteDayPdvModel.PlannedOrder,
            RouteDayPdvModel.ExecutionStatus,
            RouteDayPdvModel.Priority,
            RouteModel.RouteId,
            RouteModel.Name.label("RouteName"),
            PDVModel.PdvId.label("pdv_PdvId"),
            PDVModel.Name.label("pdv_Name"),
            PDVModel.Address.label("pdv_Address"),
            PDVModel.Lat.label("pdv_Lat"),
            PDVModel.Lon.label("pdv_Lon"),
            PDVModel.ChannelId.label("pdv_ChannelId"),
            PDVModel.SubChannelId.label("pdv_SubChannelId"),
            PDVModel.ZoneId.label("pdv_ZoneId"),
            PDVModel.IsActive.label("pdv_IsActive"),
            PDVModel.BusinessName.label("pdv_BusinessName"),
        )
        .join(RouteDayModel, RouteDayPdvModel.RouteDayId == RouteDayModel.RouteDayId)
        .join(RouteModel, RouteDayModel.RouteId == RouteModel.RouteId)
        .join(PDVModel, RouteDayPdvModel.PdvId == PDVModel.PdvId)
        .filter(RouteDayModel.WorkDate == date_str)
    )
    if not is_admin:
        rdp_query = rdp_query.filter(RouteDayModel.AssignedUserId == user_id)

    rdp_query = rdp_query.order_by(RouteDayPdvModel.PlannedOrder)
    rows = rdp_query.all()

    route_day_pdvs = []
    seen = set()
    for r in rows:
        if r.PdvId in seen:
            continue
        seen.add(r.PdvId)
        route_day_pdvs.append({
            "RouteDayId": r.RouteDayId,
            "PdvId": r.PdvId,
            "PlannedOrder": r.PlannedOrder,
            "ExecutionStatus": r.ExecutionStatus,
            "Priority": r.Priority,
            "routeName": r.RouteName,
            "routeId": r.RouteId,
            "pdv": {
                "PdvId": r.pdv_PdvId, "Name": r.pdv_Name, "Address": r.pdv_Address,
                "Lat": r.pdv_Lat, "Lon": r.pdv_Lon, "ChannelId": r.pdv_ChannelId,
                "SubChannelId": r.pdv_SubChannelId, "ZoneId": r.pdv_ZoneId,
                "IsActive": r.pdv_IsActive, "BusinessName": r.pdv_BusinessName,
            },
        })

    # ── 2. Open / In-progress visit — join PDV in same query ──
    open_visit = None
    visit_row = (
        db.query(
            VisitModel.VisitId,
            VisitModel.PdvId,
            VisitModel.Status,
            PDVModel.Name.label("PdvName"),
        )
        .join(PDVModel, VisitModel.PdvId == PDVModel.PdvId)
        .filter(VisitModel.UserId == user_id, VisitModel.Status.in_(("OPEN", "IN_PROGRESS")))
        .order_by(VisitModel.OpenedAt.desc())
        .first()
    )
    if visit_row:
        open_visit = {
            "VisitId": visit_row.VisitId,
            "PdvId": visit_row.PdvId,
            "PdvName": visit_row.PdvName,
            "Status": visit_row.Status,
        }

    # ── 3. Monthly stats — COUNT in DB instead of loading all rows ──
    now = datetime.now(timezone.utc)
    first_day = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 12:
        last_day = now.replace(day=31, hour=23, minute=59, second=59, microsecond=999999)
    else:
        last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(microseconds=1)

    month_filter = and_(
        VisitModel.UserId == user_id,
        VisitModel.OpenedAt >= first_day,
        VisitModel.OpenedAt <= last_day,
    )
    stats = db.query(
        sa_func.count(VisitModel.VisitId).label("total"),
        sa_func.sum(
            case(
                (VisitModel.Status.in_(("CLOSED", "COMPLETED")), 1),
                else_=0,
            )
        ).label("completed"),
    ).filter(month_filter).one()

    total_visits = stats.total or 0
    completed = stats.completed or 0
    compliance = round((completed / total_visits * 100) if total_visits > 0 else 0)

    pdv_q = db.query(sa_func.count(PDVModel.PdvId)).filter(
        PDVModel.CreatedAt >= first_day, PDVModel.CreatedAt <= last_day
    )
    if current_user.ZoneId:
        pdv_q = pdv_q.filter(PDVModel.ZoneId == current_user.ZoneId)
    new_pdvs = pdv_q.scalar() or 0

    monthly_stats = {"visits": total_visits, "compliance": compliance, "new_pdvs": new_pdvs}

    # ── 4. Alert count — single query with two subqueries ──
    incident_count = (
        db.query(sa_func.count(IncidentModel.IncidentId))
        .filter(IncidentModel.Status.in_(("OPEN", "PENDING")))
        .scalar()
    ) or 0
    notification_count = (
        db.query(sa_func.count(NotificationModel.NotificationId))
        .filter(
            NotificationModel.IsActive == True,
            NotificationModel.ExpiresAt > now,
        )
        .scalar()
    ) or 0

    return {
        "routeDayPdvs": route_day_pdvs,
        "openVisit": open_visit,
        "monthlyStats": monthly_stats,
        "alertCount": incident_count + notification_count,
    }
