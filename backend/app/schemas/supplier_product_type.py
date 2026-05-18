from datetime import datetime
from pydantic import BaseModel, Field


class SupplierProductTypeCreate(BaseModel):
    Name: str = Field(..., max_length=80)
    IsActive: bool = True


class SupplierProductTypeUpdate(BaseModel):
    Name: str | None = Field(None, max_length=80)
    IsActive: bool | None = None


class SupplierProductType(BaseModel):
    SupplierProductTypeId: int
    Name: str
    IsActive: bool
    CreatedAt: datetime

    class Config:
        from_attributes = True
