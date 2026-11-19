from datetime import date, datetime, time
from typing import Literal
from pydantic import BaseModel
from .form import Form


class RouteBase(BaseModel):
    Name: str
    ZoneId: int | None = None
    FormId: int | None = None
    IsActive: bool = True
    BejermanZone: str | None = None
    FrequencyType: str | None = None
    FrequencyConfig: str | None = None
    EstimatedMinutes: int | None = None
    AssignedUserId: int | None = None
    IsOptimized: bool = False
    IsFocus: bool = True
    # "regular" | "campaign" (ruta de campaña: temporal, solo admin). No cambia después del alta.
    RouteType: Literal["regular", "campaign"] = "regular"
    # Fecha de fin inclusive (obligatoria en campaña).
    EndDate: date | None = None


class RouteCreate(RouteBase):
    CreatedByUserId: int | None = None


class RouteUpdate(BaseModel):
    Name: str | None = None
    ZoneId: int | None = None
    FormId: int | None = None
    IsActive: bool | None = None
    BejermanZone: str | None = None
    FrequencyType: str | None = None
    FrequencyConfig: str | None = None
    EstimatedMinutes: int | None = None
    AssignedUserId: int | None = None
    IsOptimized: bool | None = None
    IsFocus: bool | None = None
    EndDate: date | None = None
    # Solo se acepta si coincide con el actual (el tipo no se cambia).
    RouteType: Literal["regular", "campaign"] | None = None


class Route(RouteBase):
    RouteId: int
    CreatedByUserId: int | None = None
    PdvCount: int = 0  # Auto-calculado
    AssignedUserName: str | None = None
    CreatedAt: datetime

    class Config:
        from_attributes = True


class RouteFormCreate(BaseModel):
    FormId: int
    SortOrder: int = 0


class RouteFormRead(BaseModel):
    RouteId: int
    FormId: int
    SortOrder: int

    class Config:
        from_attributes = True


class RouteFormWithForm(BaseModel):
    """RouteForm con datos del Form para listados."""
    RouteId: int
    FormId: int
    SortOrder: int
    Form: Form

    class Config:
        from_attributes = True


class RoutePdvBase(BaseModel):
    RouteId: int
    PdvId: int
    SortOrder: int
    Priority: int = 3


class RoutePdvCreate(BaseModel):
    """Body para POST /routes/{id}/pdvs - RouteId viene de la URL."""
    PdvId: int
    SortOrder: int
    Priority: int = 3


class RoutePdv(RoutePdvBase):
    class Config:
        from_attributes = True


class RouteDayBase(BaseModel):
    RouteId: int
    WorkDate: date
    AssignedUserId: int
    Status: str = "PLANNED"


class RouteDayCreate(BaseModel):
    WorkDate: date
    AssignedUserId: int | None = None
    Status: str = "PLANNED"
    # "board" cuando el alta es manual desde el tablero de control: deja rastro en AuditEvent
    # (los editores generan días en lote y no lo mandan).
    Origin: str | None = None


class RouteDayUpdate(BaseModel):
    Status: str | None = None
    # Tablero de control: mover SOLO este día a otra fecha y/o a otro trade.
    WorkDate: date | None = None
    AssignedUserId: int | None = None


class RouteDayShiftWeekday(BaseModel):
    """Mover "toda la ruta de acá en adelante" a otro día de la semana: `WorkDate` es la
    fecha destino del día arrastrado (misma semana, otro día). Con `AssignedUserId` además
    reasigna la ruta a ese trade en la misma transacción."""
    WorkDate: date
    AssignedUserId: int | None = None


class RouteDay(RouteDayBase):
    RouteDayId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True


class RouteDayPdvBase(BaseModel):
    RouteDayId: int
    PdvId: int
    PlannedOrder: int
    PlannedWindowFrom: time | None = None
    PlannedWindowTo: time | None = None
    Priority: int = 3
    ExecutionStatus: str = "PENDING"


class RouteDayPdvCreate(RouteDayPdvBase):
    pass


class RouteDayPdvUpdate(BaseModel):
    ExecutionStatus: str | None = None


class RouteDayPdv(RouteDayPdvBase):
    class Config:
        from_attributes = True
