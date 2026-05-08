from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric
from sqlalchemy.sql import func
from ..database import Base


class VisitCoverage(Base):
    """Relevamiento de cobertura y precios por producto (paso 10).

    Se completa en cada visita. Pre-carga los valores de la visita anterior.
    """
    __tablename__ = "VisitCoverage"

    VisitCoverageId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False, index=True)
    ProductId = Column(Integer, ForeignKey("Product.ProductId"), nullable=False, index=True)
    # "Lo trabaja" — Sí / No
    Works = Column(Boolean, nullable=False, default=False)
    # Precio al consumidor en pesos (solo si Works=True)
    Price = Column(Numeric(10, 2), nullable=True)
    # Disponibilidad: "disponible" / "quiebre" (solo si Works=True)
    Availability = Column(String(20), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
