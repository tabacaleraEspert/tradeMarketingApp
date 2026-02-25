from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Distributor as DistributorModel
from ..schemas.distributor import Distributor, DistributorCreate, DistributorUpdate

router = APIRouter(prefix="/distributors", tags=["Distribuidores"])


@router.get("", response_model=list[Distributor])
def list_distributors(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(DistributorModel).order_by(DistributorModel.DistributorId).offset(skip).limit(limit).all()


@router.get("/{distributor_id}", response_model=Distributor)
def get_distributor(distributor_id: int, db: Session = Depends(get_db)):
    d = db.query(DistributorModel).filter(DistributorModel.DistributorId == distributor_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Distribuidor no encontrado")
    return d


@router.post("", response_model=Distributor, status_code=201)
def create_distributor(data: DistributorCreate, db: Session = Depends(get_db)):
    d = DistributorModel(Name=data.Name, IsActive=data.IsActive)
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
