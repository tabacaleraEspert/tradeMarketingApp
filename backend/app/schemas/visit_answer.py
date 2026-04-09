from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class VisitAnswerBase(BaseModel):
    QuestionId: int
    ValueText: str | None = None
    ValueNumber: Decimal | None = None
    ValueBool: bool | None = None
    OptionId: int | None = None
    ValueJson: str | None = None


class VisitAnswerCreate(VisitAnswerBase):
    pass


class VisitAnswerBulk(BaseModel):
    answers: list[VisitAnswerCreate]


class VisitAnswer(VisitAnswerBase):
    AnswerId: int
    VisitId: int
    CreatedAt: datetime

    class Config:
        from_attributes = True
