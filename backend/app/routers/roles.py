from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Role as RoleModel
from ..schemas.role import Role, RoleCreate, RoleUpdate

router = APIRouter(prefix="/roles", tags=["Roles"])


@router.get("", response_model=list[Role])
def list_roles(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(RoleModel).order_by(RoleModel.RoleId).offset(skip).limit(limit).all()


@router.get("/{role_id}", response_model=Role)
def get_role(role_id: int, db: Session = Depends(get_db)):
    role = db.query(RoleModel).filter(RoleModel.RoleId == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return role


@router.post("", response_model=Role, status_code=201)
def create_role(data: RoleCreate, db: Session = Depends(get_db)):
    role = RoleModel(Name=data.Name)
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


@router.patch("/{role_id}", response_model=Role)
def update_role(role_id: int, data: RoleUpdate, db: Session = Depends(get_db)):
    role = db.query(RoleModel).filter(RoleModel.RoleId == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    if data.Name is not None:
        role.Name = data.Name
    db.commit()
    db.refresh(role)
    return role


@router.delete("/{role_id}", status_code=204)
def delete_role(role_id: int, db: Session = Depends(get_db)):
    role = db.query(RoleModel).filter(RoleModel.RoleId == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    db.delete(role)
    db.commit()
