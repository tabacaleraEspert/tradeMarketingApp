from datetime import datetime
from pydantic import BaseModel, Field


class ProductBase(BaseModel):
    Name: str = Field(..., max_length=120)
    Category: str = Field(..., max_length=40)
    Manufacturer: str | None = Field(None, max_length=80)
    IsOwn: bool = False
    IsActive: bool = True
    SortOrder: int = 0


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    Name: str | None = Field(None, max_length=120)
    Category: str | None = Field(None, max_length=40)
    Manufacturer: str | None = Field(None, max_length=80)
    IsOwn: bool | None = None
    IsActive: bool | None = None
    SortOrder: int | None = None


class Product(ProductBase):
    ProductId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
