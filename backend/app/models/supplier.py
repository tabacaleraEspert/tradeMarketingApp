from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class Supplier(Base):
    """Proveedor de una zona (entidad propia; antes era solo texto en PdvSupplier).

    Tipo y productos son del proveedor. Los PDVs se vinculan vía
    PdvSupplier.SupplierId (+ vendedor opcional SupplierSellerId).
    Products: JSON array igual que PdvSupplier ('["Cigarrillos","Golosinas"]').
    """
    __tablename__ = "Supplier"

    SupplierId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    ZoneId = Column(Integer, ForeignKey("Zone.ZoneId"), nullable=True, index=True)
    Name = Column(String(120), nullable=False)
    SupplierTypeId = Column(Integer, ForeignKey("SupplierType.SupplierTypeId"), nullable=True)
    Products = Column(String(500), nullable=True)
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedByUserId = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class SupplierSeller(Base):
    """Vendedor (preventista) de un proveedor. Nombre obligatorio, teléfono opcional."""
    __tablename__ = "SupplierSeller"

    SupplierSellerId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    SupplierId = Column(Integer, ForeignKey("Supplier.SupplierId", ondelete="CASCADE"), nullable=False, index=True)
    Name = Column(String(120), nullable=False)
    Phone = Column(String(40), nullable=True)
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
