from sqlalchemy import Column, Integer, String
from ..database import Base


class Zone(Base):
    __tablename__ = "Zone"

    ZoneId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(80), unique=True, nullable=False)
