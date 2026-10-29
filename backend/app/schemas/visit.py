from datetime import datetime
from pydantic import BaseModel, field_validator

CLOSE_REASON_MAX = 200  # Visit.CloseReason String(200)


def _clip_close_reason(v: str | None) -> str | None:
    """Recorta en vez de reventar con 500 (truncation de SQL Server). El texto completo
    del recordatorio ya se guarda como nota del PDV (VisitSummaryPage)."""
    return v[:CLOSE_REASON_MAX] if isinstance(v, str) else v


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

    _clip = field_validator("CloseReason")(_clip_close_reason)


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

    _clip = field_validator("CloseReason")(_clip_close_reason)


class Visit(VisitBase):
    VisitId: int
    OpenedAt: datetime
    ClosedAt: datetime | None = None
    SubmittedAt: datetime | None = None

    class Config:
        from_attributes = True
