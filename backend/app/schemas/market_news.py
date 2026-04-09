from datetime import datetime
from pydantic import BaseModel


class MarketNewsBase(BaseModel):
    Tags: str | None = None        # comma-separated: precio,producto,competencia,canal,otros
    Notes: str


class MarketNewsCreate(MarketNewsBase):
    CreatedBy: int | None = None


class MarketNewsUpdate(BaseModel):
    Tags: str | None = None
    Notes: str | None = None


class MarketNews(MarketNewsBase):
    MarketNewsId: int
    VisitId: int
    PdvId: int
    CreatedBy: int | None = None
    CreatedAt: datetime

    class Config:
        from_attributes = True
