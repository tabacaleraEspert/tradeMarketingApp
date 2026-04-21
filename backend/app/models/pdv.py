from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric, Date
from sqlalchemy.sql import func
from ..database import Base


class PDV(Base):
    __tablename__ = "PDV"

    PdvId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Code = Column(String(50), unique=True, nullable=True)
    Name = Column(String(160), nullable=False)
    BusinessName = Column(String(200), nullable=True)  # Razón social legal (opcional)
    Channel = Column(String(40), nullable=True)  # Legacy, usar ChannelId
    ChannelId = Column(Integer, ForeignKey("Channel.ChannelId"), nullable=True)
    SubChannelId = Column(Integer, ForeignKey("SubChannel.SubChannelId"), nullable=True)
    Address = Column(String(200), nullable=True)
    City = Column(String(80), nullable=True)
    ZoneId = Column(Integer, ForeignKey("Zone.ZoneId"), nullable=True)
    DistributorId = Column(Integer, ForeignKey("Distributor.DistributorId"), nullable=True)
    Lat = Column(Numeric(9, 6), nullable=True)
    Lon = Column(Numeric(9, 6), nullable=True)
    ContactName = Column(String(120), nullable=True)  # Legacy, usar PdvContact
    ContactPhone = Column(String(40), nullable=True)  # Legacy
    # Horarios de atención (formato HH:MM, ayuda al armado de la secuencia de visitas)
    OpeningTime = Column(String(5), nullable=True)
    ClosingTime = Column(String(5), nullable=True)
    # Día de la semana fijo de visita: 0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb. Null = sin día fijo
    VisitDay = Column(Integer, nullable=True)
    DefaultMaterialExternalId = Column(String(50), nullable=True)
    # Trade Marketer asignado (heredado automáticamente al incluirse en una ruta)
    AssignedUserId = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    # Franjas horarias múltiples (JSON): [{"from":"08:00","to":"13:00","label":"Mañana"},...]
    TimeSlotsJson = Column(String, nullable=True)
    # Categorización: qué nos permite hacer el PDV (JSON de flags)
    # {"pop": true, "sueltos": true, "acciones": true, "exhibidor": false, "cigarrera": true}
    AllowsJson = Column(String, nullable=True)
    # Categoría derivada: A (todo), B (parcial), C (mínimo) — calculada por el frontend o un report
    Category = Column(String(1), nullable=True)
    IsActive = Column(Boolean, default=True, nullable=False)
    # Si se desactiva, registrar la razón y la fecha sugerida para reactivar (60 días después por default)
    InactiveReason = Column(String(500), nullable=True)
    InactiveSince = Column(DateTime(timezone=True), nullable=True)
    ReactivateOn = Column(Date, nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class PdvDistributor(Base):
    """Relación muchos-a-muchos entre PDV y Distribuidor."""
    __tablename__ = "PdvDistributor"

    PdvDistributorId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId"), nullable=False)
    DistributorId = Column(Integer, ForeignKey("Distributor.DistributorId"), nullable=False)


class PdvAssignment(Base):
    __tablename__ = "PdvAssignment"

    PdvId = Column(Integer, ForeignKey("PDV.PdvId"), primary_key=True)
    UserId = Column(Integer, ForeignKey("User.UserId"), primary_key=True)
    AssignmentRole = Column(String(20), primary_key=True)
    StartsOn = Column(Date, primary_key=True, nullable=False)
    EndsOn = Column(Date, nullable=True)
