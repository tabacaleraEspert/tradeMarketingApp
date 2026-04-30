from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, BigInteger, Numeric
from sqlalchemy.sql import func
from ..database import Base


class Visit(Base):
    __tablename__ = "Visit"

    VisitId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    PdvId = Column(Integer, ForeignKey("PDV.PdvId"), nullable=False, index=True)
    UserId = Column(Integer, ForeignKey("User.UserId"), nullable=False, index=True)
    RouteDayId = Column(Integer, ForeignKey("RouteDay.RouteDayId", ondelete="SET NULL"), nullable=True, index=True)
    Status = Column(String(20), default="OPEN", nullable=False)
    OpenedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ClosedAt = Column(DateTime(timezone=True), nullable=True)
    FormId = Column(Integer, ForeignKey("Form.FormId"), nullable=True)
    FormVersion = Column(Integer, nullable=True)
    FormStatus = Column(String(20), default="DRAFT", nullable=False)
    SubmittedAt = Column(DateTime(timezone=True), nullable=True)
    MaterialExternalId = Column(String(50), nullable=True)
    CloseReason = Column(String(200), nullable=True)


class VisitCheck(Base):
    __tablename__ = "VisitCheck"

    VisitCheckId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False)
    CheckType = Column(String(10), nullable=False)
    Ts = Column(DateTime(timezone=True), nullable=False)
    Lat = Column(Numeric(9, 6), nullable=True)
    Lon = Column(Numeric(9, 6), nullable=True)
    AccuracyMeters = Column(Numeric(8, 2), nullable=True)
    DistanceToPdvM = Column(Numeric(8, 2), nullable=True)
    DeviceId = Column(Integer, ForeignKey("Device.DeviceId"), nullable=True)


class VisitAnswer(Base):
    __tablename__ = "VisitAnswer"

    AnswerId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    VisitId = Column(Integer, ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False)
    QuestionId = Column(Integer, ForeignKey("FormQuestion.QuestionId", ondelete="CASCADE"), nullable=False)
    ValueText = Column(String(4000), nullable=True)
    ValueNumber = Column(Numeric(18, 4), nullable=True)
    ValueBool = Column(Boolean, nullable=True)
    OptionId = Column(Integer, ForeignKey("FormOption.OptionId"), nullable=True)
    ValueJson = Column(String, nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class VisitPhoto(Base):
    __tablename__ = "VisitPhoto"

    VisitId = Column(Integer, ForeignKey("Visit.VisitId", ondelete="CASCADE"), primary_key=True)
    FileId = Column(Integer, ForeignKey("File.FileId", ondelete="CASCADE"), primary_key=True)
    PhotoType = Column(String(100), nullable=False)
    Url = Column(String(600), nullable=False, default="")
    SortOrder = Column(Integer, default=1, nullable=False)
    Notes = Column(String(300), nullable=True)
