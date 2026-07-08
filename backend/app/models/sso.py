from sqlalchemy import Column, String, DateTime
from sqlalchemy.sql import func
from ..database import Base


class SsoUsedJti(Base):
    """jti de tickets SSO ya consumidos (un solo uso). Los tickets viven ~60s,
    así que la tabla se auto-limpia en cada llamada a /auth/sso."""
    __tablename__ = "SsoUsedJti"

    Jti = Column(String(64), primary_key=True)
    ExpiresAt = Column(DateTime, nullable=False)
    UsedAt = Column(DateTime, server_default=func.now(), nullable=False)
