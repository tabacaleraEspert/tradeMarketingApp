from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class Form(Base):
    __tablename__ = "Form"

    FormId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(120), nullable=False)
    Channel = Column(String(40), nullable=True)
    Version = Column(Integer, nullable=False)
    IsActive = Column(Boolean, default=True, nullable=False)
    # Frecuencia: "always" (hasta nuevo aviso), "weekly", "biweekly", "monthly", "every_x_days", "specific_days", null
    Frequency = Column(String(40), nullable=True)
    # Config JSON para frecuencia (interval, days, startDate, etc.)
    FrequencyConfig = Column(String(200), nullable=True)
    # Quién creó el formulario (null = legacy/admin)
    CreatedByUserId = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class FormQuestion(Base):
    __tablename__ = "FormQuestion"

    QuestionId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    FormId = Column(Integer, ForeignKey("Form.FormId"), nullable=False)
    FormVersion = Column(Integer, nullable=False)
    SortOrder = Column(Integer, nullable=False)
    KeyName = Column(String(80), nullable=False)
    Label = Column(String(200), nullable=False)
    QType = Column(String(20), nullable=False)
    IsRequired = Column(Boolean, default=False, nullable=False)
    RulesJson = Column(String, nullable=True)


class FormOption(Base):
    __tablename__ = "FormOption"

    OptionId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    QuestionId = Column(Integer, ForeignKey("FormQuestion.QuestionId"), nullable=False)
    Value = Column(String(120), nullable=False)
    Label = Column(String(200), nullable=False)
    SortOrder = Column(Integer, nullable=False)
    ImageUrl = Column(String(500), nullable=True)
