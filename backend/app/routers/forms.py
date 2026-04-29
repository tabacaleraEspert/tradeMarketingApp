from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from ..auth import require_role, get_current_user, get_user_role
from ..database import get_db
from ..models import (
    Form as FormModel,
    FormQuestion as FormQuestionModel,
    FormOption as FormOptionModel,
    RouteForm as RouteFormModel,
    Route as RouteModel,
    VisitAnswer as VisitAnswerModel,
    User as UserModel,
    UserRole as UserRoleModel,
    Role as RoleModel,
)

# Máximo de formularios no-admin que un territory/ejecutivo puede asignar por ruta
MAX_REGIONAL_FORMS_PER_ROUTE = 2
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
def list_forms(skip: int = 0, limit: int = Query(default=100, le=500), db: Session = Depends(get_db)):
    return db.query(FormModel).order_by(FormModel.FormId).offset(skip).limit(limit).all()


@router.get("/{form_id}", response_model=Form)
def get_form(form_id: int, db: Session = Depends(get_db)):
    f = db.query(FormModel).filter(FormModel.FormId == form_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    return f


@router.post("", response_model=Form, status_code=201, dependencies=[Depends(require_role("admin"))])
def create_form(
    data: FormCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    f = FormModel(
        Name=data.Name,
        Channel=data.Channel,
        Version=data.Version,
        IsActive=data.IsActive,
        Frequency=data.Frequency,
        FrequencyConfig=data.FrequencyConfig,
        CreatedByUserId=current_user.UserId,
    )
    db.add(f)
    try:
        db.commit()
        db.refresh(f)
        return f
    except IntegrityError as e:
        db.rollback()
        err_msg = str(getattr(e, "orig", e)).lower()
        if "uq_form" in err_msg or "duplicate" in err_msg or "unique" in err_msg:
            raise HTTPException(
                status_code=409,
                detail=f"Ya existe un formulario con el nombre '{data.Name}' y versión {data.Version}. Usa otro nombre o incrementa la versión.",
            )
        raise


@router.patch("/{form_id}", response_model=Form, dependencies=[Depends(require_role("admin"))])
def update_form(
    form_id: int,
    data: FormUpdate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    f = db.query(FormModel).filter(FormModel.FormId == form_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    # Solo el creador o un admin puede editar
    role = get_user_role(db, current_user.UserId)
    if f.CreatedByUserId and f.CreatedByUserId != current_user.UserId and role != "admin":
        raise HTTPException(status_code=403, detail="Solo el creador o un admin puede editar este formulario")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(f, k, v)
    db.commit()
    db.refresh(f)
    return f


@router.delete("/{form_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_form(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    f = db.query(FormModel).filter(FormModel.FormId == form_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    # Solo el creador o un admin puede borrar
    role = get_user_role(db, current_user.UserId)
    if f.CreatedByUserId and f.CreatedByUserId != current_user.UserId and role != "admin":
        raise HTTPException(status_code=403, detail="Solo el creador o un admin puede eliminar este formulario")
    db.delete(f)
    db.commit()


# --- Form ↔ Routes (asignación bidireccional) ---
@router.get("/{form_id}/routes")
def list_routes_with_form(form_id: int, db: Session = Depends(get_db)):
    """Rutas que tienen este formulario asignado."""
    f = db.query(FormModel).filter(FormModel.FormId == form_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    rows = (
        db.query(RouteFormModel.RouteId)
        .filter(RouteFormModel.FormId == form_id)
        .all()
    )
    return {"route_ids": [r[0] for r in rows]}


class BulkAssignRoutes(BaseModel):
    route_ids: list[int] | None = None
    assign_to_all: bool = False


@router.post("/{form_id}/routes/bulk", dependencies=[Depends(require_role("admin"))])
def bulk_assign_form_to_routes(
    form_id: int,
    data: BulkAssignRoutes,
    db: Session = Depends(get_db),
):
    """Asignar formulario a rutas (bulk). assign_to_all=True asigna a todas las rutas."""
    f = db.query(FormModel).filter(FormModel.FormId == form_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")

    if data.assign_to_all:
        routes = db.query(RouteModel).filter(RouteModel.IsActive == True).all()
        route_ids = [r.RouteId for r in routes]
    elif data.route_ids:
        route_ids = data.route_ids
    else:
        return {"assigned": 0, "skipped": 0}

    existing = {
        r[0]
        for r in db.query(RouteFormModel.RouteId)
        .filter(
            RouteFormModel.FormId == form_id,
            RouteFormModel.RouteId.in_(route_ids),
        )
        .all()
    }

    assigned = 0
    for rid in route_ids:
        if rid in existing:
            continue
        rf = RouteFormModel(RouteId=rid, FormId=form_id, SortOrder=0)
        db.add(rf)
        assigned += 1

    db.commit()
    return {"assigned": assigned, "skipped": len(route_ids) - assigned}


@router.delete("/{form_id}/routes/{route_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def remove_form_from_route(form_id: int, route_id: int, db: Session = Depends(get_db)):
    """Quitar formulario de una ruta."""
    rf = db.query(RouteFormModel).filter(
        RouteFormModel.FormId == form_id,
        RouteFormModel.RouteId == route_id,
    ).first()
    if rf:
        db.delete(rf)
        db.commit()


# --- FormQuestion ---
@router.get("/{form_id}/questions", response_model=list[FormQuestion])
def list_form_questions(form_id: int, db: Session = Depends(get_db)):
    return db.query(FormQuestionModel).filter(FormQuestionModel.FormId == form_id).order_by(FormQuestionModel.SortOrder).all()


@router.post("/{form_id}/questions", response_model=FormQuestion, status_code=201, dependencies=[Depends(require_role("admin"))])
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


@router.patch("/questions/{question_id}", response_model=FormQuestion, dependencies=[Depends(require_role("admin"))])
def update_form_question(question_id: int, data: FormQuestionUpdate, db: Session = Depends(get_db)):
    q = db.query(FormQuestionModel).filter(FormQuestionModel.QuestionId == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Pregunta no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(q, k, v)
    db.commit()
    db.refresh(q)
    return q


@router.delete("/questions/{question_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_form_question(question_id: int, db: Session = Depends(get_db)):
    q = db.query(FormQuestionModel).filter(FormQuestionModel.QuestionId == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Pregunta no encontrada")
    db.query(VisitAnswerModel).filter(VisitAnswerModel.QuestionId == question_id).delete()
    db.query(FormOptionModel).filter(FormOptionModel.QuestionId == question_id).delete()
    db.delete(q)
    db.commit()


# --- FormOption ---
@router.get("/questions/{question_id}/options", response_model=list[FormOption])
def list_form_options(question_id: int, db: Session = Depends(get_db)):
    return db.query(FormOptionModel).filter(FormOptionModel.QuestionId == question_id).order_by(FormOptionModel.SortOrder).all()


@router.post("/questions/{question_id}/options", response_model=FormOption, status_code=201, dependencies=[Depends(require_role("admin"))])
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


@router.patch("/options/{option_id}", response_model=FormOption, dependencies=[Depends(require_role("admin"))])
def update_form_option(option_id: int, data: FormOptionUpdate, db: Session = Depends(get_db)):
    opt = db.query(FormOptionModel).filter(FormOptionModel.OptionId == option_id).first()
    if not opt:
        raise HTTPException(status_code=404, detail="Opción no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(opt, k, v)
    db.commit()
    db.refresh(opt)
    return opt


@router.delete("/options/{option_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_form_option(option_id: int, db: Session = Depends(get_db)):
    opt = db.query(FormOptionModel).filter(FormOptionModel.OptionId == option_id).first()
    if not opt:
        raise HTTPException(status_code=404, detail="Opción no encontrada")
    db.delete(opt)
    db.commit()
