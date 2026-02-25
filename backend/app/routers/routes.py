from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import (
    Route as RouteModel,
    RouteForm as RouteFormModel,
    RoutePdv as RoutePdvModel,
    RouteDay as RouteDayModel,
    RouteDayPdv as RouteDayPdvModel,
)
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


# --- Route ---
@router.get("", response_model=list[Route])
def list_routes(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(RouteModel).order_by(RouteModel.RouteId).offset(skip).limit(limit).all()


@router.get("/{route_id}", response_model=Route)
def get_route(route_id: int, db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    return r


@router.post("", response_model=Route, status_code=201)
def create_route(data: RouteCreate, db: Session = Depends(get_db)):
    r = RouteModel(Name=data.Name, ZoneId=data.ZoneId, FormId=data.FormId, IsActive=data.IsActive)
    db.add(r)
    db.flush()
    if data.FormId is not None:
        rf = RouteFormModel(RouteId=r.RouteId, FormId=data.FormId, SortOrder=0)
        db.add(rf)
    db.commit()
    db.refresh(r)
    return r


@router.patch("/{route_id}", response_model=Route)
def update_route(route_id: int, data: RouteUpdate, db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(r, k, v)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/{route_id}", status_code=204)
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


@router.post("/{route_id}/pdvs", response_model=RoutePdv, status_code=201)
def add_route_pdv(route_id: int, data: RoutePdvCreate, db: Session = Depends(get_db)):
    rp = RoutePdvModel(
        RouteId=route_id,
        PdvId=data.PdvId,
        SortOrder=data.SortOrder,
        Priority=data.Priority,
    )
    db.add(rp)
    db.commit()
    db.refresh(rp)
    return rp


@router.delete("/{route_id}/pdvs/{pdv_id}", status_code=204)
def remove_route_pdv(route_id: int, pdv_id: int, db: Session = Depends(get_db)):
    rp = db.query(RoutePdvModel).filter(RoutePdvModel.RouteId == route_id, RoutePdvModel.PdvId == pdv_id).first()
    if not rp:
        raise HTTPException(status_code=404, detail="PDV no encontrado en la ruta")
    db.delete(rp)
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
def add_route_form(route_id: int, data: RouteFormCreate, db: Session = Depends(get_db)):
    r = db.query(RouteModel).filter(RouteModel.RouteId == route_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    rf = RouteFormModel(RouteId=route_id, FormId=data.FormId, SortOrder=data.SortOrder)
    db.add(rf)
    db.commit()
    db.refresh(rf)
    return rf


@router.delete("/{route_id}/forms/{form_id}", status_code=204)
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
    rd = RouteDayModel(
        RouteId=route_id,
        WorkDate=data.WorkDate,
        AssignedUserId=data.AssignedUserId,
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
