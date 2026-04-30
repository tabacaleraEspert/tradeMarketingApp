from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_user, get_user_role
from ..models.pdv_product_category import PdvProductCategory as Model
from ..models.pdv import PDV
from ..models.user import User as UserModel
from ..schemas.pdv_product_category import (
    PdvProductCategory,
    PdvProductCategoryUpdate,
    PdvProductCategoryBulk,
    VALID_CATEGORIES,
    VALID_STATUSES,
)

router = APIRouter(prefix="/pdvs/{pdv_id}/product-categories", tags=["Categorías de producto del PDV"])

_ADMIN_ROLES = {"admin", "territory_manager", "regional_manager"}


def _validate(category: str, status: str):
    if not category or not category.strip():
        raise HTTPException(400, "Categoría no puede estar vacía")
    if status not in VALID_STATUSES:
        raise HTTPException(400, f"Estado inválido. Válidos: {VALID_STATUSES}")


def _check_pdv_access(pdv: PDV, current_user: UserModel, db: Session):
    """Verify user has access to this PDV (same zone or admin role)."""
    role = get_user_role(db, current_user.UserId)
    if role in _ADMIN_ROLES:
        return
    if pdv.ZoneId is not None and current_user.ZoneId is not None and pdv.ZoneId != current_user.ZoneId:
        raise HTTPException(403, "No tiene acceso a este PDV")


@router.get("", response_model=list[PdvProductCategory])
def list_pdv_categories(pdv_id: int, db: Session = Depends(get_db)):
    return db.query(Model).filter(Model.PdvId == pdv_id).order_by(Model.Category).all()


@router.put("", response_model=list[PdvProductCategory])
def bulk_upsert_categories(
    pdv_id: int,
    data: PdvProductCategoryBulk,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Bulk upsert: set all product categories for a PDV at once."""
    pdv = db.query(PDV).filter(PDV.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(404, "PDV no encontrado")
    _check_pdv_access(pdv, current_user, db)

    for item in data.categories:
        _validate(item.Category, item.Status)

    for item in data.categories:
        existing = db.query(Model).filter(
            Model.PdvId == pdv_id, Model.Category == item.Category
        ).first()
        if existing:
            existing.Status = item.Status
        else:
            db.add(Model(PdvId=pdv_id, Category=item.Category, Status=item.Status))

    db.commit()
    return db.query(Model).filter(Model.PdvId == pdv_id).order_by(Model.Category).all()


@router.patch("/{category_id}", response_model=PdvProductCategory)
def update_category_status(
    pdv_id: int,
    category_id: int,
    data: PdvProductCategoryUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pdv = db.query(PDV).filter(PDV.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(404, "PDV no encontrado")
    _check_pdv_access(pdv, current_user, db)

    row = db.query(Model).filter(Model.PdvProductCategoryId == category_id, Model.PdvId == pdv_id).first()
    if not row:
        raise HTTPException(404, "Registro no encontrado")
    if data.Status not in VALID_STATUSES:
        raise HTTPException(400, f"Estado inválido. Válidos: {VALID_STATUSES}")
    row.Status = data.Status
    db.commit()
    db.refresh(row)
    return row
