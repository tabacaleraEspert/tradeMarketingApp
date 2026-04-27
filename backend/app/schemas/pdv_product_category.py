from datetime import datetime
from pydantic import BaseModel, Field


VALID_CATEGORIES = [
    "Cigarrillos", "Tabacos", "Vapers",
    "Pouches de nicotina", "Papelillos", "Accesorios",
]
VALID_STATUSES = ["trabaja", "no_trabaja", "trabajaba", "dejo_de_trabajar"]


class PdvProductCategoryBase(BaseModel):
    Category: str = Field(..., max_length=40)
    Status: str = Field("no_trabaja", max_length=30)


class PdvProductCategoryCreate(PdvProductCategoryBase):
    PdvId: int


class PdvProductCategoryUpdate(BaseModel):
    Status: str = Field(..., max_length=30)


class PdvProductCategoryBulk(BaseModel):
    """Bulk upsert: set all categories for a PDV at once."""
    categories: list[PdvProductCategoryBase]


class PdvProductCategory(PdvProductCategoryBase):
    PdvProductCategoryId: int
    PdvId: int
    UpdatedAt: datetime

    class Config:
        from_attributes = True
