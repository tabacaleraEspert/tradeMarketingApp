from datetime import datetime
from pydantic import BaseModel


class VisitBase(BaseModel):
    PdvId: int
    UserId: int
    RouteDayId: int | None = None
    Status: str = "OPEN"
    FormId: int | None = None
    FormVersion: int | None = None
    FormStatus: str = "DRAFT"
    MaterialExternalId: str | None = None
    CloseReason: str | None = None


class VisitCreate(VisitBase):
    pass


class VisitUpdate(BaseModel):
    Status: str | None = None
    FormId: int | None = None
    FormVersion: int | None = None
    FormStatus: str | None = None
    MaterialExternalId: str | None = None
    CloseReason: str | None = None  # Recordatorio próxima visita
    ClosedAt: datetime | None = None


class Visit(VisitBase):
    VisitId: int
    OpenedAt: datetime
    ClosedAt: datetime | None = None
    SubmittedAt: datetime | None = None

    class Config:
        from_attributes = True
