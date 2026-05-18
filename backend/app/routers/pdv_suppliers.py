import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_user, get_user_role
from ..models.pdv_supplier import PdvSupplier as Model
from ..models.pdv import PDV
from ..models.user import User as UserModel
from ..schemas.pdv_supplier import (
    PdvSupplier,
    PdvSupplierCreate,
    PdvSupplierUpdate,
)

router = APIRouter(prefix="/pdvs/{pdv_id}/suppliers", tags=["Proveedores del PDV"])

_ADMIN_ROLES = {"admin", "territory_manager", "regional_manager"}


def _products_to_json(products: list[str] | None) -> str | None:
    if products is None:
        return None
    return json.dumps(products, ensure_ascii=False)


def _json_to_products(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def _row_to_response(row: Model) -> dict:
    return {
        "PdvSupplierId": row.PdvSupplierId,
        "PdvId": row.PdvId,
        "ZoneId": row.ZoneId,
        "Name": row.Name,
        "Phone": row.Phone,
        "SupplierTypeId": row.SupplierTypeId,
        "Products": _json_to_products(row.Products),
        "IsActive": row.IsActive,
        "CreatedAt": row.CreatedAt,
        "UpdatedAt": row.UpdatedAt,
    }


@router.get("", response_model=list[PdvSupplier])
def list_pdv_suppliers(
    pdv_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Model).filter(Model.PdvId == pdv_id, Model.IsActive == True)

    # Non-admin users only see suppliers in their zone
    role = get_user_role(db, current_user.UserId)
    if role not in _ADMIN_ROLES and current_user.ZoneId is not None:
        q = q.filter(Model.ZoneId == current_user.ZoneId)

    rows = q.order_by(Model.Name).all()
    return [_row_to_response(r) for r in rows]


@router.post("", response_model=PdvSupplier, status_code=201)
def create_pdv_supplier(
    pdv_id: int,
    data: PdvSupplierCreate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pdv = db.query(PDV).filter(PDV.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(404, "PDV no encontrado")

    # Auto-assign user's zone if not provided
    zone_id = data.ZoneId if data.ZoneId is not None else current_user.ZoneId

    row = Model(
        PdvId=pdv_id,
        ZoneId=zone_id,
        Name=data.Name.strip(),
        Phone=data.Phone.strip(),
        SupplierTypeId=data.SupplierTypeId,
        Products=_products_to_json(data.Products),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_response(row)


@router.patch("/{supplier_id}", response_model=PdvSupplier)
def update_pdv_supplier(
    pdv_id: int,
    supplier_id: int,
    data: PdvSupplierUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(Model).filter(
        Model.PdvSupplierId == supplier_id, Model.PdvId == pdv_id
    ).first()
    if not row:
        raise HTTPException(404, "Proveedor no encontrado")

    update = data.model_dump(exclude_unset=True)
    if "Name" in update and update["Name"] is not None:
        row.Name = update["Name"].strip()
    if "Phone" in update and update["Phone"] is not None:
        row.Phone = update["Phone"].strip()
    if "SupplierTypeId" in update:
        row.SupplierTypeId = update["SupplierTypeId"]
    if "ZoneId" in update:
        row.ZoneId = update["ZoneId"]
    if "Products" in update:
        row.Products = _products_to_json(update["Products"])
    if "IsActive" in update and update["IsActive"] is not None:
        row.IsActive = update["IsActive"]

    db.commit()
    db.refresh(row)
    return _row_to_response(row)


@router.delete("/{supplier_id}", status_code=204)
def delete_pdv_supplier(
    pdv_id: int,
    supplier_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(Model).filter(
        Model.PdvSupplierId == supplier_id, Model.PdvId == pdv_id
    ).first()
    if not row:
        raise HTTPException(404, "Proveedor no encontrado")
    row.IsActive = False
    db.commit()
