from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class MandatoryActivity(Base):
    """Template de actividad obligatoria. Admin las configura, se auto-crean al abrir visita."""
    __tablename__ = "MandatoryActivity"

    MandatoryActivityId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(120), nullable=False)
    ActionType = Column(String(30), nullable=False)  # cobertura, pop, canje_sueltos, promo, otra
    Description = Column(String(500), nullable=True)
    DetailsJson = Column(String, nullable=True)  # pre-filled details template
    PhotoRequired = Column(Boolean, default=True, nullable=False)

    # Scope: global (null), by channel, or by route
    ChannelId = Column(Integer, ForeignKey("Channel.ChannelId"), nullable=True)
    RouteId = Column(Integer, ForeignKey("Route.RouteId"), nullable=True)

    # Formulario opcional vinculado a la acción (datos a completar al ejecutarla)
    FormId = Column(Integer, ForeignKey("Form.FormId"), nullable=True)

    # Vigencia temporal (null = sin límite)
    ValidFrom = Column(Date, nullable=True)
    ValidTo = Column(Date, nullable=True)

    # Quién la creó (para filtrar por jerarquía)
    CreatedByUserId = Column(Integer, ForeignKey("User.UserId"), nullable=True)

    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
