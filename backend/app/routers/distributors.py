import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Distributor as DistributorModel
from ..schemas.distributor import Distributor, DistributorCreate, DistributorUpdate

router = APIRouter(prefix="/distributors", tags=["Distribuidores"])


def _normalize_phone(phone: str | None) -> str | None:
    """Normalize phone to digits only (strip spaces, dashes, parens, +54, etc.)."""
    if not phone:
        return None
    digits = re.sub(r"[^\d]", "", phone)
    # Strip Argentina country code prefix (54) if present
    if digits.startswith("54") and len(digits) > 10:
        digits = digits[2:]
    # Strip leading 0 (area code prefix)
    if digits.startswith("0") and len(digits) > 10:
        digits = digits[1:]
    # Strip 15 prefix (old mobile format)
    if digits.startswith("15") and len(digits) == 10:
        digits = digits[2:]
    return digits if digits else None


@router.get("", response_model=list[Distributor])
def list_distributors(skip: int = 0, limit: int = Query(default=100, le=500), db: Session = Depends(get_db)):
    return db.query(DistributorModel).order_by(DistributorModel.DistributorId).offset(skip).limit(limit).all()


@router.get("/{distributor_id}", response_model=Distributor)
def get_distributor(distributor_id: int, db: Session = Depends(get_db)):
    d = db.query(DistributorModel).filter(DistributorModel.DistributorId == distributor_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Distribuidor no encontrado")
    return d


@router.post("", response_model=Distributor, status_code=201)
def create_distributor(data: DistributorCreate, db: Session = Depends(get_db)):
    normalized = _normalize_phone(data.Phone)

    # If phone provided, check if a distributor with the same phone already exists
    if normalized:
        existing = db.query(DistributorModel).filter(
            DistributorModel.Phone == normalized
        ).first()
        if existing:
            # Return existing distributor (dedup by phone)
            return existing

    d = DistributorModel(
        Name=data.Name,
        Phone=normalized,
        DistributorType=data.DistributorType,
        SupplierSource=data.SupplierSource,
        IsActive=data.IsActive,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


@router.patch("/{distributor_id}", response_model=Distributor)
def update_distributor(distributor_id: int, data: DistributorUpdate, db: Session = Depends(get_db)):
    d = db.query(DistributorModel).filter(DistributorModel.DistributorId == distributor_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Distribuidor no encontrado")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(d, k, v)
    db.commit()
    db.refresh(d)
    return d


@router.delete("/{distributor_id}", status_code=204)
def delete_distributor(distributor_id: int, db: Session = Depends(get_db)):
    d = db.query(DistributorModel).filter(DistributorModel.DistributorId == distributor_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Distribuidor no encontrado")
    db.delete(d)
    db.commit()
