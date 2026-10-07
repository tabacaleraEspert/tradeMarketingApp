"""Lógica compartida de proveedores (Supplier) y vendedores (SupplierSeller).

Usada por `routers/suppliers.py` (ABM admin + alta de vendedor) y por
`routers/pdv_suppliers.py` (vínculo PDV↔proveedor, POST /link).
"""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.audit import AuditEvent
from ..models.pdv_supplier import PdvSupplier
from ..models.supplier import Supplier, SupplierSeller
from ..models.supplier_type import SupplierType
from ..models.zone import Zone
from .supplier_names import normalize_name


# ─── Products JSON ───────────────────────────────────────────────────

def products_to_json(products: list[str] | None) -> str | None:
    if products is None:
        return None
    return json.dumps(products, ensure_ascii=False)


def json_to_products(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else None
    except (json.JSONDecodeError, TypeError):
        return None


def clean_phone(phone: str | None) -> str | None:
    phone = (phone or "").strip()
    return phone or None


# ─── Auditoría ───────────────────────────────────────────────────────

def audit(db: Session, user, entity: str, entity_id: int | str, action: str, payload: dict) -> None:
    """Rastro en AuditEvent (misma transacción que el cambio), igual que rutas."""
    db.add(AuditEvent(
        UserId=user.UserId if user is not None else None,
        Entity=entity, EntityId=str(entity_id), Action=action,
        PayloadJson=json.dumps(payload, default=str, ensure_ascii=False),
    ))


def supplier_snapshot(s: Supplier) -> dict:
    return {
        "SupplierId": s.SupplierId, "ZoneId": s.ZoneId, "Name": s.Name,
        "SupplierTypeId": s.SupplierTypeId, "Products": json_to_products(s.Products),
        "IsActive": s.IsActive,
    }


def seller_snapshot(s: SupplierSeller) -> dict:
    return {
        "SupplierSellerId": s.SupplierSellerId, "SupplierId": s.SupplierId,
        "Name": s.Name, "Phone": s.Phone, "IsActive": s.IsActive,
    }


def link_snapshot(r: PdvSupplier) -> dict:
    return {
        "PdvSupplierId": r.PdvSupplierId, "PdvId": r.PdvId, "SupplierId": r.SupplierId,
        "SupplierSellerId": r.SupplierSellerId, "Name": r.Name, "Phone": r.Phone,
        "ZoneId": r.ZoneId, "IsActive": r.IsActive,
    }


# ─── Búsquedas con nombre normalizado ────────────────────────────────

def find_active_supplier_by_name(
    db: Session, zone_id: int | None, name: str, exclude_id: int | None = None,
) -> Supplier | None:
    key = normalize_name(name)
    q = db.query(Supplier).filter(Supplier.IsActive == True)  # noqa: E712
    q = q.filter(Supplier.ZoneId.is_(None)) if zone_id is None else q.filter(Supplier.ZoneId == zone_id)
    for s in q.order_by(Supplier.SupplierId).all():
        if s.SupplierId != exclude_id and normalize_name(s.Name) == key:
            return s
    return None


def find_active_seller_by_name(
    db: Session, supplier_id: int, name: str, exclude_id: int | None = None,
) -> SupplierSeller | None:
    key = normalize_name(name)
    rows = (
        db.query(SupplierSeller)
        .filter(SupplierSeller.SupplierId == supplier_id, SupplierSeller.IsActive == True)  # noqa: E712
        .order_by(SupplierSeller.SupplierSellerId)
        .all()
    )
    for s in rows:
        if s.SupplierSellerId != exclude_id and normalize_name(s.Name) == key:
            return s
    return None


def get_or_create_seller(
    db: Session, supplier: Supplier, name: str, phone: str | None, user,
) -> tuple[SupplierSeller, bool]:
    """Reusa vendedor activo con mismo nombre normalizado (completa Phone si
    estaba vacío). Devuelve (vendedor, creado)."""
    phone = clean_phone(phone)
    existing = find_active_seller_by_name(db, supplier.SupplierId, name)
    if existing is not None:
        if phone and not existing.Phone:
            before = seller_snapshot(existing)
            existing.Phone = phone
            db.flush()
            audit(db, user, "SupplierSeller", existing.SupplierSellerId, "SELLER_UPDATE",
                  {"antes": before, "despues": seller_snapshot(existing)})
        return existing, False
    seller = SupplierSeller(SupplierId=supplier.SupplierId, Name=name.strip(), Phone=phone, IsActive=True)
    db.add(seller)
    db.flush()
    audit(db, user, "SupplierSeller", seller.SupplierSellerId, "SELLER_CREATE", {"despues": seller_snapshot(seller)})
    return seller, True


# ─── Columnas legacy de PdvSupplier ──────────────────────────────────

def sync_link_legacy(row: PdvSupplier, supplier: Supplier, seller: SupplierSeller | None) -> None:
    """Rellena las columnas legacy de la fila vínculo con los datos del proveedor
    (los clientes viejos y los reportes legacy siguen leyendo Name/Phone)."""
    row.SupplierId = supplier.SupplierId
    row.SupplierSellerId = seller.SupplierSellerId if seller is not None else None
    row.Name = supplier.Name
    row.Phone = (seller.Phone or "") if seller is not None else ""
    row.ZoneId = supplier.ZoneId
    row.SupplierTypeId = supplier.SupplierTypeId
    row.Products = supplier.Products


def propagate_supplier_to_links(db: Session, supplier: Supplier) -> None:
    db.query(PdvSupplier).filter(PdvSupplier.SupplierId == supplier.SupplierId).update(
        {
            PdvSupplier.Name: supplier.Name,
            PdvSupplier.ZoneId: supplier.ZoneId,
            PdvSupplier.SupplierTypeId: supplier.SupplierTypeId,
            PdvSupplier.Products: supplier.Products,
        },
    )


def propagate_seller_phone(db: Session, seller: SupplierSeller) -> None:
    db.query(PdvSupplier).filter(PdvSupplier.SupplierSellerId == seller.SupplierSellerId).update(
        {PdvSupplier.Phone: seller.Phone or ""},
    )


# ─── Serialización ───────────────────────────────────────────────────

def serialize_suppliers(
    db: Session, suppliers: list[Supplier], include_inactive_sellers: bool = False,
) -> list[dict]:
    if not suppliers:
        return []
    ids = [s.SupplierId for s in suppliers]
    zone_ids = {s.ZoneId for s in suppliers if s.ZoneId}
    type_ids = {s.SupplierTypeId for s in suppliers if s.SupplierTypeId}
    zones = (
        {z.ZoneId: z.Name for z in db.query(Zone).filter(Zone.ZoneId.in_(zone_ids)).all()}
        if zone_ids else {}
    )
    types = (
        {t.SupplierTypeId: t.Name for t in db.query(SupplierType).filter(SupplierType.SupplierTypeId.in_(type_ids)).all()}
        if type_ids else {}
    )
    pdv_counts = dict(
        db.query(PdvSupplier.SupplierId, func.count(func.distinct(PdvSupplier.PdvId)))
        .filter(
            PdvSupplier.SupplierId.in_(ids),
            PdvSupplier.IsActive == True,  # noqa: E712
            PdvSupplier.PdvId.isnot(None),
        )
        .group_by(PdvSupplier.SupplierId)
        .all()
    )
    sq = db.query(SupplierSeller).filter(SupplierSeller.SupplierId.in_(ids))
    if not include_inactive_sellers:
        sq = sq.filter(SupplierSeller.IsActive == True)  # noqa: E712
    sellers: dict[int, list[dict]] = defaultdict(list)
    for se in sq.order_by(SupplierSeller.Name).all():
        sellers[se.SupplierId].append({
            "SupplierSellerId": se.SupplierSellerId, "Name": se.Name,
            "Phone": se.Phone or None, "IsActive": se.IsActive,
        })
    return [
        {
            "SupplierId": s.SupplierId,
            "ZoneId": s.ZoneId,
            "ZoneName": zones.get(s.ZoneId),
            "Name": s.Name,
            "SupplierTypeId": s.SupplierTypeId,
            "SupplierTypeName": types.get(s.SupplierTypeId),
            "Products": json_to_products(s.Products),
            "IsActive": s.IsActive,
            "PdvCount": int(pdv_counts.get(s.SupplierId, 0)),
            "Sellers": sellers.get(s.SupplierId, []),
        }
        for s in suppliers
    ]


def serialize_supplier(db: Session, supplier: Supplier, include_inactive_sellers: bool = False) -> dict:
    return serialize_suppliers(db, [supplier], include_inactive_sellers)[0]


def serialize_pdv_suppliers(db: Session, rows: Iterable[PdvSupplier]) -> list[dict]:
    """Respuesta `PdvSupplier` extendida: si la fila está vinculada, Name/tipo/
    productos salen del Supplier, y suma SellerName/SellerPhone."""
    rows = list(rows)
    sup_ids = {r.SupplierId for r in rows if r.SupplierId}
    sel_ids = {r.SupplierSellerId for r in rows if r.SupplierSellerId}
    sups = (
        {s.SupplierId: s for s in db.query(Supplier).filter(Supplier.SupplierId.in_(sup_ids)).all()}
        if sup_ids else {}
    )
    sels = (
        {s.SupplierSellerId: s for s in db.query(SupplierSeller).filter(SupplierSeller.SupplierSellerId.in_(sel_ids)).all()}
        if sel_ids else {}
    )
    out = []
    for r in rows:
        sup = sups.get(r.SupplierId) if r.SupplierId else None
        sel = sels.get(r.SupplierSellerId) if r.SupplierSellerId else None
        out.append({
            "PdvSupplierId": r.PdvSupplierId,
            "PdvId": r.PdvId,
            "ZoneId": r.ZoneId,
            "Name": sup.Name if sup else r.Name,
            "Phone": r.Phone or "",
            "SupplierTypeId": sup.SupplierTypeId if sup else r.SupplierTypeId,
            "Products": json_to_products(sup.Products if sup else r.Products),
            "IsActive": r.IsActive,
            "SupplierId": r.SupplierId,
            "SupplierSellerId": r.SupplierSellerId,
            "SellerName": sel.Name if sel else None,
            "SellerPhone": (sel.Phone or None) if sel else None,
            "CreatedAt": r.CreatedAt,
            "UpdatedAt": r.UpdatedAt,
        })
    return out


# ─── Unificar ────────────────────────────────────────────────────────

def merge_suppliers(db: Session, target: Supplier, sources: list[Supplier], user) -> dict:
    """Unifica `sources` en `target` (sin commit: el caller confirma la transacción).

    - Vendedores: dedup por nombre normalizado contra los activos del destino;
      si colisiona se conserva el del destino (completa Phone si faltaba), se
      re-apuntan los vínculos y el de origen se desactiva; si no, se mueve.
    - Vínculos PdvSupplier: se re-apuntan al destino; si el PDV ya tenía fila
      activa con el destino, la del origen se desactiva (trasladando el
      vendedor si la del destino no tenía).
    - Productos: unión; tipo: el del destino o, si no tiene, el del primer origen.
    - Origen: IsActive = False.
    """
    summary = {"sellersMoved": 0, "sellersMerged": 0, "linksMoved": 0, "linksDeactivated": 0}
    target_products = set(json_to_products(target.Products) or [])
    for src in sources:
        # Vendedores
        for se in db.query(SupplierSeller).filter(SupplierSeller.SupplierId == src.SupplierId).all():
            twin = find_active_seller_by_name(db, target.SupplierId, se.Name) if se.IsActive else None
            if twin is not None:
                if se.Phone and not twin.Phone:
                    twin.Phone = se.Phone
                db.query(PdvSupplier).filter(PdvSupplier.SupplierSellerId == se.SupplierSellerId).update(
                    {PdvSupplier.SupplierSellerId: twin.SupplierSellerId},
                )
                se.IsActive = False
                summary["sellersMerged"] += 1
            else:
                se.SupplierId = target.SupplierId
                summary["sellersMoved"] += 1
            db.flush()

        # Tipo / productos
        if target.SupplierTypeId is None and src.SupplierTypeId is not None:
            target.SupplierTypeId = src.SupplierTypeId
        target_products.update(json_to_products(src.Products) or [])

        # Vínculos PDV
        for row in db.query(PdvSupplier).filter(PdvSupplier.SupplierId == src.SupplierId).all():
            dup = None
            if row.IsActive and row.PdvId is not None:
                dup = (
                    db.query(PdvSupplier)
                    .filter(
                        PdvSupplier.PdvId == row.PdvId,
                        PdvSupplier.SupplierId == target.SupplierId,
                        PdvSupplier.IsActive == True,  # noqa: E712
                        PdvSupplier.PdvSupplierId != row.PdvSupplierId,
                    )
                    .first()
                )
            if dup is not None:
                if dup.SupplierSellerId is None and row.SupplierSellerId is not None:
                    dup.SupplierSellerId = row.SupplierSellerId
                row.IsActive = False
                row.SupplierId = target.SupplierId
                summary["linksDeactivated"] += 1
            else:
                row.SupplierId = target.SupplierId
                summary["linksMoved"] += 1
            db.flush()

        src.IsActive = False

    if target_products:
        target.Products = products_to_json(sorted(target_products))
    db.flush()

    # Columnas legacy de todos los vínculos del destino (nombre, zona, tipo,
    # productos y teléfono del vendedor).
    sellers = {
        s.SupplierSellerId: s
        for s in db.query(SupplierSeller).filter(SupplierSeller.SupplierId == target.SupplierId).all()
    }
    for row in db.query(PdvSupplier).filter(PdvSupplier.SupplierId == target.SupplierId).all():
        sync_link_legacy(row, target, sellers.get(row.SupplierSellerId) if row.SupplierSellerId else None)
    db.flush()
    return summary
