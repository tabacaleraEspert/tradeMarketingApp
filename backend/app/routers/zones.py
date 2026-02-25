from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Zone as ZoneModel
from ..schemas.zone import Zone, ZoneCreate, ZoneUpdate

router = APIRouter(prefix="/zones", tags=["Zonas"])


@router.get("", response_model=list[Zone])
def list_zones(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(ZoneModel).order_by(ZoneModel.ZoneId).offset(skip).limit(limit).all()


@router.get("/{zone_id}", response_model=Zone)
def get_zone(zone_id: int, db: Session = Depends(get_db)):
    zone = db.query(ZoneModel).filter(ZoneModel.ZoneId == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zona no encontrada")
    return zone


@router.post("", response_model=Zone, status_code=201)
def create_zone(data: ZoneCreate, db: Session = Depends(get_db)):
    zone = ZoneModel(Name=data.Name)
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return zone


@router.patch("/{zone_id}", response_model=Zone)
def update_zone(zone_id: int, data: ZoneUpdate, db: Session = Depends(get_db)):
    zone = db.query(ZoneModel).filter(ZoneModel.ZoneId == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zona no encontrada")
    if data.Name is not None:
        zone.Name = data.Name
    db.commit()
    db.refresh(zone)
    return zone


@router.delete("/{zone_id}", status_code=204)
def delete_zone(zone_id: int, db: Session = Depends(get_db)):
    zone = db.query(ZoneModel).filter(ZoneModel.ZoneId == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zona no encontrada")
    db.delete(zone)
    db.commit()
