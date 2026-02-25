from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Form as FormModel, FormQuestion as FormQuestionModel, FormOption as FormOptionModel
from ..schemas.form import (
    Form,
    FormCreate,
    FormUpdate,
    FormQuestion,
    FormQuestionCreate,
    FormQuestionUpdate,
    FormOption,
    FormOptionCreate,
    FormOptionUpdate,
)

router = APIRouter(prefix="/forms", tags=["Formularios"])


# --- Form ---
@router.get("", response_model=list[Form])
def list_forms(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(FormModel).order_by(FormModel.FormId).offset(skip).limit(limit).all()


@router.get("/{form_id}", response_model=Form)
def get_form(form_id: int, db: Session = Depends(get_db)):
    f = db.query(FormModel).filter(FormModel.FormId == form_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    return f


@router.post("", response_model=Form, status_code=201)
def create_form(data: FormCreate, db: Session = Depends(get_db)):
    f = FormModel(
        Name=data.Name,
        Channel=data.Channel,
        Version=data.Version,
        IsActive=data.IsActive,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@router.patch("/{form_id}", response_model=Form)
def update_form(form_id: int, data: FormUpdate, db: Session = Depends(get_db)):
    f = db.query(FormModel).filter(FormModel.FormId == form_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(f, k, v)
    db.commit()
    db.refresh(f)
    return f


@router.delete("/{form_id}", status_code=204)
def delete_form(form_id: int, db: Session = Depends(get_db)):
    f = db.query(FormModel).filter(FormModel.FormId == form_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    db.delete(f)
    db.commit()


# --- FormQuestion ---
@router.get("/{form_id}/questions", response_model=list[FormQuestion])
def list_form_questions(form_id: int, db: Session = Depends(get_db)):
    return db.query(FormQuestionModel).filter(FormQuestionModel.FormId == form_id).order_by(FormQuestionModel.SortOrder).all()


@router.post("/{form_id}/questions", response_model=FormQuestion, status_code=201)
def create_form_question(form_id: int, data: FormQuestionCreate, db: Session = Depends(get_db)):
    form = db.query(FormModel).filter(FormModel.FormId == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    q = FormQuestionModel(
        FormId=form_id,
        FormVersion=data.FormVersion or form.Version,
        SortOrder=data.SortOrder,
        KeyName=data.KeyName,
        Label=data.Label,
        QType=data.QType,
        IsRequired=data.IsRequired,
        RulesJson=data.RulesJson,
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


@router.get("/questions/{question_id}", response_model=FormQuestion)
def get_form_question(question_id: int, db: Session = Depends(get_db)):
    q = db.query(FormQuestionModel).filter(FormQuestionModel.QuestionId == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Pregunta no encontrada")
    return q


@router.patch("/questions/{question_id}", response_model=FormQuestion)
def update_form_question(question_id: int, data: FormQuestionUpdate, db: Session = Depends(get_db)):
    q = db.query(FormQuestionModel).filter(FormQuestionModel.QuestionId == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Pregunta no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(q, k, v)
    db.commit()
    db.refresh(q)
    return q


@router.delete("/questions/{question_id}", status_code=204)
def delete_form_question(question_id: int, db: Session = Depends(get_db)):
    q = db.query(FormQuestionModel).filter(FormQuestionModel.QuestionId == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Pregunta no encontrada")
    db.delete(q)
    db.commit()


# --- FormOption ---
@router.get("/questions/{question_id}/options", response_model=list[FormOption])
def list_form_options(question_id: int, db: Session = Depends(get_db)):
    return db.query(FormOptionModel).filter(FormOptionModel.QuestionId == question_id).order_by(FormOptionModel.SortOrder).all()


@router.post("/questions/{question_id}/options", response_model=FormOption, status_code=201)
def create_form_option(question_id: int, data: FormOptionCreate, db: Session = Depends(get_db)):
    opt = FormOptionModel(
        QuestionId=question_id,
        Value=data.Value,
        Label=data.Label,
        SortOrder=data.SortOrder,
    )
    db.add(opt)
    db.commit()
    db.refresh(opt)
    return opt


@router.get("/options/{option_id}", response_model=FormOption)
def get_form_option(option_id: int, db: Session = Depends(get_db)):
    opt = db.query(FormOptionModel).filter(FormOptionModel.OptionId == option_id).first()
    if not opt:
        raise HTTPException(status_code=404, detail="Opción no encontrada")
    return opt


@router.patch("/options/{option_id}", response_model=FormOption)
def update_form_option(option_id: int, data: FormOptionUpdate, db: Session = Depends(get_db)):
    opt = db.query(FormOptionModel).filter(FormOptionModel.OptionId == option_id).first()
    if not opt:
        raise HTTPException(status_code=404, detail="Opción no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(opt, k, v)
    db.commit()
    db.refresh(opt)
    return opt


@router.delete("/options/{option_id}", status_code=204)
def delete_form_option(option_id: int, db: Session = Depends(get_db)):
    opt = db.query(FormOptionModel).filter(FormOptionModel.OptionId == option_id).first()
    if not opt:
        raise HTTPException(status_code=404, detail="Opción no encontrada")
    db.delete(opt)
    db.commit()
