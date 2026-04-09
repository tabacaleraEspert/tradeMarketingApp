from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel

from .pdv_contact import PdvContact, PdvContactCreate


class PdvBase(BaseModel):
    Code: str | None = None
    Name: str
    Channel: str | None = None  # Legacy, preferir ChannelId
    ChannelId: int | None = None
    SubChannelId: int | None = None
    Address: str | None = None
    City: str | None = None
    ZoneId: int | None = None
    DistributorId: int | None = None  # Legacy single distributor
    Lat: Decimal | None = None
    Lon: Decimal | None = None
    ContactName: str | None = None  # Legacy
    ContactPhone: str | None = None  # Legacy
    DefaultMaterialExternalId: str | None = None
    IsActive: bool = True


class PdvCreate(BaseModel):
    Code: str | None = None
    Name: str
    ChannelId: int
    SubChannelId: int | None = None
    Address: str | None = None
    City: str | None = None
    ZoneId: int | None = None
    DistributorId: int | None = None  # Legacy compat
    DistributorIds: list[int] | None = None
    Lat: Decimal | None = None
    Lon: Decimal | None = None
    Contacts: list[PdvContactCreate] | None = None
    DefaultMaterialExternalId: str | None = None
    IsActive: bool = True


class PdvUpdate(BaseModel):
    Code: str | None = None
    Name: str | None = None
    ChannelId: int | None = None
    SubChannelId: int | None = None
    Address: str | None = None
    City: str | None = None
    ZoneId: int | None = None
    DistributorId: int | None = None  # Legacy compat
    DistributorIds: list[int] | None = None
    Lat: Decimal | None = None
    Lon: Decimal | None = None
    ContactName: str | None = None
    ContactPhone: str | None = None
    Contacts: list[PdvContactCreate] | None = None
    DefaultMaterialExternalId: str | None = None
    IsActive: bool | None = None


class DistributorInfo(BaseModel):
    DistributorId: int
    Name: str

    class Config:
        from_attributes = True


class Pdv(PdvBase):
    PdvId: int
    ChannelName: str | None = None
    SubChannelName: str | None = None
    Contacts: list[PdvContact] = []
    Distributors: list[DistributorInfo] = []
    CreatedAt: datetime
    UpdatedAt: datetime

    class Config:
        from_attributes = True
