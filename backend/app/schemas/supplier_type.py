from datetime import datetime
from pydantic import BaseModel, Field


class SupplierTypeCreate(BaseModel):
    Name: str = Field(..., max_length=80)
    IsActive: bool = True


class SupplierTypeUpdate(BaseModel):
    Name: str | None = Field(None, max_length=80)
    IsActive: bool | None = None


class SupplierType(BaseModel):
    SupplierTypeId: int
    Name: str
    IsActive: bool
    CreatedAt: datetime

    class Config:
        from_attributes = True
