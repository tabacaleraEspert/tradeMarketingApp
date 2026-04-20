from sqlalchemy import Column, Integer, String, Date, DateTime, Boolean
from sqlalchemy.sql import func
from ..database import Base


class Holiday(Base):
    """Feriados nacionales / no laborables.

    Cargados manualmente por admin (o vía seed). Cuando se planifica un RouteDay
    en una fecha que coincide con un Holiday, el frontend muestra un warning para
    que el admin decida si lo dejar igual.
    """
    __tablename__ = "Holiday"

    HolidayId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Date = Column(Date, unique=True, nullable=False, index=True)
    Name = Column(String(120), nullable=False)
    # "national" / "regional" / "company" — opcional
    Kind = Column(String(40), nullable=True)
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
