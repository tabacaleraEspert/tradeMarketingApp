from pydantic import BaseModel


class DistributorBase(BaseModel):
    Name: str
    Phone: str | None = None
    DistributorType: str | None = None  # Distribuidor / Mayorista / Intermediario
    SupplierSource: str | None = None   # De dónde se abastece
    IsActive: bool = True


class DistributorCreate(DistributorBase):
    pass


class DistributorUpdate(BaseModel):
    Name: str | None = None
    Phone: str | None = None
    DistributorType: str | None = None
    SupplierSource: str | None = None
    IsActive: bool | None = None


class Distributor(DistributorBase):
    DistributorId: int

    class Config:
        from_attributes = True
