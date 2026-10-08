from datetime import datetime

from pydantic import BaseModel, Field


class PopMaterialRead(BaseModel):
    Code: str
    Description: str
    Line: str | None = None
    Type: str | None = None
    Year: int | None = None
    PhotoUrl: str | None = None
    Stock: float | None = None
    IsActive: bool

    class Config:
        from_attributes = True


class PopSyncResult(BaseModel):
    Created: int
    Updated: int
    Deactivated: int
    Total: int


class VisitPOPPlacementBase(BaseModel):
    # Artículo del catálogo (PopMaterial.Code). Si viene y MaterialName está
    # vacío, el backend completa MaterialName con la descripción del artículo.
    MaterialCode: str | None = Field(None, max_length=30)
    MaterialName: str = Field("", max_length=200)
    Quantity: int = Field(..., ge=1)
    Location: str | None = Field(None, max_length=200)


class VisitPOPPlacementBulk(BaseModel):
    """Bulk save: todas las colocaciones de la visita (reemplaza las previas)."""
    items: list[VisitPOPPlacementBase] = Field(..., max_length=50)


class VisitPOPPlacementRead(VisitPOPPlacementBase):
    VisitPOPPlacementId: int
    VisitId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
