from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class MarketNews(Base):
    """Novedades de mercado registradas durante una visita (paso 12 del diagrama)."""
    __tablename__ = "MarketNews"

    MarketNewsId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId"), nullable=False)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId", ondelete="CASCADE"), nullable=False)
    Tags = Column(String(200), nullable=True)    # comma-separated: precio,producto,competencia,canal,otros
    Notes = Column(String(1000), nullable=False)
    CreatedBy = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
