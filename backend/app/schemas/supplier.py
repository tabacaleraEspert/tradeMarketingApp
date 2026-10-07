from pydantic import BaseModel, Field


class SupplierSellerOut(BaseModel):
    SupplierSellerId: int
    Name: str
    Phone: str | None = None
    IsActive: bool


class SupplierOut(BaseModel):
    SupplierId: int
    ZoneId: int | None = None
    ZoneName: str | None = None
    Name: str
    SupplierTypeId: int | None = None
    SupplierTypeName: str | None = None
    Products: list[str] | None = None
    IsActive: bool
    PdvCount: int = 0
    Sellers: list[SupplierSellerOut] = []


class SupplierCreate(BaseModel):
    ZoneId: int | None = None
    Name: str = Field(..., min_length=1, max_length=120)
    SupplierTypeId: int | None = None
    Products: list[str] | None = None


class SupplierUpdate(BaseModel):
    Name: str | None = Field(None, min_length=1, max_length=120)
    ZoneId: int | None = None
    SupplierTypeId: int | None = None
    Products: list[str] | None = None
    IsActive: bool | None = None


class SellerCreate(BaseModel):
    Name: str = Field(..., min_length=1, max_length=120)
    Phone: str | None = Field(None, max_length=40)


class SellerUpdate(BaseModel):
    Name: str | None = Field(None, min_length=1, max_length=120)
    Phone: str | None = Field(None, max_length=40)
    IsActive: bool | None = None


class SupplierMerge(BaseModel):
    SourceSupplierIds: list[int] = Field(..., min_length=1)


class NewSupplierIn(BaseModel):
    Name: str = Field(..., min_length=1, max_length=120)
    SupplierTypeId: int | None = None
    Products: list[str] | None = None


class PdvSupplierLink(BaseModel):
    SupplierId: int | None = None
    NewSupplier: NewSupplierIn | None = None
    SupplierSellerId: int | None = None
    NewSeller: SellerCreate | None = None
