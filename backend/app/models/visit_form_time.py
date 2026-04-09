from sqlalchemy import Column, Integer, ForeignKey, DateTime
from sqlalchemy.sql import func
from ..database import Base


class VisitFormTime(Base):
    """Tiempo acumulado (segundos) que el TM Rep invirtió en cada formulario dentro de una visita."""
    __tablename__ = "VisitFormTime"

    VisitFormTimeId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId"), nullable=False)
    FormId = Column(Integer, ForeignKey("Form.FormId"), nullable=False)
    ElapsedSeconds = Column(Integer, default=0, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
