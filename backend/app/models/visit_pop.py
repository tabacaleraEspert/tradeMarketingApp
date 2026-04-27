from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class VisitPOPItem(Base):
    """Censo de materiales POP por visita (paso 11).

    Material primario: Cigarrera aérea, Cigarrera de espalda, Pantalla/Display, Otro
    Material secundario: Móvil/Colgante, Stopper, Escalerita, Exhibidor, Afiche, Otro
    """
    __tablename__ = "VisitPOPItem"

    VisitPOPItemId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False, index=True)
    # "primario" / "secundario"
    MaterialType = Column(String(20), nullable=False)
    # Nombre del material (Cigarrera aérea, Stopper, etc.)
    MaterialName = Column(String(80), nullable=False)
    # Empresa: Espert, Massalin, BAT, TABSA, otra
    Company = Column(String(80), nullable=True)
    # Presente en el PDV
    Present = Column(Boolean, nullable=False, default=False)
    # Con precio / Sin precio
    HasPrice = Column(Boolean, nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
