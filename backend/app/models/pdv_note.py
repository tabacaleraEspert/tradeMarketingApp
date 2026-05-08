from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class PdvNote(Base):
    """Notas / TODOs que un TM Rep deja en un PDV para futuras visitas.

    Cuando se abre el detalle del PDV o se hace check-in, las notas con
    `IsResolved=False` se muestran al rep para que sepa qué hacer.
    """
    __tablename__ = "PdvNote"

    PdvNoteId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId", ondelete="CASCADE"), nullable=False, index=True)
    Content = Column(String(2000), nullable=False)
    CreatedByUserId = Column(Integer, ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True, index=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId", ondelete="SET NULL"), nullable=True, index=True)
    IsResolved = Column(Boolean, default=False, nullable=False)
    ResolvedByUserId = Column(Integer, ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True, index=True)
    ResolvedAt = Column(DateTime(timezone=True), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
