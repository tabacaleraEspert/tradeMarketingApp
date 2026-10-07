"""Proveedores por zona + vendedores (fase 1, spec tasks/spec-proveedores-vendedores.md).

Editar / unificar / borrar proveedores = solo admin. Cualquier usuario puede
agregar un vendedor a un proveedor de su zona (lo hace el rep en el censo).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..auth import get_current_user, get_user_role, require_role
from ..database import get_db
from ..models.pdv import PDV
from ..models.supplier import Supplier, SupplierSeller
from ..models.user import User as UserModel
from ..schemas.supplier import (
    SellerCreate,
    SellerUpdate,
    SupplierCreate,
    SupplierMerge,
    SupplierOut,
    SupplierUpdate,
)
from ..services.suppliers import (
    audit,
    clean_phone,
    find_active_seller_by_name,
    find_active_supplier_by_name,
    get_or_create_seller,
    merge_suppliers,
    products_to_json,
    propagate_seller_phone,
    propagate_supplier_to_links,
    seller_snapshot,
    serialize_supplier,
    serialize_suppliers,
    supplier_snapshot,
)

router = APIRouter(prefix="/suppliers", tags=["Proveedores"])

_admin_only = require_role("admin", strict=True)


def _is_admin(db: Session, user: UserModel) -> bool:
    return get_user_role(db, user.UserId).lower() == "admin"


def _get_supplier(db: Session, supplier_id: int) -> Supplier:
    s = db.query(Supplier).filter(Supplier.SupplierId == supplier_id).first()
    if not s:
        raise HTTPException(404, "Proveedor no encontrado")
    return s


@router.get("", response_model=list[SupplierOut])
def list_suppliers(
    zone_id: int | None = None,
    q: str | None = None,
    include_inactive: bool = False,
    pdv_id: int | None = None,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    admin = _is_admin(db, current_user)
    query = db.query(Supplier)
    if admin:
        if zone_id is not None:
            query = query.filter(Supplier.ZoneId == zone_id)
        if not include_inactive:
            query = query.filter(Supplier.IsActive == True)  # noqa: E712
    else:
        # No-admin: SIEMPRE su zona (+ la del PDV si viene pdv_id), solo activos
        zones = {current_user.ZoneId}
        if pdv_id is not None:
            zones.add(db.query(PDV.ZoneId).filter(PDV.PdvId == pdv_id).scalar())
        zones.discard(None)
        if not zones:
            return []
        query = query.filter(Supplier.ZoneId.in_(zones), Supplier.IsActive == True)  # noqa: E712
        include_inactive = False

    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        seller_match = (
            db.query(SupplierSeller.SupplierId)
            .filter(or_(func.lower(SupplierSeller.Name).like(term), func.lower(SupplierSeller.Phone).like(term)))
        )
        if not include_inactive:
            seller_match = seller_match.filter(SupplierSeller.IsActive == True)  # noqa: E712
        query = query.filter(or_(func.lower(Supplier.Name).like(term), Supplier.SupplierId.in_(seller_match)))

    rows = query.order_by(Supplier.Name).all()
    return serialize_suppliers(db, rows, include_inactive_sellers=include_inactive)


@router.post("", response_model=SupplierOut, status_code=201)
def create_supplier(
    data: SupplierCreate,
    current_user: UserModel = Depends(_admin_only),
    db: Session = Depends(get_db),
):
    if find_active_supplier_by_name(db, data.ZoneId, data.Name):
        raise HTTPException(409, "Ya existe un proveedor activo con ese nombre en la zona")
    s = Supplier(
        ZoneId=data.ZoneId, Name=data.Name.strip(), SupplierTypeId=data.SupplierTypeId,
        Products=products_to_json(data.Products), IsActive=True, CreatedByUserId=current_user.UserId,
    )
    db.add(s)
    db.flush()
    audit(db, current_user, "Supplier", s.SupplierId, "SUPPLIER_CREATE", {"despues": supplier_snapshot(s)})
    db.commit()
    db.refresh(s)
    return serialize_supplier(db, s)


@router.patch("/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    data: SupplierUpdate,
    current_user: UserModel = Depends(_admin_only),
    db: Session = Depends(get_db),
):
    s = _get_supplier(db, supplier_id)
    before = supplier_snapshot(s)
    upd = data.model_dump(exclude_unset=True)

    new_name = upd["Name"].strip() if upd.get("Name") else s.Name
    new_zone = upd["ZoneId"] if "ZoneId" in upd else s.ZoneId
    new_active = upd["IsActive"] if upd.get("IsActive") is not None else s.IsActive
    if new_active and (new_name != s.Name or new_zone != s.ZoneId or not s.IsActive):
        if find_active_supplier_by_name(db, new_zone, new_name, exclude_id=s.SupplierId):
            raise HTTPException(409, "Ya existe un proveedor activo con ese nombre en la zona")

    s.Name = new_name
    s.ZoneId = new_zone
    s.IsActive = new_active
    if "SupplierTypeId" in upd:
        s.SupplierTypeId = upd["SupplierTypeId"]
    if "Products" in upd:
        s.Products = products_to_json(upd["Products"])
    db.flush()
    propagate_supplier_to_links(db, s)
    audit(db, current_user, "Supplier", s.SupplierId, "SUPPLIER_UPDATE",
          {"antes": before, "despues": supplier_snapshot(s)})
    db.commit()
    db.refresh(s)
    return serialize_supplier(db, s, include_inactive_sellers=True)


@router.post("/{supplier_id}/sellers", response_model=SupplierOut)
def add_seller(
    supplier_id: int,
    data: SellerCreate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    s = _get_supplier(db, supplier_id)
    admin = _is_admin(db, current_user)
    if not admin and (current_user.ZoneId is None or s.ZoneId != current_user.ZoneId):
        raise HTTPException(403, "El proveedor no es de tu zona")
    if not s.IsActive:
        raise HTTPException(409, "El proveedor está inactivo")
    get_or_create_seller(db, s, data.Name, data.Phone, current_user)
    db.commit()
    return serialize_supplier(db, s)


@router.patch("/{supplier_id}/sellers/{seller_id}", response_model=SupplierOut)
def update_seller(
    supplier_id: int,
    seller_id: int,
    data: SellerUpdate,
    current_user: UserModel = Depends(_admin_only),
    db: Session = Depends(get_db),
):
    s = _get_supplier(db, supplier_id)
    se = (
        db.query(SupplierSeller)
        .filter(SupplierSeller.SupplierSellerId == seller_id, SupplierSeller.SupplierId == supplier_id)
        .first()
    )
    if not se:
        raise HTTPException(404, "Vendedor no encontrado")
    before = seller_snapshot(se)
    upd = data.model_dump(exclude_unset=True)

    new_name = upd["Name"].strip() if upd.get("Name") else se.Name
    new_active = upd["IsActive"] if upd.get("IsActive") is not None else se.IsActive
    if new_active and (new_name != se.Name or not se.IsActive):
        if find_active_seller_by_name(db, supplier_id, new_name, exclude_id=se.SupplierSellerId):
            raise HTTPException(409, "Ya existe un vendedor activo con ese nombre en el proveedor")
    se.Name = new_name
    se.IsActive = new_active
    if "Phone" in upd:
        se.Phone = clean_phone(upd["Phone"])
    db.flush()
    propagate_seller_phone(db, se)
    audit(db, current_user, "SupplierSeller", se.SupplierSellerId, "SELLER_UPDATE",
          {"antes": before, "despues": seller_snapshot(se)})
    db.commit()
    db.refresh(s)
    return serialize_supplier(db, s, include_inactive_sellers=True)


@router.post("/{supplier_id}/merge", response_model=SupplierOut)
def merge(
    supplier_id: int,
    data: SupplierMerge,
    current_user: UserModel = Depends(_admin_only),
    db: Session = Depends(get_db),
):
    target = _get_supplier(db, supplier_id)
    if not target.IsActive:
        raise HTTPException(409, "El proveedor destino está inactivo")
    source_ids = sorted({i for i in data.SourceSupplierIds if i != supplier_id})
    if not source_ids:
        raise HTTPException(422, "Indicá al menos un proveedor de origen distinto del destino")
    sources = db.query(Supplier).filter(Supplier.SupplierId.in_(source_ids)).all()
    missing = set(source_ids) - {s.SupplierId for s in sources}
    if missing:
        raise HTTPException(404, f"Proveedores no encontrados: {sorted(missing)}")

    before = {
        "destino": supplier_snapshot(target),
        "origenes": [supplier_snapshot(s) for s in sources],
    }
    try:
        summary = merge_suppliers(db, target, sources, current_user)
        audit(db, current_user, "Supplier", target.SupplierId, "SUPPLIER_MERGE", {
            "antes": before,
            "despues": {"destino": supplier_snapshot(target), "resumen": summary},
        })
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(target)
    return serialize_supplier(db, target)
