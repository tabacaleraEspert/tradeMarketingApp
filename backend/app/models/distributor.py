from sqlalchemy import Column, Integer, String, Boolean
from ..database import Base


class Distributor(Base):
    __tablename__ = "Distributor"

    DistributorId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(160), unique=True, nullable=False)
    Phone = Column(String(40), nullable=True)
    # Distribuidor / Mayorista / Intermediario
    DistributorType = Column(String(40), nullable=True)
    # De dónde se abastece (texto libre, ej "directo de fábrica", "mayorista X")
    SupplierSource = Column(String(200), nullable=True)
    IsActive = Column(Boolean, default=True, nullable=False)
