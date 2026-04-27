from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from ..database import Base


class AppSetting(Base):
    """Configuración global de la app (key-value)."""
    __tablename__ = "AppSetting"

    Key = Column(String(80), primary_key=True)
    Value = Column(String(500), nullable=False)
    Description = Column(String(200), nullable=True)
    UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
