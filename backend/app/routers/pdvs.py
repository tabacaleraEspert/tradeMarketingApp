import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import PDV as PDVModel
from ..schemas.pdv import Pdv, PdvCreate, PdvUpdate

router = APIRouter(prefix="/pdvs", tags=["PDVs"])


@router.get("", response_model=list[Pdv])
def list_pdvs(
    skip: int = 0,
    limit: int = 100,
    zone_id: int | None = None,
    distributor_id: int | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(PDVModel)
    if zone_id is not None:
        q = q.filter(PDVModel.ZoneId == zone_id)
    if distributor_id is not None:
        q = q.filter(PDVModel.DistributorId == distributor_id)
    return q.order_by(PDVModel.PdvId).offset(skip).limit(limit).all()


@router.get("/{pdv_id}", response_model=Pdv)
def get_pdv(pdv_id: int, db: Session = Depends(get_db)):
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")
    return pdv


@router.post("", response_model=Pdv, status_code=201)
def create_pdv(data: PdvCreate, db: Session = Depends(get_db)):
    # Code tiene UNIQUE en SQL Server; NULL se considera duplicado. Generar código si no viene.
    code = data.Code or f"PDV-{uuid.uuid4().hex[:12].upper()}"
    print(f"[PDV] Creando en tabla PDV: Name={data.Name!r}, Channel={data.Channel}, Address={data.Address!r}", flush=True)
    pdv = PDVModel(
        Code=code,
        Name=data.Name,
        Channel=data.Channel,
        Address=data.Address,
        City=data.City,
        ZoneId=data.ZoneId,
        DistributorId=data.DistributorId,
        Lat=data.Lat,
        Lon=data.Lon,
        ContactName=data.ContactName,
        ContactPhone=data.ContactPhone,
        DefaultMaterialExternalId=data.DefaultMaterialExternalId,
        IsActive=data.IsActive,
    )
    db.add(pdv)
    db.commit()
    db.refresh(pdv)
    print(f"[PDV] Guardado en tabla PDV: PdvId={pdv.PdvId}", flush=True)
    return pdv


@router.patch("/{pdv_id}", response_model=Pdv)
def update_pdv(pdv_id: int, data: PdvUpdate, db: Session = Depends(get_db)):
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(pdv, k, v)
    db.commit()
    db.refresh(pdv)
    return pdv


@router.delete("/{pdv_id}", status_code=204)
def delete_pdv(pdv_id: int, db: Session = Depends(get_db)):
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")
    db.delete(pdv)
    db.commit()
