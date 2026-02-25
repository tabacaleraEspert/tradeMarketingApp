from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, BigInteger, SmallInteger
from sqlalchemy.sql import func
from ..database import Base


class Incident(Base):
    __tablename__ = "Incident"

    IncidentId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId"), nullable=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId"), nullable=True)
    Type = Column(String(30), nullable=False)
    Status = Column(String(20), default="OPEN", nullable=False)
    Priority = Column(SmallInteger, default=3, nullable=False)
    Notes = Column(String(500), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    CreatedBy = Column(Integer, ForeignKey("User.UserId"), nullable=True)
