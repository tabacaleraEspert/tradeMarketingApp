from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Date
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class Channel(Base):
    """Canal de venta (ej: Kiosco, Supermercado). Gestionado por admin."""
    __tablename__ = "Channel"

    ChannelId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(80), nullable=False)
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    SubChannels = relationship("SubChannel", back_populates="Channel", cascade="all, delete-orphan")


class SubChannel(Base):
    """Subcanal dependiente de un canal (ej: Tradicional, Cadena). Gestionado por admin."""
    __tablename__ = "SubChannel"

    SubChannelId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    ChannelId = Column(Integer, ForeignKey("Channel.ChannelId"), nullable=False)
    Name = Column(String(80), nullable=False)
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    Channel = relationship("Channel", back_populates="SubChannels")
