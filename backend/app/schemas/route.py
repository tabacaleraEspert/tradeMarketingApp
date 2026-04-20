from datetime import date, datetime, time
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


class RouteDayUpdate(BaseModel):
    Status: str | None = None


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
