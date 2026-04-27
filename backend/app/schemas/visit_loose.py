from datetime import datetime
from pydantic import BaseModel, Field


class VisitLooseSurveyCreate(BaseModel):
    SellsLoose: bool = False
    ProductsJson: str | None = Field(None, max_length=2000)
    ExchangeJson: str | None = Field(None, max_length=2000)


class VisitLooseSurveyRead(VisitLooseSurveyCreate):
    VisitLooseSurveyId: int
    VisitId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
