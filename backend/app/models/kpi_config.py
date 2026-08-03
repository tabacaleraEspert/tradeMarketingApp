from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from ..database import Base


class KpiConfig(Base):
    """Peso y meta de un KPI, por alcance (global/zone/user) y vigencia."""
    __tablename__ = "KpiConfig"
    __table_args__ = (
        Index("ix_kpiconfig_scope_validfrom", "ScopeType", "ScopeId", "ValidFrom"),
    )

    KpiConfigId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    KpiDefinitionId = Column(Integer, ForeignKey("KpiDefinition.KpiDefinitionId"), nullable=False, index=True)
    Weight = Column(Integer, nullable=False)  # %
    Target = Column(Numeric(5, 2), nullable=False)  # %
    ScopeType = Column(String(10), nullable=False)  # global, zone, user
    ScopeId = Column(Integer, nullable=True)  # ZoneId o UserId según ScopeType
    ValidFrom = Column(Date, nullable=False)
    ValidTo = Column(Date, nullable=True)
    CreatedByUserId = Column(Integer, ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True, index=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
