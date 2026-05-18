from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import require_role
from ..models.supplier_product_type import SupplierProductType as Model
from ..schemas.supplier_product_type import SupplierProductType, SupplierProductTypeCreate, SupplierProductTypeUpdate

router = APIRouter(prefix="/supplier-product-types", tags=["Productos de proveedor"])


@router.get("", response_model=list[SupplierProductType])
def list_supplier_product_types(db: Session = Depends(get_db)):
    return db.query(Model).filter(Model.IsActive == True).order_by(Model.Name).all()


@router.get("/all", response_model=list[SupplierProductType])
def list_all_supplier_product_types(db: Session = Depends(get_db)):
    return db.query(Model).order_by(Model.Name).all()


@router.post("", response_model=SupplierProductType, status_code=201, dependencies=[Depends(require_role("territory_manager"))])
def create_supplier_product_type(data: SupplierProductTypeCreate, db: Session = Depends(get_db)):
    row = Model(Name=data.Name, IsActive=data.IsActive)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{type_id}", response_model=SupplierProductType, dependencies=[Depends(require_role("territory_manager"))])
def update_supplier_product_type(type_id: int, data: SupplierProductTypeUpdate, db: Session = Depends(get_db)):
    row = db.query(Model).filter(Model.SupplierProductTypeId == type_id).first()
    if not row:
        raise HTTPException(404, "Tipo de producto de proveedor no encontrado")
    if data.Name is not None:
        row.Name = data.Name
    if data.IsActive is not None:
        row.IsActive = data.IsActive
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{type_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_supplier_product_type(type_id: int, db: Session = Depends(get_db)):
    row = db.query(Model).filter(Model.SupplierProductTypeId == type_id).first()
    if not row:
        raise HTTPException(404, "Tipo de producto de proveedor no encontrado")
    row.IsActive = False
    db.commit()
