from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_user
from ..models.visit_loose import VisitLooseSurvey as LooseModel
from ..models.visit import Visit as VisitModel
from ..models.user import User as UserModel
from ..schemas.visit_loose import VisitLooseSurveyCreate, VisitLooseSurveyRead
from ._visit_auth import check_visit_ownership

router = APIRouter(prefix="/visits/{visit_id}/loose-survey", tags=["Relevamiento de Sueltos"])


def _get_visit_checked(visit_id: int, current_user: UserModel, db: Session) -> VisitModel:
    visit = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not visit:
        raise HTTPException(404, "Visita no encontrada")
    check_visit_ownership(visit, current_user, db)
    return visit


@router.get("", response_model=VisitLooseSurveyRead | None)
def get_loose_survey(visit_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_visit_checked(visit_id, current_user, db)
    return db.query(LooseModel).filter(LooseModel.VisitId == visit_id).first()


@router.put("", response_model=VisitLooseSurveyRead)
def save_loose_survey(visit_id: int, data: VisitLooseSurveyCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create or replace the loose survey for a visit."""
    visit = _get_visit_checked(visit_id, current_user, db)
    if visit.Status in ("CLOSED", "COMPLETED"):
        raise HTTPException(400, "No se puede modificar una visita cerrada")

    existing = db.query(LooseModel).filter(LooseModel.VisitId == visit_id).first()
    if existing:
        existing.SellsLoose = data.SellsLoose
        existing.ProductsJson = data.ProductsJson if data.SellsLoose else None
        existing.ExchangeJson = data.ExchangeJson if data.SellsLoose else None
    else:
        existing = LooseModel(
            VisitId=visit_id,
            SellsLoose=data.SellsLoose,
            ProductsJson=data.ProductsJson if data.SellsLoose else None,
            ExchangeJson=data.ExchangeJson if data.SellsLoose else None,
        )
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return existing
