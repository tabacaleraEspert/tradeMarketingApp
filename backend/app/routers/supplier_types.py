from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import require_role
from ..models.supplier_type import SupplierType as Model
from ..schemas.supplier_type import SupplierType, SupplierTypeCreate, SupplierTypeUpdate

router = APIRouter(prefix="/supplier-types", tags=["Tipos de proveedor"])


@router.get("", response_model=list[SupplierType])
def list_supplier_types(db: Session = Depends(get_db)):
    return db.query(Model).filter(Model.IsActive == True).order_by(Model.Name).all()


@router.get("/all", response_model=list[SupplierType])
def list_all_supplier_types(db: Session = Depends(get_db)):
    return db.query(Model).order_by(Model.Name).all()


@router.post("", response_model=SupplierType, status_code=201, dependencies=[Depends(require_role("territory_manager"))])
def create_supplier_type(data: SupplierTypeCreate, db: Session = Depends(get_db)):
    row = Model(Name=data.Name, IsActive=data.IsActive)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{type_id}", response_model=SupplierType, dependencies=[Depends(require_role("territory_manager"))])
def update_supplier_type(type_id: int, data: SupplierTypeUpdate, db: Session = Depends(get_db)):
    row = db.query(Model).filter(Model.SupplierTypeId == type_id).first()
    if not row:
        raise HTTPException(404, "Tipo de proveedor no encontrado")
    if data.Name is not None:
        row.Name = data.Name
    if data.IsActive is not None:
        row.IsActive = data.IsActive
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{type_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_supplier_type(type_id: int, db: Session = Depends(get_db)):
    row = db.query(Model).filter(Model.SupplierTypeId == type_id).first()
    if not row:
        raise HTTPException(404, "Tipo de proveedor no encontrado")
    row.IsActive = False
    db.commit()
