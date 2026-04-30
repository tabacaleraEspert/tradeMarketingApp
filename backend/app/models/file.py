from sqlalchemy import Column, Integer, String, DateTime, BigInteger, Numeric
from sqlalchemy.sql import func
from ..database import Base


class File(Base):
    __tablename__ = "File"

    FileId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    BlobKey = Column(String(300), unique=True, nullable=False)
    OriginalName = Column(String(300), nullable=False, default="photo.jpg")
    StorageUrl = Column(String(600), nullable=False, default="")
    Url = Column(String(600), nullable=True)
    ContentType = Column(String(80), nullable=True)
    SizeBytes = Column(BigInteger, nullable=True)
    HashSha256 = Column(String(64), nullable=True)
    TakenAt = Column(DateTime(timezone=True), nullable=True)
    Lat = Column(Numeric(9, 6), nullable=True)
    Lon = Column(Numeric(9, 6), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
