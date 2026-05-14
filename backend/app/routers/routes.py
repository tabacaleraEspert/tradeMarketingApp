from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..auth import require_role, get_current_user, get_user_role
from ..database import get_db
from ..hierarchy import get_visible_user_ids
from ..models import (
    Route as RouteModel,
    RouteForm as RouteFormModel,
    RoutePdv as RoutePdvModel,
    RouteDay as RouteDayModel,
    RouteDayPdv as RouteDayPdvModel,
    PDV as PDVModel,
    User as UserModel,
)
from ..models.channel import Channel as ChannelModel
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
        "CreatedByUserId": getattr(r, "CreatedByUserId", None),
        "PdvCount": pdv_count,
        "CreatedAt": r.CreatedAt,
    }
    return Route.model_validate(data)


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
    rows = db.query(RoutePdvModel.PdvId, RoutePdvModel.RouteId).all()
    return [{"pdvId": pid, "routeId": rid} for pid, rid in rows]


# --- Route Map Overview ---
@router.get("/map-overview", dependencies=[Depends(get_current_user)])
def routes_map_overview(db: Session = Depends(get_db)):
    """All routes with their PDV coordinates for map visualization."""
    routes = db.query(RouteModel).filter(RouteModel.IsActive== True).all()
    ch_map = {c.ChannelId: c.Name for c in db.query(ChannelModel).all()}

    all_routed_pdv_ids: set[int] = set()
    route_list = []
    for r in routes:
        route_pdvs = (
            db.query(RoutePdvModel)
            .filter(RoutePdvModel.RouteId == r.RouteId)
            .order_by(RoutePdvModel.SortOrder)
            .all()
        )
        pdv_ids = [rp.PdvId for rp in route_pdvs]
        all_routed_pdv_ids.update(pdv_ids)
        if not pdv_ids:
            continue
        pdvs = db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()
        pdv_map = {p.PdvId: p for p in pdvs}

        # Assigned user
        assigned_user_id = getattr(r, "AssignedUserId", None)
        assigned_user_name = None
        if assigned_user_id:
            user = db.query(UserModel).filter(UserModel.UserId == assigned_user_id).first()
            if user:
                assigned_user_name = user.DisplayName

        pdv_list = []
        for rp in route_pdvs:
            p = pdv_map.get(rp.PdvId)
            if not p:
                continue
            pdv_list.append({
                "pdvId": p.PdvId,
                "name": p.Name,
                "address": p.Address or p.City or "",
                "lat": float(p.Lat) if p.Lat is not None else None,
                "lon": float(p.Lon) if p.Lon is not None else None,
                "channel": ch_map.get(p.ChannelId, p.Channel or ""),
                "sortOrder": rp.SortOrder,
            })

        route_list.append({
            "routeId": r.RouteId,
            "name": r.Name,
            "assignedUserName": assigned_user_name,
            "bejermanZone": getattr(r, "BejermanZone", None),
            "frequencyType": getattr(r, "FrequencyType", None),
            "frequencyConfig": getattr(r, "FrequencyConfig", None),
            "pdvs": pdv_list,
        })

    # PDVs without any route (for coverage gaps)
    unrouted = (
        db.query(PDVModel)
        .filter(
            PDVModel.IsActive== True,
            PDVModel.Lat.isnot(None),
            ~PDVModel.PdvId.in_(all_routed_pdv_ids) if all_routed_pdv_ids else True,
        )
        .all()
    )
    unrouted_list = [
        {
            "pdvId": p.PdvId,
            "name": p.Name,
            "address": p.Address or p.City or "",
            "lat": float(p.Lat) if p.Lat is not None else None,
            "lon": float(p.Lon) if p.Lon is not None else None,
            "channel": ch_map.get(p.ChannelId, p.Channel or ""),
        }
        for p in unrouted
        if p.Lat is not None
    ]

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
    routes = db.query(RouteModel).filter(RouteModel.AssignedUserId == user_id).order_by(RouteModel.RouteId).all()
    if not routes:
        return []

    route_ids = [r.RouteId for r in routes]
    # Get all route PDVs in one query
    all_rps = db.query(RoutePdvModel).filter(RoutePdvModel.RouteId.in_(route_ids)).order_by(RoutePdvModel.SortOrder).all()
    # Get all PDV details
    pdv_ids = {rp.PdvId for rp in all_rps}
    pdvs_map = {p.PdvId: p for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()} if pdv_ids else {}

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
            "BejermanZone": r.BejermanZone, "FrequencyType": r.FrequencyType,
            "EstimatedMinutes": r.EstimatedMinutes, "IsOptimized": r.IsOptimized,
            "pdvs": pdvs,
        })
    return result


