from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_user
from ..models.visit_pop import VisitPOPItem as POPModel
from ..models.visit import Visit as VisitModel
from ..models.user import User as UserModel
from ..schemas.visit_pop import VisitPOPItemRead, VisitPOPBulk
from ._visit_auth import check_visit_ownership

VALID_MATERIAL_TYPES = ["primario", "secundario"]

router = APIRouter(prefix="/visits/{visit_id}/pop", tags=["Censo POP"])


def _get_visit_checked(visit_id: int, current_user: UserModel, db: Session) -> VisitModel:
    visit = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not visit:
        raise HTTPException(404, "Visita no encontrada")
    check_visit_ownership(visit, current_user, db)
    return visit


@router.get("", response_model=list[VisitPOPItemRead])
def list_pop_items(visit_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_visit_checked(visit_id, current_user, db)
    return (
        db.query(POPModel)
        .filter(POPModel.VisitId == visit_id)
        .order_by(POPModel.MaterialType, POPModel.MaterialName)
        .all()
    )


@router.put("", response_model=list[VisitPOPItemRead])
def bulk_save_pop(visit_id: int, data: VisitPOPBulk, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Bulk save: replace all POP items for a visit."""
    visit = _get_visit_checked(visit_id, current_user, db)
    if visit.Status in ("CLOSED", "COMPLETED"):
        raise HTTPException(400, "No se puede modificar una visita cerrada")

    for item in data.items:
        if item.MaterialType not in VALID_MATERIAL_TYPES:
            raise HTTPException(400, f"MaterialType inválido. Válidos: {VALID_MATERIAL_TYPES}")

    db.query(POPModel).filter(POPModel.VisitId == visit_id).delete()
    for item in data.items:
        db.add(POPModel(
            VisitId=visit_id,
            MaterialType=item.MaterialType,
            MaterialName=item.MaterialName,
            Company=item.Company,
            Present=item.Present,
            HasPrice=item.HasPrice,
        ))
    db.commit()
    return (
        db.query(POPModel)
        .filter(POPModel.VisitId == visit_id)
        .order_by(POPModel.MaterialType, POPModel.MaterialName)
        .all()
    )
