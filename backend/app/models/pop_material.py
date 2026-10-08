from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.sql import func

from ..database import Base


class PopMaterial(Base):
    """Catálogo de material POP real (artículos MKT-xxxxxx de Bejerman).

    Se sincroniza desde comercial-nuevo-mobiliza (`GET /api/public/material`),
    ver `services/pop_materials.py`. Nunca se borra: un artículo que desaparece
    del origen queda `IsActive=False` (histórico de censos/colocaciones)."""
    __tablename__ = "PopMaterial"

    Code = Column(String(30), primary_key=True)
    Description = Column(String(200), nullable=False)
    Line = Column(String(80), nullable=True)
    Type = Column(String(120), nullable=True)
    Year = Column(Integer, nullable=True)
    PhotoUrl = Column(String(400), nullable=True)
    Stock = Column(Float, nullable=True)
    IsActive = Column(Boolean, nullable=False, default=True)
    SyncedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class VisitPOPPlacement(Base):
    """Colocación de material POP en una visita (acción "pop"): N renglones
    artículo + cantidad. `MaterialCode` sin FK (como VisitPOPItem.MaterialCode):
    el catálogo es una copia sincronizada y no debe bloquear nada."""
    __tablename__ = "VisitPOPPlacement"
    __table_args__ = (CheckConstraint("Quantity >= 1", name="CK_VisitPOPPlacement_Quantity"),)

    VisitPOPPlacementId = Column(Integer, primary_key=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False, index=True)
    MaterialCode = Column(String(30), nullable=True, index=True)
    MaterialName = Column(String(200), nullable=False)
    Quantity = Column(Integer, nullable=False)
    Location = Column(String(200), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
