from datetime import datetime
from pydantic import BaseModel, Field


class VisitPOPItemBase(BaseModel):
    MaterialType: str = Field(..., max_length=20)  # primario / secundario
    # Vacío solo si viene MaterialCode (se completa con la descripción del catálogo).
    # Hasta 200 (descripción del catálogo); se recorta a 80 (columna) en resolve_item_names.
    MaterialName: str = Field("", max_length=200)
    Company: str | None = Field(None, max_length=80)
    Present: bool = False
    HasPrice: bool | None = None
    # Artículo real del catálogo (PopMaterial.Code). Opcional: payloads viejos sin él siguen andando.
    MaterialCode: str | None = Field(None, max_length=30)


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
