from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from ..database import Base


class Product(Base):
    """Catálogo maestro de productos (cigarrillos, tabacos, vapers, etc.)."""
    __tablename__ = "Product"

    ProductId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(120), nullable=False)
    # Cigarrillos, Tabacos, Vapers, Pouches de nicotina, Papelillos, Accesorios
    Category = Column(String(40), nullable=False, index=True)
    # Espert, Real Tabacalera, Massalin, BAT, Tabacalera Sarandí, etc. Null = genérico
    Manufacturer = Column(String(80), nullable=True)
    IsOwn = Column(Boolean, default=False, nullable=False)  # True = producto Espert
    # Cigarrillo capsulado. No se infiere del nombre (Espert usa el sabor,
    # la competencia "Caps" o colores de fantasía); backfill en migración 0022.
    IsCapsule = Column(Boolean, default=False, nullable=False)
    IsActive = Column(Boolean, default=True, nullable=False)
    SortOrder = Column(Integer, default=0, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
