from datetime import datetime
from pydantic import BaseModel, Field


class VisitPOPItemBase(BaseModel):
    MaterialType: str = Field(..., max_length=20)  # primario / secundario
    MaterialName: str = Field(..., max_length=80)
    Company: str | None = Field(None, max_length=80)
    Present: bool = False
    HasPrice: bool | None = None


class VisitPOPItemCreate(VisitPOPItemBase):
    pass


class VisitPOPBulk(BaseModel):
    """Bulk save: all POP items for a visit (replaces previous)."""
    items: list[VisitPOPItemBase] = Field(..., max_length=50)


class VisitPOPItemRead(VisitPOPItemBase):
    VisitPOPItemId: int
    VisitId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
