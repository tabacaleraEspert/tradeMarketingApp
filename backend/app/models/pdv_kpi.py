from sqlalchemy import Column, Integer, Date, Numeric, ForeignKey
from ..database import Base


class PdvKpiSnapshot(Base):
    __tablename__ = "PdvKpiSnapshot"

    PdvId = Column(Integer, ForeignKey("PDV.PdvId"), primary_key=True)
    AsOfDate = Column(Date, primary_key=True, nullable=False)
    CompliancePct = Column(Numeric(5, 2), nullable=False)
    VisitsCount = Column(Integer, nullable=False)
    IncidentsOpen = Column(Integer, nullable=False)
    LastVisitDate = Column(Date, nullable=True)
