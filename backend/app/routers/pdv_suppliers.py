import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_user, get_user_role
from ..models.pdv_supplier import PdvSupplier as Model
from ..models.pdv import PDV
from ..models.user import User as UserModel
from ..models.supplier import Supplier, SupplierSeller
from ..schemas.pdv_supplier import (
    PdvSupplier,
    PdvSupplierCreate,
    PdvSupplierUpdate,
)
from ..schemas.supplier import PdvSupplierLink
from ..services.suppliers import (
    audit,
    find_active_supplier_by_name,
    get_or_create_seller,
    link_snapshot,
    products_to_json,
    serialize_pdv_suppliers,
    supplier_snapshot,
    sync_link_legacy,
)
from ..services.supplier_names import normalize_name

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


def _row_to_response(row: Model, db: Session | None = None) -> dict:
    if db is not None and (row.SupplierId or row.SupplierSellerId):
        return serialize_pdv_suppliers(db, [row])[0]
    return {
        "PdvSupplierId": row.PdvSupplierId,
        "PdvId": row.PdvId,
        "ZoneId": row.ZoneId,
        "Name": row.Name,
        "Phone": row.Phone,
        "SupplierTypeId": row.SupplierTypeId,
        "Products": _json_to_products(row.Products),
        "IsActive": row.IsActive,
        "SupplierId": row.SupplierId,
        "SupplierSellerId": row.SupplierSellerId,
        "SellerName": None,
        "SellerPhone": None,
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

    # No-admin: filas de su zona o de la zona del PDV (la zona de un vínculo =
    # zona del PDV, así el rep ve lo que vinculó en un PDV de otra zona).
    role = get_user_role(db, current_user.UserId)
    if role not in _ADMIN_ROLES and current_user.ZoneId is not None:
        pdv_zone = db.query(PDV.ZoneId).filter(PDV.PdvId == pdv_id).scalar()
        zones = {z for z in (current_user.ZoneId, pdv_zone) if z is not None}
        q = q.filter(Model.ZoneId.in_(zones))

    rows = q.order_by(Model.Name).all()
    return serialize_pdv_suppliers(db, rows)


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
        Phone=(data.Phone or "").strip(),
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
    return _row_to_response(row, db)


@router.get("/search-zone", response_model=list[PdvSupplier])
def search_suppliers_in_zone(
    pdv_id: int,
    phone: str | None = None,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search all suppliers in the user's zone (across all PDVs). Optionally filter by phone."""
    zone_id = current_user.ZoneId
    q = db.query(Model).filter(Model.IsActive == True)
    if zone_id is not None:
        q = q.filter(Model.ZoneId == zone_id)
    if phone and phone.strip():
        q = q.filter(Model.Phone.contains(phone.strip()))
    # Deduplicate by phone (same supplier can appear in multiple PDVs);
    # los que no tienen teléfono todavía se dedupean por nombre.
    # Sin limit antes de deduplicar: con limit(100) una zona con >100 filas
    # cortaba la lista alfabéticamente (NOA: 429 filas → nada después de "H").
    rows = q.order_by(Model.Name).all()
    seen_phones: set[str] = set()
    seen_names: set[str] = set()
    unique: list[dict] = []
    for r in rows:
        if r.Phone:
            if r.Phone in seen_phones:
                continue
            seen_phones.add(r.Phone)
        else:
            name_key = r.Name.strip().lower()
            if name_key in seen_names:
                continue
            seen_names.add(name_key)
        unique.append(_row_to_response(r))
    return unique


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


@router.post("/link", response_model=PdvSupplier)
def link_pdv_supplier(
    pdv_id: int,
    data: PdvSupplierLink,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Vincula el PDV a un proveedor (existente o nuevo) + vendedor opcional.

    Idempotente (lo encola el modo offline): proveedor nuevo con nombre ya
    existente en la zona → se reusa; vendedor igual dentro del proveedor; si el
    PDV ya tiene fila activa con ese proveedor → se actualiza el vendedor.
    Atómico: un solo commit.
    """
    if (data.SupplierId is None) == (data.NewSupplier is None):
        raise HTTPException(422, "Indicá exactamente uno de SupplierId / NewSupplier")
    if data.SupplierSellerId is not None and data.NewSeller is not None:
        raise HTTPException(422, "Indicá a lo sumo uno de SupplierSellerId / NewSeller")

    pdv = db.query(PDV).filter(PDV.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(404, "PDV no encontrado")

    is_admin = get_user_role(db, current_user.UserId).lower() == "admin"
    zone_id = pdv.ZoneId if pdv.ZoneId is not None else current_user.ZoneId

    try:
        # Proveedor
        if data.SupplierId is not None:
            supplier = db.query(Supplier).filter(Supplier.SupplierId == data.SupplierId).first()
            if not supplier:
                raise HTTPException(404, "Proveedor no encontrado")
            if not supplier.IsActive:
                raise HTTPException(409, "El proveedor está inactivo (¿fue unificado?)")
            if not is_admin and supplier.ZoneId not in {pdv.ZoneId, current_user.ZoneId}:
                raise HTTPException(403, "El proveedor no es de la zona del PDV")
        else:
            ns = data.NewSupplier
            supplier = find_active_supplier_by_name(db, zone_id, ns.Name)
            if supplier is None:
                supplier = Supplier(
                    ZoneId=zone_id, Name=ns.Name.strip(), SupplierTypeId=ns.SupplierTypeId,
                    Products=products_to_json(ns.Products), IsActive=True,
                    CreatedByUserId=current_user.UserId,
                )
                db.add(supplier)
                db.flush()
                audit(db, current_user, "Supplier", supplier.SupplierId, "SUPPLIER_CREATE",
                      {"despues": supplier_snapshot(supplier)})

        # Vendedor (opcional)
        seller = None
        if data.SupplierSellerId is not None:
            seller = db.query(SupplierSeller).filter(
                SupplierSeller.SupplierSellerId == data.SupplierSellerId,
                SupplierSeller.SupplierId == supplier.SupplierId,
            ).first()
            if not seller:
                raise HTTPException(409, "El vendedor no pertenece a ese proveedor")
            if not seller.IsActive:
                raise HTTPException(409, "El vendedor está inactivo (¿fue unificado?)")
        elif data.NewSeller is not None:
            seller, _ = get_or_create_seller(db, supplier, data.NewSeller.Name, data.NewSeller.Phone, current_user)

        # Fila vínculo: la activa con ese proveedor; si no, una legacy del PDV con
        # el mismo nombre normalizado (se adopta en vez de duplicar); si no, nueva.
        row = db.query(Model).filter(
            Model.PdvId == pdv_id, Model.SupplierId == supplier.SupplierId, Model.IsActive == True,  # noqa: E712
        ).first()
        if row is None:
            key = normalize_name(supplier.Name)
            row = next(
                (
                    r for r in db.query(Model).filter(
                        Model.PdvId == pdv_id, Model.SupplierId.is_(None), Model.IsActive == True,  # noqa: E712
                    ).all()
                    if normalize_name(r.Name) == key
                ),
                None,
            )
        before = link_snapshot(row) if row is not None else None
        if row is None:
            row = Model(PdvId=pdv_id, Name=supplier.Name, Phone="", IsActive=True)
            db.add(row)
        sync_link_legacy(row, supplier, seller)
        db.flush()
        audit(db, current_user, "PdvSupplier", row.PdvSupplierId, "PDV_SUPPLIER_LINK",
              {"antes": before, "despues": link_snapshot(row)})
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(row)
    return serialize_pdv_suppliers(db, [row])[0]
