from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from ..database import Base


class KpiMonthlySnapshot(Base):
    """Resultado congelado de un KPI para un usuario/mes (impacta compensación, no se recalcula)."""
    __tablename__ = "KpiMonthlySnapshot"
    __table_args__ = (
        UniqueConstraint("UserId", "Year", "Month", "KpiDefinitionId", name="uq_kpimonthlysnapshot_user_year_month_kpi"),
    )

    SnapshotId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    UserId = Column(Integer, ForeignKey("User.UserId"), nullable=False, index=True)
    Year = Column(Integer, nullable=False)
    Month = Column(Integer, nullable=False)
    KpiDefinitionId = Column(Integer, ForeignKey("KpiDefinition.KpiDefinitionId"), nullable=False, index=True)
    Actual = Column(Numeric(5, 2), nullable=False)
    Target = Column(Numeric(5, 2), nullable=False)
    Weight = Column(Integer, nullable=False)
    ScopeApplied = Column(String(10), nullable=False)  # global, zone, user — el scope resuelto para este cálculo
    Achieved = Column(Boolean, nullable=False)
    Numerator = Column(Integer, nullable=False)
    Denominator = Column(Integer, nullable=False)
    FrozenAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
