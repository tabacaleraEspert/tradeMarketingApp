from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import bcrypt

from ..database import get_db
from ..models import User as UserModel, UserRole, Role, Zone


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    UserId: int
    Email: str
    DisplayName: str
    ZoneId: int | None
    ZoneName: str | None
    Role: str
    IsActive: bool

    class Config:
        from_attributes = True


@router.post("/login", response_model=LoginResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    print(f"[LOGIN] Intento con email: {data.email!r}")
    user = db.query(UserModel).filter(UserModel.Email == data.email).first()
    if not user:
        print(f"[LOGIN] Usuario no encontrado")
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    print(f"[LOGIN] Usuario encontrado: UserId={user.UserId}, PasswordHash={'Sí' if user.PasswordHash else 'No'}")

    if not user.PasswordHash:
        raise HTTPException(
            status_code=401,
            detail="Usuario sin contraseña configurada. Ejecuta el script seed.",
        )

    ok = verify_password(data.password, user.PasswordHash)
    print(f"[LOGIN] bcrypt.checkpw: {ok}")
    if not ok:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    if not user.IsActive:
        raise HTTPException(status_code=401, detail="Usuario inactivo")

    # Obtener rol y zona
    role_name = "vendedor"
    user_role = db.query(UserRole).filter(UserRole.UserId == user.UserId).first()
    if user_role:
        role = db.query(Role).filter(Role.RoleId == user_role.RoleId).first()
        if role:
            role_name = role.Name

    zone_name = None
    if user.ZoneId:
        zone = db.query(Zone).filter(Zone.ZoneId == user.ZoneId).first()
        if zone:
            zone_name = zone.Name

    print(f"[LOGIN] OK - {user.Email}")
    return LoginResponse(
        UserId=user.UserId,
        Email=user.Email,
        DisplayName=user.DisplayName,
        ZoneId=user.ZoneId,
        ZoneName=zone_name,
        Role=role_name,
        IsActive=user.IsActive,
    )
