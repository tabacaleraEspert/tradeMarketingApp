from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.sql import func

from ..database import Base


class BehaviorReportSubscription(Base):
    """Destinatario del reporte de comportamiento por mail (semanal / mensual).

    Qué trades recibe (`Scope`):
      - `all`    → todos los vendedores activos.
      - `team`   → el sub-árbol vivo de `ScopeUserId` (entra gente nueva sola).
      - `custom` → la lista de `TradeIds` (JSON `[1, 2, 3]`).

    `AutoCreated`: alta automática para un jefe con vendedores a cargo (se crea
    desactivada; se activa desde el ABM admin). `UserId` es el usuario para el
    que se auto-creó (evita duplicarla en cada sincronización).
    """
    __tablename__ = "BehaviorReportSubscription"

    SubscriptionId = Column(Integer, primary_key=True, autoincrement=True)
    Email = Column(String(256), nullable=False)
    Name = Column(String(120), nullable=False)
    Scope = Column(String(10), nullable=False, default="team")
    ScopeUserId = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    TradeIds = Column(Text, nullable=True)
    WeeklyEnabled = Column(Boolean, nullable=False, default=True)
    MonthlyEnabled = Column(Boolean, nullable=False, default=True)
    IsActive = Column(Boolean, nullable=False, default=False)
    AutoCreated = Column(Boolean, nullable=False, default=False)
    UserId = Column(Integer, ForeignKey("User.UserId"), nullable=True, index=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class BehaviorReport(Base):
    """Un reporte enviado a un destinatario: snapshot del período + token de la
    página pública `/r/<Token>` (vence en `ExpiresAt`). Un solo envío por
    (suscripción, tipo, período); los `test` se pueden repetir."""
    __tablename__ = "BehaviorReport"

    ReportId = Column(Integer, primary_key=True, autoincrement=True)
    Token = Column(String(64), nullable=False, unique=True)
    SubscriptionId = Column(Integer, ForeignKey("BehaviorReportSubscription.SubscriptionId"), nullable=True, index=True)
    Kind = Column(String(10), nullable=False)  # weekly | monthly | test
    PeriodFrom = Column(Date, nullable=False)
    PeriodTo = Column(Date, nullable=False)
    Email = Column(String(256), nullable=False)
    Payload = Column(Text, nullable=False)
    ExpiresAt = Column(DateTime, nullable=False)
    SentAt = Column(DateTime, nullable=True)
    SendError = Column(String(1000), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index(
            "ux_BehaviorReport_period",
            "SubscriptionId", "Kind", "PeriodFrom",
            unique=True,
            mssql_where=text("Kind <> 'test'"),
            sqlite_where=text("Kind <> 'test'"),
        ),
    )
