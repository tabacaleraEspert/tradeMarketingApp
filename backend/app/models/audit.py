from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, BigInteger
from sqlalchemy.sql import func
from ..database import Base


class AuditEvent(Base):
    __tablename__ = "AuditEvent"

    AuditEventId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    UserId = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    DeviceId = Column(Integer, ForeignKey("Device.DeviceId"), nullable=True)
    Entity = Column(String(60), nullable=False)
    EntityId = Column(String(60), nullable=False)
    Action = Column(String(20), nullable=False)
    PayloadJson = Column(String, nullable=True)
