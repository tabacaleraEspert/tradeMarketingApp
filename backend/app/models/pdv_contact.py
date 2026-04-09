from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Date
from sqlalchemy.sql import func
from ..database import Base


class PdvContact(Base):
    """Contactos del punto de venta (múltiples por PDV, con cumpleaños)."""
    __tablename__ = "PdvContact"

    PdvContactId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId"), nullable=False)
    ContactName = Column(String(120), nullable=False)
    ContactPhone = Column(String(40), nullable=True)
    ContactRole = Column(String(40), nullable=True)       # dueño, empleado, encargado
    DecisionPower = Column(String(20), nullable=True)     # alto, medio, bajo
    Birthday = Column(Date, nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
