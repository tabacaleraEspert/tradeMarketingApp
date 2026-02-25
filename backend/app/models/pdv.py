from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric, Date
from sqlalchemy.sql import func
from ..database import Base


class PDV(Base):
    __tablename__ = "PDV"

    PdvId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Code = Column(String(50), unique=True, nullable=True)
    Name = Column(String(160), nullable=False)
    Channel = Column(String(40), nullable=False)
    Address = Column(String(200), nullable=True)
    City = Column(String(80), nullable=True)
    ZoneId = Column(Integer, ForeignKey("Zone.ZoneId"), nullable=True)
    DistributorId = Column(Integer, ForeignKey("Distributor.DistributorId"), nullable=True)
    Lat = Column(Numeric(9, 6), nullable=True)
    Lon = Column(Numeric(9, 6), nullable=True)
    ContactName = Column(String(120), nullable=True)
    ContactPhone = Column(String(40), nullable=True)
    DefaultMaterialExternalId = Column(String(50), nullable=True)
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class PdvAssignment(Base):
    __tablename__ = "PdvAssignment"

    PdvId = Column(Integer, ForeignKey("PDV.PdvId"), primary_key=True)
    UserId = Column(Integer, ForeignKey("User.UserId"), primary_key=True)
    AssignmentRole = Column(String(20), primary_key=True)
    StartsOn = Column(Date, primary_key=True, nullable=False)
    EndsOn = Column(Date, nullable=True)
