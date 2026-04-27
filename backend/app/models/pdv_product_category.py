from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class PdvProductCategory(Base):
    """Categorías de producto trabajadas en cada PDV (paso 9).

    Status: trabaja / no_trabaja / trabajaba / dejo_de_trabajar
    El estado 'dejo_de_trabajar' permite detectar pérdidas de categoría
    entre visitas y activar acciones de recuperación.
    """
    __tablename__ = "PdvProductCategory"

    PdvProductCategoryId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId", ondelete="CASCADE"), nullable=False, index=True)
    # Cigarrillos, Tabacos, Vapers, Pouches de nicotina, Papelillos, Accesorios
    Category = Column(String(40), nullable=False)
    # trabaja / no_trabaja / trabajaba / dejo_de_trabajar
    Status = Column(String(30), default="no_trabaja", nullable=False)
    UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
