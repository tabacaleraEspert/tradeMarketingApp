from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class ScoringCoverageRule(Base):
    """Mínimos de SKUs por marca y nivel para calificar la cobertura de un PDV (KPI 1)."""
    __tablename__ = "ScoringCoverageRule"

    RuleId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Brand = Column(String(80), nullable=False)
    # ProductIds del catálogo que componen la marca. NULL = el motor matchea por
    # prefijo de nombre del producto (fuera del scope de esta tarea).
    ProductGroupJson = Column(String, nullable=True)
    Level = Column(String(20), nullable=False)  # excelente, muy_bueno, bueno, regular, no_cuenta
    MinSkus = Column(Integer, nullable=False)
    ScopeType = Column(String(10), nullable=False)
    ScopeId = Column(Integer, nullable=True)
    ValidFrom = Column(Date, nullable=False)
    ValidTo = Column(Date, nullable=True)
    CreatedByUserId = Column(Integer, ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True, index=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
