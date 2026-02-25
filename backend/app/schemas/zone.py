from pydantic import BaseModel


class ZoneBase(BaseModel):
    Name: str


class ZoneCreate(ZoneBase):
    pass


class ZoneUpdate(BaseModel):
    Name: str | None = None


class Zone(ZoneBase):
    ZoneId: int

    class Config:
        from_attributes = True
