from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from ..database import Base


class SupplierProductType(Base):
    """Categorías de producto que trabajan los proveedores (Cigarrillos, Vapes, Golosinas, etc.)."""
    __tablename__ = "SupplierProductType"

    SupplierProductTypeId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(80), nullable=False)
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
