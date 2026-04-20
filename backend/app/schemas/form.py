from datetime import datetime
from pydantic import BaseModel


class FormBase(BaseModel):
    Name: str
    Channel: str | None = None
    Version: int
    IsActive: bool = True
    Frequency: str | None = None
    FrequencyConfig: str | None = None


class FormCreate(FormBase):
    CreatedByUserId: int | None = None


class FormUpdate(BaseModel):
    Name: str | None = None
    Channel: str | None = None
    Version: int | None = None
    IsActive: bool | None = None
    Frequency: str | None = None
    FrequencyConfig: str | None = None


class Form(FormBase):
    FormId: int
    CreatedByUserId: int | None = None
    CreatedAt: datetime

    class Config:
        from_attributes = True


class FormQuestionBase(BaseModel):
    FormId: int
    FormVersion: int
    SortOrder: int
    KeyName: str
    Label: str
    QType: str
    IsRequired: bool = False
    RulesJson: str | None = None


class FormQuestionCreate(BaseModel):
    FormVersion: int | None = None  # usa la versión del formulario si no se indica
    SortOrder: int
    KeyName: str
    Label: str
    QType: str
    IsRequired: bool = False
    RulesJson: str | None = None


class FormQuestionUpdate(BaseModel):
    SortOrder: int | None = None
    Label: str | None = None
    QType: str | None = None
    IsRequired: bool | None = None
    RulesJson: str | None = None


class FormQuestion(FormQuestionBase):
    QuestionId: int

    class Config:
        from_attributes = True


class FormOptionBase(BaseModel):
    QuestionId: int
    Value: str
    Label: str
    SortOrder: int
    ImageUrl: str | None = None


class FormOptionCreate(FormOptionBase):
    pass


class FormOptionUpdate(BaseModel):
    Value: str | None = None
    Label: str | None = None
    SortOrder: int | None = None
    ImageUrl: str | None = None


class FormOption(FormOptionBase):
    OptionId: int

    class Config:
        from_attributes = True
