from sqlalchemy import Column, Integer, String, Boolean
from ..database import Base


class KpiDefinition(Base):
    """Los 5 KPIs de la variable mensual del tablero TMR. Alta de un KPI = desarrollo, no UI."""
    __tablename__ = "KpiDefinition"

    KpiDefinitionId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    KpiKey = Column(String(40), unique=True, nullable=False)  # cobertura_skus, efectividad_visitas, ...
    Name = Column(String(120), nullable=False)
    Description = Column(String(500), nullable=True)
    IsActive = Column(Boolean, default=True, nullable=False)
