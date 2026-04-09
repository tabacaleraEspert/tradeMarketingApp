from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.visit_action import VisitAction as VisitActionModel
from ..schemas.visit_action import VisitAction, VisitActionCreate, VisitActionUpdate

router = APIRouter(prefix="/visits", tags=["Acciones de Visita"])


@router.get("/{visit_id}/actions", response_model=list[VisitAction])
def list_visit_actions(visit_id: int, db: Session = Depends(get_db)):
    return (
        db.query(VisitActionModel)
        .filter(VisitActionModel.VisitId == visit_id)
        .order_by(VisitActionModel.CreatedAt)
        .all()
    )


@router.post("/{visit_id}/actions", response_model=VisitAction, status_code=201)
def create_visit_action(visit_id: int, data: VisitActionCreate, db: Session = Depends(get_db)):
    action = VisitActionModel(
        VisitId=visit_id,
        ActionType=data.ActionType,
        Description=data.Description,
        DetailsJson=data.DetailsJson,
        PhotoRequired=data.PhotoRequired,
        PhotoTaken=data.PhotoTaken,
    )
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


@router.patch("/actions/{action_id}", response_model=VisitAction)
def update_visit_action(action_id: int, data: VisitActionUpdate, db: Session = Depends(get_db)):
    action = db.query(VisitActionModel).filter(VisitActionModel.VisitActionId == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Acción no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(action, k, v)
    db.commit()
    db.refresh(action)
    return action


@router.delete("/actions/{action_id}", status_code=204)
def delete_visit_action(action_id: int, db: Session = Depends(get_db)):
    action = db.query(VisitActionModel).filter(VisitActionModel.VisitActionId == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Acción no encontrada")
    db.delete(action)
    db.commit()
