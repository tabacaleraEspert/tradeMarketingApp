from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, Field, field_validator

from .pdv_contact import PdvContact, PdvContactCreate


def _validate_lat(v: Decimal | None) -> Decimal | None:
    if v is None:
        return v
    if v < Decimal("-90") or v > Decimal("90"):
        raise ValueError("La latitud debe estar entre -90 y 90")
    return v


def _validate_lon(v: Decimal | None) -> Decimal | None:
    if v is None:
        return v
    if v < Decimal("-180") or v > Decimal("180"):
        raise ValueError("La longitud debe estar entre -180 y 180")
    return v


def _validate_hhmm(v: str | None) -> str | None:
    if not v:
        return v
    parts = v.split(":")
    if len(parts) != 2:
        raise ValueError("Hora inválida (formato HH:MM)")
    try:
        h, m = int(parts[0]), int(parts[1])
    except ValueError:
        raise ValueError("Hora inválida (formato HH:MM)")
    if h < 0 or h > 23 or m < 0 or m > 59:
        raise ValueError("Hora inválida (HH ∈ 0-23, MM ∈ 0-59)")
    return f"{h:02d}:{m:02d}"


def volume_to_category(volume: int | None) -> str | None:
    """Derive volume category from monthly cigarette pack count."""
    if volume is None:
        return None
    if volume <= 800:
        return "Chico"
    if volume <= 1500:
        return "Mediano"
    return "Grande"


class PdvBase(BaseModel):
    Code: str | None = Field(None, max_length=50)
    Name: str = Field(..., max_length=160)
    BusinessName: str | None = Field(None, max_length=200)
    Channel: str | None = Field(None, max_length=40)
    ChannelId: int | None = None
    SubChannelId: int | None = None
    Address: str | None = Field(None, max_length=200)
    City: str | None = Field(None, max_length=80)
    ZoneId: int | None = None
    DistributorId: int | None = None
    Lat: Decimal | None = None
    Lon: Decimal | None = None
    ContactName: str | None = Field(None, max_length=120)
    ContactPhone: str | None = Field(None, max_length=40)
    OpeningTime: str | None = Field(None, max_length=5)
    ClosingTime: str | None = Field(None, max_length=5)
    TimeSlotsJson: str | None = None
    VisitDay: int | None = None  # 0=Dom .. 6=Sáb
    MonthlyVolume: int | None = None  # Atados de cigarrillos / mes
    Category: str | None = None  # Chico / Mediano / Grande (derivado de MonthlyVolume)
    DefaultMaterialExternalId: str | None = Field(None, max_length=50)
    AssignedUserId: int | None = None
    IsActive: bool = True
    InactiveReason: str | None = Field(None, max_length=500)
    ReactivateOn: date | None = None


class PdvCreate(BaseModel):
    Code: str | None = Field(None, max_length=50)
    Name: str = Field(..., max_length=160)
    BusinessName: str | None = Field(None, max_length=200)
    ChannelId: int
    SubChannelId: int | None = None
    Address: str | None = Field(None, max_length=200)
    City: str | None = Field(None, max_length=80)
    ZoneId: int | None = None
    DistributorId: int | None = None
    DistributorIds: list[int] | None = None
    Lat: Decimal | None = None
    Lon: Decimal | None = None
    OpeningTime: str | None = Field(None, max_length=5)
    ClosingTime: str | None = Field(None, max_length=5)
    TimeSlotsJson: str | None = None
    VisitDay: int | None = None
    MonthlyVolume: int | None = Field(None, ge=0, description="Atados de cigarrillos / mes")
    Contacts: list[PdvContactCreate] | None = None
    DefaultMaterialExternalId: str | None = Field(None, max_length=50)
    IsActive: bool = True

    @field_validator("Lat")
    @classmethod
    def _v_lat(cls, v):
        return _validate_lat(v)

    @field_validator("Lon")
    @classmethod
    def _v_lon(cls, v):
        return _validate_lon(v)

    @field_validator("OpeningTime", "ClosingTime")
    @classmethod
    def _v_hhmm(cls, v):
        return _validate_hhmm(v)

    @field_validator("VisitDay")
    @classmethod
    def _v_visit_day(cls, v):
        if v is not None and (v < 0 or v > 6):
            raise ValueError("VisitDay debe estar entre 0 (Dom) y 6 (Sáb)")
        return v

    @field_validator("Name")
    @classmethod
    def _v_name(cls, v):
        if not v or not v.strip():
            raise ValueError("El nombre del PDV no puede estar vacío")
        return v.strip()


class PdvUpdate(BaseModel):
    Code: str | None = Field(None, max_length=50)
    Name: str | None = Field(None, max_length=160)
    BusinessName: str | None = Field(None, max_length=200)
    ChannelId: int | None = None
    SubChannelId: int | None = None
    Address: str | None = Field(None, max_length=200)
    City: str | None = Field(None, max_length=80)
    ZoneId: int | None = None
    DistributorId: int | None = None
    DistributorIds: list[int] | None = None
    Lat: Decimal | None = None
    Lon: Decimal | None = None
    ContactName: str | None = Field(None, max_length=120)
    ContactPhone: str | None = Field(None, max_length=40)
    OpeningTime: str | None = Field(None, max_length=5)
    ClosingTime: str | None = Field(None, max_length=5)
    TimeSlotsJson: str | None = None
    VisitDay: int | None = None
    MonthlyVolume: int | None = Field(None, ge=0, description="Atados de cigarrillos / mes")
    Contacts: list[PdvContactCreate] | None = None
    DefaultMaterialExternalId: str | None = Field(None, max_length=50)
    IsActive: bool | None = None
    InactiveReason: str | None = Field(None, max_length=500)
    ReactivateOn: date | None = None

    @field_validator("Lat")
    @classmethod
    def _v_lat(cls, v):
        return _validate_lat(v)

    @field_validator("Lon")
    @classmethod
    def _v_lon(cls, v):
        return _validate_lon(v)

    @field_validator("OpeningTime", "ClosingTime")
    @classmethod
    def _v_hhmm(cls, v):
        return _validate_hhmm(v)

    @field_validator("VisitDay")
    @classmethod
    def _v_visit_day(cls, v):
        if v is not None and (v < 0 or v > 6):
            raise ValueError("VisitDay debe estar entre 0 (Dom) y 6 (Sáb)")
        return v

    @field_validator("Name")
    @classmethod
    def _v_name(cls, v):
        if v is not None and not v.strip():
            raise ValueError("El nombre del PDV no puede estar vacío")
        return v.strip() if v else v


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
