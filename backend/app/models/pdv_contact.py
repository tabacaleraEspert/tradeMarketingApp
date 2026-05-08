from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Date
from sqlalchemy.sql import func
from ..database import Base


class PdvContact(Base):
    """Contactos del punto de venta (múltiples por PDV, con cumpleaños)."""
    __tablename__ = "PdvContact"

    PdvContactId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId", ondelete="CASCADE"), nullable=False, index=True)
    ContactName = Column(String(120), nullable=False)
    ContactPhone = Column(String(40), nullable=True)
    ContactRole = Column(String(40), nullable=True)       # dueño, empleado, encargado
    DecisionPower = Column(String(20), nullable=True)     # alto, medio, bajo
    Birthday = Column(Date, nullable=True)
    # Caja libre de observaciones generales (operativas)
    Notes = Column(String(1000), nullable=True)
    # Perfil del contacto: preferencias, gustos, qué evitar (no hablar de política, hincha de, etc)
    ProfileNotes = Column(String(1000), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
