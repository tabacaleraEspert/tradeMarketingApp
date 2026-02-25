from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class Device(Base):
    __tablename__ = "Device"

    DeviceId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    UserId = Column(Integer, ForeignKey("User.UserId"), nullable=False)
    DeviceKey = Column(String(120), unique=True, nullable=False)
    Platform = Column(String(20), nullable=False)
    AppVersion = Column(String(30), nullable=True)
    LastSeenAt = Column(DateTime(timezone=True), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SyncLog(Base):
    __tablename__ = "SyncLog"

    SyncLogId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    DeviceId = Column(Integer, ForeignKey("Device.DeviceId"), nullable=False)
    StartedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    FinishedAt = Column(DateTime(timezone=True), nullable=True)
    Result = Column(String(20), default="OK", nullable=False)
    ErrorText = Column(String(2000), nullable=True)


class DeviceState(Base):
    __tablename__ = "DeviceState"

    DeviceId = Column(Integer, ForeignKey("Device.DeviceId"), primary_key=True)
    LastSyncAt = Column(DateTime(timezone=True), nullable=True)
    PendingForms = Column(Integer, default=0, nullable=False)
    PendingPhotos = Column(Integer, default=0, nullable=False)
    UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
