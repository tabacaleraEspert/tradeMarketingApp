from datetime import date, datetime
from pydantic import BaseModel


class HolidayBase(BaseModel):
    Date: date
    Name: str
    Kind: str | None = None
    IsActive: bool = True


class HolidayCreate(HolidayBase):
    pass


class HolidayUpdate(BaseModel):
    Date: date | None = None
    Name: str | None = None
    Kind: str | None = None
    IsActive: bool | None = None


class Holiday(HolidayBase):
    HolidayId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
