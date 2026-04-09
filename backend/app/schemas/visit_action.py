from datetime import datetime
from pydantic import BaseModel


class VisitActionBase(BaseModel):
    ActionType: str          # cobertura, pop, canje_sueltos, promo, otra
    Description: str | None = None
    DetailsJson: str | None = None
    PhotoRequired: bool = True
    PhotoTaken: bool = False


class VisitActionCreate(VisitActionBase):
    pass


class VisitActionUpdate(BaseModel):
    Description: str | None = None
    DetailsJson: str | None = None
    PhotoRequired: bool | None = None
    PhotoTaken: bool | None = None
    Status: str | None = None


class VisitAction(VisitActionBase):
    VisitActionId: int
    VisitId: int
    IsMandatory: bool = False
    MandatoryActivityId: int | None = None
    Status: str = "PENDING"
    CreatedAt: datetime

    class Config:
        from_attributes = True
