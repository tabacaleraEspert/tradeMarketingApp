from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class VisitAction(Base):
    """Acciones de ejecución realizadas durante una visita (11a-11e del diagrama)."""
    __tablename__ = "VisitAction"

    VisitActionId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId"), nullable=False)
    ActionType = Column(String(30), nullable=False)  # cobertura, pop, canje_sueltos, promo, otra
    Description = Column(String(500), nullable=True)
    DetailsJson = Column(String, nullable=True)       # datos estructurados por tipo
    PhotoRequired = Column(Boolean, default=True, nullable=False)
    PhotoTaken = Column(Boolean, default=False, nullable=False)
    IsMandatory = Column(Boolean, default=False, nullable=False)
    MandatoryActivityId = Column(Integer, ForeignKey("MandatoryActivity.MandatoryActivityId"), nullable=True)
    Status = Column(String(20), default="PENDING", nullable=False)  # PENDING, DONE, BACKLOG
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
