from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class UserVacation(Base):
    """Período de vacaciones / licencia de un usuario.

    Cuando el rep está de vacaciones, los días dentro del rango [FromDate, ToDate]
    NO cuentan para el cálculo de cumplimiento (no penaliza por no visitar).
    El admin los carga desde el panel.
    """
    __tablename__ = "UserVacation"

    UserVacationId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    UserId = Column(Integer, ForeignKey("User.UserId"), nullable=False, index=True)
    FromDate = Column(Date, nullable=False)
    ToDate = Column(Date, nullable=False)
    Reason = Column(String(200), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
