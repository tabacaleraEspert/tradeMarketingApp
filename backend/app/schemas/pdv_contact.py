from datetime import date, datetime
from pydantic import BaseModel


class PdvContactBase(BaseModel):
    ContactName: str
    ContactPhone: str | None = None
    Birthday: date | None = None


class PdvContactCreate(PdvContactBase):
    pass


class PdvContactUpdate(BaseModel):
    ContactName: str | None = None
    ContactPhone: str | None = None
    Birthday: date | None = None


class PdvContact(PdvContactBase):
    PdvContactId: int
    PdvId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
