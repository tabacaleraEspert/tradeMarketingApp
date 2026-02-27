from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Visit as VisitModel
from ..schemas.visit import Visit, VisitCreate, VisitUpdate

router = APIRouter(prefix="/visits", tags=["Visitas"])


@router.get("", response_model=list[Visit])
def list_visits(
    skip: int = 0,
    limit: int = 100,
    user_id: int | None = None,
    pdv_id: int | None = None,
    route_day_id: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(VisitModel)
    if user_id is not None:
        q = q.filter(VisitModel.UserId == user_id)
    if pdv_id is not None:
        q = q.filter(VisitModel.PdvId == pdv_id)
    if route_day_id is not None:
        q = q.filter(VisitModel.RouteDayId == route_day_id)
    if status is not None:
        q = q.filter(VisitModel.Status == status)
    return q.order_by(VisitModel.OpenedAt.desc()).offset(skip).limit(limit).all()


@router.get("/{visit_id}", response_model=Visit)
def get_visit(visit_id: int, db: Session = Depends(get_db)):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    return v


@router.post("", response_model=Visit, status_code=201)
def create_visit(data: VisitCreate, db: Session = Depends(get_db)):
    v = VisitModel(
        PdvId=data.PdvId,
        UserId=data.UserId,
        RouteDayId=data.RouteDayId,
        Status=data.Status,
        FormId=data.FormId,
        FormVersion=data.FormVersion,
        FormStatus=data.FormStatus,
        MaterialExternalId=data.MaterialExternalId,
        CloseReason=data.CloseReason,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


@router.patch("/{visit_id}", response_model=Visit)
def update_visit(visit_id: int, data: VisitUpdate, db: Session = Depends(get_db)):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    dump = data.model_dump(exclude_unset=True)
    if dump.get("Status") in ("CLOSED", "COMPLETED") and v.ClosedAt is None:
        dump["ClosedAt"] = dump.get("ClosedAt") or datetime.now(timezone.utc)
    for k, val in dump.items():
        setattr(v, k, val)
    db.commit()
    db.refresh(v)
    return v


@router.delete("/{visit_id}", status_code=204)
def delete_visit(visit_id: int, db: Session = Depends(get_db)):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    db.delete(v)
    db.commit()
