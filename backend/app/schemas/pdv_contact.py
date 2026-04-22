from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator


class PdvContactBase(BaseModel):
    ContactName: str = Field(..., max_length=120)
    ContactPhone: str | None = Field(None, max_length=40)
    ContactRole: str | None = Field(None, max_length=40)
    DecisionPower: str | None = Field(None, max_length=20)
    Birthday: date | None = None
    Notes: str | None = Field(None, max_length=1000)
    ProfileNotes: str | None = Field(None, max_length=1000)

    @field_validator("ContactName")
    @classmethod
    def _v_contact_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("El nombre del contacto no puede estar vacío")
        return v.strip()


class PdvContactCreate(PdvContactBase):
    pass


class PdvContactUpdate(BaseModel):
    ContactName: str | None = None
    ContactPhone: str | None = None
    ContactRole: str | None = None
    DecisionPower: str | None = None
    Birthday: date | None = None
    Notes: str | None = None
    ProfileNotes: str | None = None


class PdvContact(PdvContactBase):
    PdvContactId: int
    PdvId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
