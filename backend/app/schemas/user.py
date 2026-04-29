import re
from datetime import datetime
from pydantic import BaseModel, field_validator


_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def _validate_email(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().lower()
    if not _EMAIL_RE.match(v):
        raise ValueError("Email inválido")
    return v


def _validate_password(v: str | None) -> str | None:
    if v is None:
        return v
    if len(v) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres")
    return v


class UserBase(BaseModel):
    Email: str
    DisplayName: str
    ZoneId: int | None = None
    ManagerUserId: int | None = None
    IsActive: bool = True


class UserCreate(UserBase):
    Password: str | None = None
    RoleName: str | None = None  # admin, territory_manager, ejecutivo, vendedor
    MustChangePassword: bool = True

    @field_validator("Email")
    @classmethod
    def _v_email(cls, v):
        return _validate_email(v)

    @field_validator("Password")
    @classmethod
    def _v_password(cls, v):
        return _validate_password(v)

    @field_validator("DisplayName")
    @classmethod
    def _v_display_name(cls, v):
        if not v or not v.strip():
            raise ValueError("El nombre no puede estar vacío")
        return v.strip()


class UserUpdate(BaseModel):
    Email: str | None = None
    DisplayName: str | None = None
    ZoneId: int | None = None
    ManagerUserId: int | None = None
    IsActive: bool | None = None
    Password: str | None = None
    RoleName: str | None = None
    MustChangePassword: bool | None = None

    @field_validator("Email")
    @classmethod
    def _v_email(cls, v):
        return _validate_email(v)

    @field_validator("Password")
    @classmethod
    def _v_password(cls, v):
        return _validate_password(v)


class User(UserBase):
    UserId: int
    MustChangePassword: bool = False
    RoleName: str | None = None
    AvatarUrl: str | None = None
    CreatedAt: datetime | None = None
    UpdatedAt: datetime | None = None

    class Config:
        from_attributes = True
