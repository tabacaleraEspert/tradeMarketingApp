from datetime import datetime
from pydantic import BaseModel, Field


class PdvSupplierCreate(BaseModel):
    Name: str = Field(..., max_length=120)
    # Opcional: puede cargarse sin teléfono y completarse después
    Phone: str = Field("", max_length=40)
    SupplierTypeId: int | None = None
    ZoneId: int | None = None
    Products: list[str] | None = None  # ["Cigarrillos", "Golosinas"]


class PdvSupplierUpdate(BaseModel):
    Name: str | None = Field(None, max_length=120)
    Phone: str | None = Field(None, max_length=40)
    SupplierTypeId: int | None = None
    ZoneId: int | None = None
    Products: list[str] | None = None
    IsActive: bool | None = None


class PdvSupplier(BaseModel):
    PdvSupplierId: int
    PdvId: int | None = None  # NULL = catálogo de zona (no atado a un PDV)
    ZoneId: int | None = None
    Name: str
    Phone: str
    SupplierTypeId: int | None = None
    Products: list[str] | None = None
    IsActive: bool
    CreatedAt: datetime
    UpdatedAt: datetime

    class Config:
        from_attributes = True
