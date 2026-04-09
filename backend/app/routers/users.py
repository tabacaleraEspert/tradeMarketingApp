from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import bcrypt

from ..database import get_db
from ..models import User as UserModel, Visit as VisitModel, PDV as PDVModel
from ..models.user import UserRole as UserRoleModel, Role as RoleModel
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


@router.get("/{user_id}/stats/monthly")
def get_user_monthly_stats(user_id: int, db: Session = Depends(get_db)):
    """Estadísticas del mes actual: visitas, cumplimiento, PDV nuevos."""
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    now = datetime.now(timezone.utc)
    first_day = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 12:
        last_day = now.replace(day=31, hour=23, minute=59, second=59, microsecond=999999)
    else:
        last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(microseconds=1)

    # Visitas del mes (por OpenedAt)
    visits = (
        db.query(VisitModel)
        .filter(
            VisitModel.UserId == user_id,
            VisitModel.OpenedAt >= first_day,
            VisitModel.OpenedAt <= last_day,
        )
        .all()
    )
    total_visits = len(visits)
    completed_visits = sum(
        1 for v in visits if v.Status and v.Status.upper() in ("CLOSED", "COMPLETED")
    )
    compliance = round((completed_visits / total_visits * 100) if total_visits > 0 else 0)

    # PDV nuevos del mes (en la zona del usuario, por CreatedAt)
    pdv_q = db.query(PDVModel).filter(
        PDVModel.CreatedAt >= first_day,
        PDVModel.CreatedAt <= last_day,
    )
    if user.ZoneId:
        pdv_q = pdv_q.filter(PDVModel.ZoneId == user.ZoneId)
    new_pdvs = pdv_q.count()

    return {
        "visits": total_visits,
        "compliance": compliance,
        "new_pdvs": new_pdvs,
    }


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
    dump = data.model_dump(exclude_unset=True)
    if "Password" in dump:
        pwd = dump.pop("Password")
        if pwd:
            user.PasswordHash = hash_password(pwd)
    for k, v in dump.items():
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


# ── User Role ─────────────────────────────────────────────

@router.get("/{user_id}/role")
def get_user_role(user_id: int, db: Session = Depends(get_db)):
    ur = db.query(UserRoleModel).filter(UserRoleModel.UserId == user_id).first()
    if not ur:
        return {"userId": user_id, "roleId": None, "roleName": None}
    role = db.query(RoleModel).filter(RoleModel.RoleId == ur.RoleId).first()
    return {"userId": user_id, "roleId": ur.RoleId, "roleName": role.Name if role else None}


@router.put("/{user_id}/role")
def set_user_role(user_id: int, data: dict, db: Session = Depends(get_db)):
    """Payload: { roleId: int }"""
    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    role_id = data.get("roleId")
    if not role_id:
        raise HTTPException(status_code=400, detail="roleId requerido")
    # Upsert
    ur = db.query(UserRoleModel).filter(UserRoleModel.UserId == user_id).first()
    if ur:
        ur.RoleId = role_id
    else:
        ur = UserRoleModel(UserId=user_id, RoleId=role_id)
        db.add(ur)
    db.commit()
    role = db.query(RoleModel).filter(RoleModel.RoleId == role_id).first()
    return {"userId": user_id, "roleId": role_id, "roleName": role.Name if role else None}
