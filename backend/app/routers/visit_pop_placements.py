"""Colocación de material POP por visita (acción "pop"): N renglones artículo +
cantidad. Mismo contrato que `visit_pop.py` (bulk replace, guard de visita
cerrada, check de dueño)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models.pop_material import VisitPOPPlacement as PlacementModel
from ..models.user import User as UserModel
from ..models.visit import Visit as VisitModel
from ..schemas.pop_material import VisitPOPPlacementBulk, VisitPOPPlacementRead
from ..services.pop_materials import resolve_item_names
from ._visit_auth import check_visit_ownership

router = APIRouter(prefix="/visits/{visit_id}/pop-placements", tags=["Colocación POP"])


def _get_visit_checked(visit_id: int, current_user: UserModel, db: Session) -> VisitModel:
    visit = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not visit:
        raise HTTPException(404, "Visita no encontrada")
    check_visit_ownership(visit, current_user, db)
    return visit


def _list(db: Session, visit_id: int):
    return (
        db.query(PlacementModel)
        .filter(PlacementModel.VisitId == visit_id)
        .order_by(PlacementModel.VisitPOPPlacementId)
        .all()
    )


@router.get("", response_model=list[VisitPOPPlacementRead])
def list_placements(visit_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_visit_checked(visit_id, current_user, db)
    return _list(db, visit_id)


@router.put("", response_model=list[VisitPOPPlacementRead])
def bulk_save_placements(
    visit_id: int,
    data: VisitPOPPlacementBulk,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bulk save: reemplaza todas las colocaciones de la visita."""
    visit = _get_visit_checked(visit_id, current_user, db)
    if visit.Status in ("CLOSED", "COMPLETED"):
        raise HTTPException(400, "No se puede modificar una visita cerrada")
    try:
        resolve_item_names(db, data.items, name_max_len=200)
    except ValueError as e:
        raise HTTPException(422, str(e))

    db.query(PlacementModel).filter(PlacementModel.VisitId == visit_id).delete()
    for item in data.items:
        db.add(PlacementModel(
            VisitId=visit_id,
            MaterialCode=item.MaterialCode,
            MaterialName=item.MaterialName,
            Quantity=item.Quantity,
            Location=(item.Location or "").strip() or None,
        ))
    db.commit()
    return _list(db, visit_id)
