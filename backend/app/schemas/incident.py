from datetime import datetime
from pydantic import BaseModel


class IncidentBase(BaseModel):
    VisitId: int | None = None
    PdvId: int | None = None
    Type: str
    Status: str = "OPEN"
    Priority: int = 3
    Notes: str | None = None
    CreatedBy: int | None = None


class IncidentCreate(IncidentBase):
    pass


class IncidentUpdate(BaseModel):
    Status: str | None = None
    Priority: int | None = None
    Notes: str | None = None


class Incident(IncidentBase):
    IncidentId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
