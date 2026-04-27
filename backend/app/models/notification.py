from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from ..database import Base


class Notification(Base):
    """Notificaciones creadas por Admin, visibles para Trade Rep (como incidencias)."""
    __tablename__ = "Notification"

    NotificationId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Title = Column(String(120), nullable=False)
    Message = Column(String(500), nullable=False)
    Type = Column(String(30), default="info", nullable=False)  # info, warning, urgent
    Priority = Column(Integer, default=2, nullable=False)  # 1=high, 2=medium, 3=low
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    CreatedBy = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    # Si es null, es global. Si tiene valor, solo la ve ese usuario (y admins).
    TargetUserId = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    ExpiresAt = Column(DateTime(timezone=True), nullable=True)
