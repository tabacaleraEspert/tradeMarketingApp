from sqlalchemy import Column, Integer, String, Boolean
from ..database import Base


class Distributor(Base):
    __tablename__ = "Distributor"

    DistributorId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(160), unique=True, nullable=False)
    IsActive = Column(Boolean, default=True, nullable=False)
