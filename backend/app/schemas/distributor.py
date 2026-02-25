from pydantic import BaseModel


class DistributorBase(BaseModel):
    Name: str
    IsActive: bool = True


class DistributorCreate(DistributorBase):
    pass


class DistributorUpdate(BaseModel):
    Name: str | None = None
    IsActive: bool | None = None


class Distributor(DistributorBase):
    DistributorId: int

    class Config:
        from_attributes = True
