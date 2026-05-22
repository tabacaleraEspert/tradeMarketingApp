from datetime import datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, Field


class VisitCoverageItem(BaseModel):
    ProductId: int | None = None
    Works: bool = False
    Price: Decimal | None = Field(None, ge=0)
    Availability: Literal["disponible", "quiebre"] | None = None
    Puffs: int | None = None
    ProductName: str | None = None  # For custom "Otros" products
    Category: str | None = None     # For custom "Otros" products


class VisitCoverageBulk(BaseModel):
    """Bulk save: all coverage items for a visit at once (replaces previous)."""
    items: list[VisitCoverageItem] = Field(..., max_length=200)


class VisitCoverageRead(VisitCoverageItem):
    VisitCoverageId: int
    VisitId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True


class CoverageDiff(BaseModel):
    """Comparison item: current vs previous visit."""
    ProductId: int
    ProductName: str
    Category: str
    Manufacturer: str | None = None
    Works: bool = False
    Price: Decimal | None = None
    Availability: str | None = None
    Puffs: int | None = None
    HasCurrentData: bool = False
    PrevWorks: bool | None = None
    PrevPrice: Decimal | None = None
    PrevAvailability: str | None = None
    PrevPuffs: int | None = None
