from datetime import datetime
from pydantic import BaseModel


class NotificationBase(BaseModel):
    Title: str
    Message: str
    Type: str = "info"
    Priority: int = 2
    IsActive: bool = True
    ExpiresAt: datetime | None = None


class NotificationCreate(NotificationBase):
    CreatedBy: int | None = None
    TargetUserId: int | None = None


class NotificationUpdate(BaseModel):
    Title: str | None = None
    Message: str | None = None
    Type: str | None = None
    Priority: int | None = None
    IsActive: bool | None = None
    ExpiresAt: datetime | None = None


class Notification(NotificationBase):
    NotificationId: int
    CreatedAt: datetime
    CreatedBy: int | None = None
    TargetUserId: int | None = None

    class Config:
        from_attributes = True
