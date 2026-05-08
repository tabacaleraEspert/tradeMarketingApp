from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric
from sqlalchemy.sql import func
from ..database import Base


class VisitLooseSurvey(Base):
    """Relevamiento de venta de sueltos (paso 12).

    Registra si el PDV vende cigarrillos sueltos, qué productos y a qué precio.
    ProductsJson: [{"name": "Milenio Red", "price": 150}, ...] (máx. 3)
    ExchangeJson: datos del programa de canje Espert (capsulado/no capsulado).
    """
    __tablename__ = "VisitLooseSurvey"

    VisitLooseSurveyId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    SellsLoose = Column(Boolean, nullable=False, default=False)
    # [{"name": "Milenio Red", "price": 150.0}, ...] (máx 3 productos)
    ProductsJson = Column(String, nullable=True)
    # {"capsulado": {"product": "...", "price": 150, "modality": "5+1", "negotiation": "...", "startDate": "..."},
    #  "no_capsulado": {...}}
    ExchangeJson = Column(String, nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
