from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class PdvBase(BaseModel):
    Code: str | None = None
    Name: str
    Channel: str
    Address: str | None = None
    City: str | None = None
    ZoneId: int | None = None
    DistributorId: int | None = None
    Lat: Decimal | None = None
    Lon: Decimal | None = None
    ContactName: str | None = None
    ContactPhone: str | None = None
    DefaultMaterialExternalId: str | None = None
    IsActive: bool = True


class PdvCreate(PdvBase):
    pass


class PdvUpdate(BaseModel):
    Code: str | None = None
    Name: str | None = None
    Channel: str | None = None
    Address: str | None = None
    City: str | None = None
    ZoneId: int | None = None
    DistributorId: int | None = None
    Lat: Decimal | None = None
    Lon: Decimal | None = None
    ContactName: str | None = None
    ContactPhone: str | None = None
    DefaultMaterialExternalId: str | None = None
    IsActive: bool | None = None


class Pdv(PdvBase):
    PdvId: int
    CreatedAt: datetime
    UpdatedAt: datetime

    class Config:
        from_attributes = True
