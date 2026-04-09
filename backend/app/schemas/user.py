from datetime import datetime
from pydantic import BaseModel


class UserBase(BaseModel):
    Email: str
    DisplayName: str
    ZoneId: int | None = None
    IsActive: bool = True


class UserCreate(UserBase):
    Password: str | None = None


class UserUpdate(BaseModel):
    Email: str | None = None
    DisplayName: str | None = None
    ZoneId: int | None = None
    IsActive: bool | None = None
    Password: str | None = None


class User(UserBase):
    UserId: int
    CreatedAt: datetime
    UpdatedAt: datetime

    class Config:
        from_attributes = True
