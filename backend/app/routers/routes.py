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
    if new_assigned_user != "__unchanged__":
        pdv_ids = [
            row[0]
            for row in db.query(RoutePdvModel.PdvId).filter(RoutePdvModel.RouteId == route_id).all()
        ]
        if pdv_ids:
            db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).update(
                {PDVModel.AssignedUserId: new_assigned_user}, synchronize_session=False
            )

    db.commit()
    db.refresh(r)
    return _route_to_response(r, db)


@router.delete("/{route_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_route(route_id: int, db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
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

    # Invalidar optimización (task 11)
    route = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if route:
        route.IsOptimized = False

    db.commit()


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


# --- RouteDay ---
@router.get("/{route_id}/days", response_model=list[RouteDay])
def list_route_days(route_id: int, db: Session = Depends(get_db)):
    return db.query(RouteDayModel).filter(RouteDayModel.RouteId == route_id).all()


@router.post("/{route_id}/days", response_model=RouteDay, status_code=201)
def create_route_day(route_id: int, data: RouteDayCreate, db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
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
def delete_route_day(route_day_id: int, db: Session = Depends(get_db)):
    rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == route_day_id).first()
    if not rd:
        raise HTTPException(status_code=404, detail="Día de ruta no encontrado")
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
def update_route_day(route_day_id: int, data: RouteDayUpdate, db: Session = Depends(get_db)):
    rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == route_day_id).first()
    if not rd:
        raise HTTPException(status_code=404, detail="Día de ruta no encontrado")
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
def add_route_day_pdv(route_day_id: int, data: RouteDayPdvCreate, db: Session = Depends(get_db)):
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
def update_route_day_pdv(route_day_id: int, pdv_id: int, data: RouteDayPdvUpdate, db: Session = Depends(get_db)):
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