# --- Route ---
@router.get("", response_model=list[Route])
def list_routes(
    skip: int = 0,
    limit: int = Query(default=100, le=500),
    created_by: int | None = None,
    assigned_user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Lista rutas. Filtra automáticamente por la sub-jerarquía del usuario que pregunta:
    - admin → ve todas
    - territory_manager / ejecutivo → ve las asignadas a sí mismo o sus subordinados
    - vendedor (TM Rep) → sólo las asignadas a sí mismo
    """
    role_name = get_user_role(db, current_user.UserId)
    visible_ids = get_visible_user_ids(db, current_user, role_name)

    q = db.query(RouteModel)
    if created_by is not None:
        q = q.filter(RouteModel.CreatedByUserId == created_by)
    if assigned_user_id is not None:
        q = q.filter(RouteModel.AssignedUserId == assigned_user_id)

    # Filtro de sub-árbol para no-admin: rutas asignadas a alguien visible (o sin asignar)
    if visible_ids is not None:
        from sqlalchemy import or_
        q = q.filter(or_(
            RouteModel.AssignedUserId.in_(visible_ids),
            RouteModel.AssignedUserId.is_(None),
        ))

    routes = q.order_by(RouteModel.RouteId).offset(skip).limit(limit).all()
    return [_route_to_response(r, db) for r in routes]


@router.get("/{route_id}", response_model=Route)
def get_route(route_id: int, db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    return _route_to_response(r, db)


@router.post("", response_model=Route, status_code=201, dependencies=[Depends(require_role("vendedor"))])
def create_route(data: RouteCreate, db: Session = Depends(get_db)):
    r = RouteModel(
        Name=data.Name,
        ZoneId=data.ZoneId,
        FormId=data.FormId,
        IsActive=data.IsActive,
        CreatedByUserId=data.CreatedByUserId,
        AssignedUserId=data.AssignedUserId,
        BejermanZone=data.BejermanZone,
        FrequencyType=data.FrequencyType,
        FrequencyConfig=data.FrequencyConfig,
        EstimatedMinutes=data.EstimatedMinutes,
    )
    db.add(r)
    db.flush()
    if data.FormId is not None:
        rf = RouteFormModel(RouteId=r.RouteId, FormId=data.FormId, SortOrder=0)
        db.add(rf)
    from ..audit_log import audit
    audit(db, getattr(r, "CreatedByUserId", None), "Route", r.RouteId, "create", r.Name)
    db.commit()
    db.refresh(r)
    return _route_to_response(r, db)


@router.patch("/{route_id}", response_model=Route, dependencies=[Depends(require_role("vendedor"))])
def update_route(route_id: int, data: RouteUpdate, db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    update_data = data.model_dump(exclude_unset=True)
    new_assigned_user = update_data.get("AssignedUserId", "__unchanged__")
    for k, v in update_data.items():
        setattr(r, k, v)

    # Propagar el cambio de Trade Marketer a todos los PDVs de la ruta (task 13)
    today = _today_ar()

    if new_assigned_user != "__unchanged__":
        pdv_ids = [
            row[0]
            for row in db.query(RoutePdvModel.PdvId).filter(RoutePdvModel.RouteId == route_id).all()
        ]
        if pdv_ids:
            db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).update(
                {PDVModel.AssignedUserId: new_assigned_user}, synchronize_session=False
            )

        # Update future PLANNED RouteDays
        future_days = db.query(RouteDayModel).filter(
            RouteDayModel.RouteId == route_id,
            RouteDayModel.WorkDate >= today,
            RouteDayModel.Status == "PLANNED",
        ).all()
        if new_assigned_user is None:
            # Desasignar: borrar días futuros planificados
            for fd in future_days:
                db.delete(fd)
        else:
            # Reasignar: actualizar AssignedUserId en días futuros
            for fd in future_days:
                fd.AssignedUserId = new_assigned_user

    # Si cambió la frecuencia, borrar días futuros PLANNED para que el frontend regenere
    freq_changed = "FrequencyType" in update_data or "FrequencyConfig" in update_data
    if freq_changed:
        db.query(RouteDayModel).filter(
            RouteDayModel.RouteId == route_id,
            RouteDayModel.WorkDate >= today,
            RouteDayModel.Status == "PLANNED",
        ).delete(synchronize_session=False)

    from ..audit_log import audit
    changed = ", ".join(update_data.keys())
    audit(db, getattr(r, "AssignedUserId", None), "Route", route_id, "update", changed)
    db.commit()
    db.refresh(r)
    return _route_to_response(r, db)


@router.delete("/{route_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_route(route_id: int, db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")

    # PDVs keep their AssignedUserId — deleting a route does NOT unassign the TM.
    # Only removing a PDV from a route or explicitly unassigning clears the TM.

    # Manually delete children (MSSQL may not enforce CASCADE reliably via ORM)
    day_ids = [d.RouteDayId for d in db.query(RouteDayModel).filter(RouteDayModel.RouteId == route_id).all()]
    if day_ids:
        db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId.in_(day_ids)).delete(synchronize_session=False)
    db.query(RouteDayModel).filter(RouteDayModel.RouteId == route_id).delete(synchronize_session=False)
    db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id).delete(synchronize_session=False)
    db.query(RouteFormModel).filter(RouteFormModel.RouteId == route_id).delete(synchronize_session=False)

    # SET NULL on MandatoryActivity
    from ..models.mandatory_activity import MandatoryActivity as MandatoryActivityModel
    db.query(MandatoryActivityModel).filter(MandatoryActivityModel.RouteId == route_id).update(
        {MandatoryActivityModel.RouteId: None}, synchronize_session=False
    )

    from ..audit_log import audit
    audit(db, None, "Route", route_id, "delete", r.Name)
    db.delete(r)
    db.commit()


# --- RoutePdv ---
@router.get("/{route_id}/pdvs", response_model=list[RoutePdv])
def list_route_pdvs(route_id: int, db: Session = Depends(get_db)):
    return db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id).order_by(RoutePdvModel.SortOrder).all()


@router.post("/{route_id}/pdvs", response_model=RoutePdv, status_code=201, dependencies=[Depends(require_role("vendedor"))])
def add_route_pdv(route_id: int, data: RoutePdvCreate, db: Session = Depends(get_db)):
    # Enforce PDV exclusivity: a PDV can only belong to one route at a time
    existing = (
        db.query(RoutePdvModel)
        .filter(RoutePdvModel.PdvId == data.PdvId)
        .first()
    )
    if existing:
        if existing.RouteId == route_id:
            # Ya está en esta ruta — actualizar el SortOrder en vez de fallar (reordenamiento)
            existing.SortOrder = data.SortOrder
            existing.Priority = data.Priority
            db.commit()
            db.refresh(existing)
            return existing
        other = db.query(RouteModel).filter(RouteModel.RouteId == existing.RouteId).first()
        other_name = other.Name if other else f"Ruta #{existing.RouteId}"
        raise HTTPException(
            status_code=409,
            detail=f"El PDV ya está asignado a la ruta '{other_name}'. Quitalo primero de esa ruta.",
        )
    rp = RoutePdvModel(
        RouteId=route_id,
        PdvId=data.PdvId,
        SortOrder=data.SortOrder,
        Priority=data.Priority,
    )
    db.add(rp)

    # Auto-asignar Trade Marketer al PDV si la ruta tiene uno (task 13)
    route = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if route and route.AssignedUserId is not None:
        pdv = db.query(PDVModel).filter(PDVModel.PdvId == data.PdvId).first()
        if pdv:
            pdv.AssignedUserId = route.AssignedUserId

    # Cualquier modificación de PDVs invalida la optimización (task 11)
    if route:
        route.IsOptimized = False

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
    db.refresh(rp)
    return rp


@router.delete("/{route_id}/pdvs/{pdv_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def remove_route_pdv(route_id: int, pdv_id: int, db: Session = Depends(get_db)):
    rp = db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id, RoutePdvModel.PdvId == pdv_id).first()
    if not rp:
        raise HTTPException(status_code=404, detail="PDV no encontrado en la ruta")
    db.delete(rp)

    # Limpiar el TM Rep asignado al PDV (task 13)
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if pdv:
        pdv.AssignedUserId = None

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
    route = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if route:
        route.IsOptimized = False

    db.commit()


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
    # Ownership: assigned user or manager+
    role = get_user_role(db, current_user.UserId)
    if role not in ("admin", "territory_manager", "regional_manager") and route.AssignedUserId != current_user.UserId:
        raise HTTPException(403, "No tiene permiso para reordenar esta ruta")
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


def _check_route_access(route: RouteModel, current_user: UserModel, db: Session):
    """Verify user owns the route or is a manager."""
    role = get_user_role(db, current_user.UserId)
    if role in ("admin", "territory_manager", "regional_manager"):
        return
    if route.AssignedUserId == current_user.UserId:
        return
    raise HTTPException(403, "No tiene permiso para modificar esta ruta")


@router.post("/{route_id}/days", response_model=RouteDay, status_code=201)
def create_route_day(route_id: int, data: RouteDayCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    _check_route_access(r, current_user, db)
    # Use route's assigned user if not specified
    user_id = data.AssignedUserId or getattr(r, "AssignedUserId", None)
    if not user_id:
        raise HTTPException(status_code=400, detail="Se requiere un Trade Marketer asignado")
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
    db.commit()
    db.refresh(rd)
    return rd


@router.delete("/days/{route_day_id}", status_code=204)
def delete_route_day(route_day_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == route_day_id).first()
    if not rd:
        raise HTTPException(status_code=404, detail="Día de ruta no encontrado")
    route = db.query(RouteModel).filter(RouteModel.RouteId == rd.RouteId).first()
    if route:
        _check_route_access(route, current_user, db)
    db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId == route_day_id).delete()
    db.delete(rd)
    db.commit()


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
        _check_route_access(route, current_user, db)
    if data.Status is not None:
        rd.Status = data.Status
    db.commit()
    db.refresh(rd)
    return rd


# --- RouteDayPdv ---
@router.get("/days/{route_day_id}/pdvs", response_model=list[RouteDayPdv])
def list_route_day_pdvs(route_day_id: int, db: Session = Depends(get_db)):
    return db.query(RouteDayPdvModel).filter(RouteDayPdvModel.RouteDayId == route_day_id).order_by(RouteDayPdvModel.PlannedOrder).all()


@router.post("/days/{route_day_id}/pdvs", response_model=RouteDayPdv, status_code=201)
def add_route_day_pdv(route_day_id: int, data: RouteDayPdvCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == route_day_id).first()
    if rd:
        route = db.query(RouteModel).filter(RouteModel.RouteId == rd.RouteId).first()
        if route:
            _check_route_access(route, current_user, db)
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


# ── Route Overlap Detection ──────────────────────────────
import json as _json
from datetime import date as _date, timedelta as _timedelta, datetime as _datetime, timezone as _tz

def _today_ar() -> _date:
    """Today's date in Argentina timezone (UTC-3). Servers may be in UTC."""
    ar_tz = _tz(_timedelta(hours=-3))
    return _datetime.now(ar_tz).date()


@router.get("/{route_id}/check-overlap")
def check_route_overlap(route_id: int, db: Session = Depends(get_db)):
    """Check if this route's frequency overlaps with other routes for the same user."""
    route = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    if not route.AssignedUserId or not route.FrequencyType:
        return {"overlaps": [], "hasOverlap": False}

    # Get all other active routes for the same user
    other_routes = (
        db.query(RouteModel)
        .filter(
            RouteModel.AssignedUserId == route.AssignedUserId,
            RouteModel.RouteId != route_id,
            RouteModel.IsActive == True,
            RouteModel.FrequencyType != None,
        )
        .all()
    )

    if not other_routes:
        return {"overlaps": [], "hasOverlap": False}

    # Generate next 8 weeks of dates for this route
    def generate_dates(freq: str, config_str: str | None) -> set[str]:
        config = _json.loads(config_str) if config_str else {}
        today = _today_ar()
        end = today + _timedelta(weeks=8)
        start = _date.fromisoformat(config["startDate"]) if config.get("startDate") else today
        if start < today:
            start = today
        dates = set()

        if freq == "daily":
            d = start
            while d <= end:
                if d.weekday() < 5:
                    dates.add(d.isoformat())
                d += _timedelta(days=1)
        elif freq == "weekly":
            day_js = config.get("day")
            if day_js is not None:
                py_wd = (day_js - 1) % 7
                d = start
                while d.weekday() != py_wd:
                    d += _timedelta(days=1)
                while d <= end:
                    dates.add(d.isoformat())
                    d += _timedelta(days=7)
        elif freq == "biweekly":
            day_js = config.get("day")
            if day_js is not None:
                py_wd = (day_js - 1) % 7
                d = start
                while d.weekday() != py_wd:
                    d += _timedelta(days=1)
                # Align to biweekly cycle from startDate
                anchor_str = config.get("startDate")
                if anchor_str:
                    anchor = _date.fromisoformat(anchor_str)
                    while anchor.weekday() != py_wd:
                        anchor += _timedelta(days=1)
                    diff = (d - anchor).days % 14
                    if diff != 0:
                        d += _timedelta(days=14 - diff)
                while d <= end:
                    dates.add(d.isoformat())
                    d += _timedelta(days=14)
            else:
                # Fallback: old behavior for routes without day set
                d = start
                while d <= end:
                    dates.add(d.isoformat())
                    d += _timedelta(days=14)
        elif freq == "every_15_days":
            interval = config.get("interval", 15)
            d = start
            while d <= end:
                dates.add(d.isoformat())
                d += _timedelta(days=interval)
        elif freq == "specific_days":
            day_list = config.get("days", [])
            d = start
            while d <= end:
                js_day = (d.weekday() + 1) % 7
                if js_day in day_list:
                    dates.add(d.isoformat())
                d += _timedelta(days=1)
        return dates

    my_dates = generate_dates(route.FrequencyType, route.FrequencyConfig)
    overlaps = []

    for other in other_routes:
        other_dates = generate_dates(other.FrequencyType, other.FrequencyConfig)
        common = my_dates & other_dates
        if common:
            overlaps.append({
                "routeId": other.RouteId,
                "routeName": other.Name,
                "overlapDates": sorted(list(common))[:5],
                "overlapCount": len(common),
            })

    return {
        "overlaps": overlaps,
        "hasOverlap": len(overlaps) > 0,
    }
