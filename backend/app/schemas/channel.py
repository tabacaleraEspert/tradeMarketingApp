from datetime import datetime
from pydantic import BaseModel


class ChannelBase(BaseModel):
    Name: str
    Description: str | None = None
    IsActive: bool = True


class ChannelCreate(ChannelBase):
    pass


class ChannelUpdate(BaseModel):
    Name: str | None = None
    Description: str | None = None
    IsActive: bool | None = None


class Channel(ChannelBase):
    ChannelId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True


class SubChannelBase(BaseModel):
    ChannelId: int
    Name: str
    Description: str | None = None
    SubCategory2: str | None = None
    IsActive: bool = True


class SubChannelCreate(SubChannelBase):
    pass


class SubChannelUpdate(BaseModel):
    ChannelId: int | None = None
    Name: str | None = None
    Description: str | None = None
    SubCategory2: str | None = None
    IsActive: bool | None = None


class SubChannel(SubChannelBase):
    SubChannelId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
