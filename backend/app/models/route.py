from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, BigInteger, Date, Time, SmallInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class Route(Base):
    __tablename__ = "Route"

    RouteId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(120), nullable=False)
    ZoneId = Column(Integer, ForeignKey("Zone.ZoneId"), nullable=True, index=True)
    FormId = Column(Integer, ForeignKey("Form.FormId"), nullable=True)  # legacy, usar RouteForm
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Trade Rep crea; Admin puede editar
    CreatedByUserId = Column(Integer, ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True, index=True)
    # Zona Bejerman (Litoral, GBA Sur, GBA Norte, Patagonia)
    BejermanZone = Column(String(80), nullable=True)
    # Frecuencia: every_15_days, weekly, specific_days
    FrequencyType = Column(String(40), nullable=True)
    # JSON: {"days":[1,3,5]} para specific_days (0=Dom, 1=Lun...)
    FrequencyConfig = Column(String(200), nullable=True)
    # Solo visible para Admin
    EstimatedMinutes = Column(Integer, nullable=True)
    # Trade Marketer asignado a esta ruta (persistente)
    AssignedUserId = Column(Integer, ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True, index=True)
    # Indica si el orden de los PDVs fue optimizado (por distancia/tiempo)
    IsOptimized = Column(Boolean, default=False, nullable=False)


class RouteForm(Base):
    """Formularios asignados a una ruta (muchos por ruta)."""
    __tablename__ = "RouteForm"

    RouteId = Column(Integer, ForeignKey("Route.RouteId", ondelete="CASCADE"), primary_key=True)
    FormId = Column(Integer, ForeignKey("Form.FormId", ondelete="CASCADE"), primary_key=True)
    SortOrder = Column(Integer, default=0, nullable=False)

    Form = relationship("Form", lazy="joined")


class RoutePdv(Base):
    __tablename__ = "RoutePdv"

    RouteId = Column(Integer, ForeignKey("Route.RouteId", ondelete="CASCADE"), primary_key=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId", ondelete="CASCADE"), primary_key=True)
    SortOrder = Column(Integer, nullable=False)
    Priority = Column(SmallInteger, default=3, nullable=False)


class RouteDay(Base):
    __tablename__ = "RouteDay"

    RouteDayId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    RouteId = Column(Integer, ForeignKey("Route.RouteId", ondelete="CASCADE"), nullable=False, index=True)
    WorkDate = Column(Date, nullable=False, index=True)
    AssignedUserId = Column(Integer, ForeignKey("User.UserId"), nullable=False, index=True)
    Status = Column(String(20), default="PLANNED", nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RouteDayPdv(Base):
    __tablename__ = "RouteDayPdv"

    RouteDayId = Column(Integer, ForeignKey("RouteDay.RouteDayId", ondelete="CASCADE"), primary_key=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId", ondelete="CASCADE"), primary_key=True)
    PlannedOrder = Column(Integer, nullable=False)
    PlannedWindowFrom = Column(Time, nullable=True)
    PlannedWindowTo = Column(Time, nullable=True)
    Priority = Column(SmallInteger, default=3, nullable=False)
    ExecutionStatus = Column(String(20), default="PENDING", nullable=False)
