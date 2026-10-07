from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class PdvSupplier(Base):
    """Proveedores registrados en cada PDV. Persiste entre visitas (dato del PDV, no de la visita).

    Phone es la clave lógica para identificar al proveedor (puede quedar vacío
    hasta que alguien lo consiga). PdvId NULL = entrada de catálogo de zona:
    proveedor cargado a mano para que los reps lo seleccionen en el censo.
    Products es un JSON array con los nombres de categoría: '["Cigarrillos","Golosinas"]'
    """
    __tablename__ = "PdvSupplier"

    PdvSupplierId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId", ondelete="CASCADE"), nullable=True, index=True)
    ZoneId = Column(Integer, ForeignKey("Zone.ZoneId"), nullable=True, index=True)
    Name = Column(String(120), nullable=False)
    Phone = Column(String(40), nullable=False)
    SupplierTypeId = Column(Integer, ForeignKey("SupplierType.SupplierTypeId"), nullable=True)
    Products = Column(String(500), nullable=True)  # JSON array: '["Cigarrillos","Golosinas"]'
    # Vínculo a la entidad Supplier (0026). NULL = fila legacy (solo texto Name/Phone).
    # Al vincular se rellenan igual las columnas legacy (Name/Phone/ZoneId/tipo/productos).
    SupplierId = Column(Integer, ForeignKey("Supplier.SupplierId"), nullable=True, index=True)
    SupplierSellerId = Column(Integer, ForeignKey("SupplierSeller.SupplierSellerId"), nullable=True)
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
