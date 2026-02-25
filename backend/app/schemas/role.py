from datetime import datetime
from pydantic import BaseModel


class RoleBase(BaseModel):
    Name: str


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    Name: str | None = None


class Role(RoleBase):
    RoleId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
