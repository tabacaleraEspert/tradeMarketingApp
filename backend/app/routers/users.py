from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import bcrypt

from ..database import get_db
from ..models import User as UserModel
from ..schemas.user import User, UserCreate, UserUpdate


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
router = APIRouter(prefix="/users", tags=["Usuarios"])


@router.get("", response_model=list[User])
def list_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(UserModel).order_by(UserModel.UserId).offset(skip).limit(limit).all()


@router.get("/{user_id}", response_model=User)
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return user


@router.post("", response_model=User, status_code=201)
def create_user(data: UserCreate, db: Session = Depends(get_db)):
    password_hash = None
    if data.Password:
        password_hash = hash_password(data.Password)
    user = UserModel(
        Email=data.Email,
        DisplayName=data.DisplayName,
        ZoneId=data.ZoneId,
        IsActive=data.IsActive,
        PasswordHash=password_hash,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=User)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    db.delete(user)
    db.commit()
