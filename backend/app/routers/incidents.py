from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Incident as IncidentModel, User as UserModel
from ..schemas.incident import Incident, IncidentCreate, IncidentUpdate
from ..auth import get_current_user, require_role

router = APIRouter(prefix="/incidents", tags=["Incidencias"])


@router.get("", response_model=list[Incident])
def list_incidents(
    skip: int = 0,
    limit: int = 100,
    pdv_id: int | None = None,
    visit_id: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(IncidentModel)
    if pdv_id is not None:
        q = q.filter(IncidentModel.PdvId == pdv_id)
    if visit_id is not None:
        q = q.filter(IncidentModel.VisitId == visit_id)
    if status is not None:
        q = q.filter(IncidentModel.Status == status)
    return q.order_by(IncidentModel.CreatedAt.desc()).offset(skip).limit(limit).all()


@router.get("/{incident_id}", response_model=Incident)
def get_incident(incident_id: int, db: Session = Depends(get_db)):
    i = db.query(IncidentModel).filter(IncidentModel.IncidentId == incident_id).first()
    if not i:
        raise HTTPException(status_code=404, detail="Incidencia no encontrada")
    return i


@router.post("", response_model=Incident, status_code=201, dependencies=[Depends(require_role("territory_manager"))])
def create_incident(
    data: IncidentCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    i = IncidentModel(
        VisitId=data.VisitId,
        PdvId=data.PdvId,
        Type=data.Type,
        Status=data.Status,
        Priority=data.Priority,
        Notes=data.Notes,
        CreatedBy=current_user.UserId,
    )
    db.add(i)
    db.commit()
    db.refresh(i)
    return i


@router.patch("/{incident_id}", response_model=Incident, dependencies=[Depends(require_role("territory_manager"))])
def update_incident(incident_id: int, data: IncidentUpdate, db: Session = Depends(get_db)):
    i = db.query(IncidentModel).filter(IncidentModel.IncidentId == incident_id).first()
    if not i:
        raise HTTPException(status_code=404, detail="Incidencia no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(i, k, v)
    db.commit()
    db.refresh(i)
    return i


@router.delete("/{incident_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_incident(incident_id: int, db: Session = Depends(get_db)):
    i = db.query(IncidentModel).filter(IncidentModel.IncidentId == incident_id).first()
    if not i:
        raise HTTPException(status_code=404, detail="Incidencia no encontrada")
    db.delete(i)
    db.commit()
