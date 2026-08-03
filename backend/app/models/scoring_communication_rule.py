from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class ScoringCommunicationRule(Base):
    """Materiales POP requeridos por nivel para calificar la comunicación de un PDV (KPI 4)."""
    __tablename__ = "ScoringCommunicationRule"

    RuleId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    MaterialType = Column(String(40), nullable=False)
    Level = Column(String(20), nullable=False)  # excelente, muy_bueno, bueno, regular
    Required = Column(Boolean, nullable=True)
    MinElements = Column(Integer, nullable=True)  # cantidad de elementos requeridos por nivel (filas de total)
    ScopeType = Column(String(10), nullable=False)
    ScopeId = Column(Integer, nullable=True)
    ValidFrom = Column(Date, nullable=False)
    ValidTo = Column(Date, nullable=True)
    CreatedByUserId = Column(Integer, ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True, index=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
