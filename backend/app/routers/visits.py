from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..auth import get_current_user, get_user_role
from ..database import get_db
from ..models import Visit as VisitModel, User as UserModel
from ..models.visit import VisitAnswer as VisitAnswerModel, VisitCheck as VisitCheckModel
from ..models.visit_action import VisitAction as VisitActionModel
from ..models.mandatory_activity import MandatoryActivity as MAModel
from ..models.pdv import PDV as PDVModel
from ..models.visit_coverage import VisitCoverage as CoverageModel
from ..models.visit_pop import VisitPOPItem as POPModel
from ..models.product import Product as ProductModel
from ..models.visit_form_time import VisitFormTime as VisitFormTimeModel
from ..models.form import FormQuestion as FormQuestionModel
from ..models.route import RouteForm as RouteFormModel, RouteDay as RouteDayModel
from ..schemas.visit import Visit, VisitCreate, VisitUpdate
from ..schemas.visit_answer import VisitAnswer, VisitAnswerCreate, VisitAnswerBulk

router = APIRouter(prefix="/visits", tags=["Visitas"])


# Estados válidos y transiciones permitidas.
# Una visita puede ir OPEN ↔ IN_PROGRESS y desde cualquiera de los dos a CLOSED/COMPLETED.
# Una vez CLOSED/COMPLETED no se puede modificar el estado (terminal).
_VALID_STATUSES = {"OPEN", "IN_PROGRESS", "CLOSED", "COMPLETED"}
_TERMINAL_STATUSES = {"CLOSED", "COMPLETED"}
_TRANSITIONS = {
    "OPEN": {"IN_PROGRESS", "CLOSED", "COMPLETED"},
    "IN_PROGRESS": {"OPEN", "CLOSED", "COMPLETED"},
    "CLOSED": set(),       # terminal
    "COMPLETED": set(),    # terminal
}


def _check_visit_ownership(visit: VisitModel, current_user: UserModel, db: Session) -> None:
    """El dueño de la visita o un admin pueden modificarla. Caso contrario, 403."""
    if visit.UserId == current_user.UserId:
        return
    role = get_user_role(db, current_user.UserId)
    if role == "admin":
        return
    raise HTTPException(
        status_code=403,
        detail="Sólo el TM Rep dueño de la visita o un admin pueden modificarla",
    )


@router.get("", response_model=list[Visit])
def list_visits(
    skip: int = 0,
    limit: int = 100,
    user_id: int | None = None,
    pdv_id: int | None = None,
    route_day_id: int | None = None,
    status: str | None = None,
    enrich: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(VisitModel)
    if user_id is not None:
        q = q.filter(VisitModel.UserId == user_id)
    if pdv_id is not None:
        q = q.filter(VisitModel.PdvId == pdv_id)
    if route_day_id is not None:
        q = q.filter(VisitModel.RouteDayId == route_day_id)
    if status is not None:
        q = q.filter(VisitModel.Status == status)
    visits = q.order_by(VisitModel.OpenedAt.desc()).offset(skip).limit(limit).all()

    if not enrich:
        return visits

    # Enrich with PDV name and user name for admin views
    pdv_ids = {v.PdvId for v in visits if v.PdvId}
    user_ids = {v.UserId for v in visits if v.UserId}
    pdv_map = {p.PdvId: p for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()} if pdv_ids else {}
    user_map = {u.UserId: u for u in db.query(UserModel).filter(UserModel.UserId.in_(user_ids)).all()} if user_ids else {}

    result = []
    for v in visits:
        d = {
            "VisitId": v.VisitId, "PdvId": v.PdvId, "UserId": v.UserId,
            "RouteDayId": v.RouteDayId, "Status": v.Status,
            "OpenedAt": v.OpenedAt.isoformat() if v.OpenedAt else None,
            "ClosedAt": v.ClosedAt.isoformat() if v.ClosedAt else None,
            "CloseReason": v.CloseReason,
            "PdvName": pdv_map[v.PdvId].Name if v.PdvId and v.PdvId in pdv_map else None,
            "PdvAddress": pdv_map[v.PdvId].Address if v.PdvId and v.PdvId in pdv_map else None,
            "UserName": user_map[v.UserId].DisplayName if v.UserId and v.UserId in user_map else None,
        }
        result.append(d)
    return result


@router.get("/{visit_id}", response_model=Visit)
def get_visit(visit_id: int, db: Session = Depends(get_db)):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    return v


@router.get("/{visit_id}/full")
def get_visit_full(visit_id: int, db: Session = Depends(get_db), current_user: UserModel = Depends(get_current_user)):
    """Full visit detail: visit + PDV + user + answers + coverage + POP + market news + photos."""
    from ..models.market_news import MarketNews as MNModel
    from ..models.visit import VisitPhoto as VPModel
    from ..models.file import File as FileModel
    from ..storage import storage

    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    pdv = db.query(PDVModel).filter(PDVModel.PdvId == v.PdvId).first()
    user = db.query(UserModel).filter(UserModel.UserId == v.UserId).first()

    # Answers with question labels
    answers_raw = db.query(VisitAnswerModel).filter(VisitAnswerModel.VisitId == visit_id).all()
    q_ids = [a.QuestionId for a in answers_raw]
    questions = {q.QuestionId: q for q in db.query(FormQuestionModel).filter(FormQuestionModel.QuestionId.in_(q_ids)).all()} if q_ids else {}
    answers = []
    for a in answers_raw:
        q = questions.get(a.QuestionId)
        answers.append({
            "QuestionId": a.QuestionId,
            "Label": q.Label if q else f"Pregunta #{a.QuestionId}",
            "QType": q.QType if q else "text",
            "ValueText": a.ValueText,
            "ValueNumber": float(a.ValueNumber) if a.ValueNumber is not None else None,
            "ValueBool": a.ValueBool,
            "ValueJson": a.ValueJson,
        })

    # Coverage with product names
    cov_raw = db.query(CoverageModel).filter(CoverageModel.VisitId == visit_id).all()
    prod_ids = [c.ProductId for c in cov_raw]
    products = {p.ProductId: p for p in db.query(ProductModel).filter(ProductModel.ProductId.in_(prod_ids)).all()} if prod_ids else {}
    coverage = []
    for c in cov_raw:
        p = products.get(c.ProductId)
        coverage.append({
            "ProductId": c.ProductId,
            "ProductName": p.Name if p else f"Producto #{c.ProductId}",
            "Category": p.Category if p else "",
            "Manufacturer": p.Manufacturer if p else None,
            "IsOwn": p.IsOwn if p else False,
            "Works": c.Works,
            "Price": float(c.Price) if c.Price is not None else None,
            "Availability": c.Availability,
        })

    # POP
    pop = [
        {"MaterialType": p.MaterialType, "MaterialName": p.MaterialName, "Company": p.Company, "Present": p.Present, "HasPrice": p.HasPrice}
        for p in db.query(POPModel).filter(POPModel.VisitId == visit_id).all()
    ]

    # Market news
    news = [
        {"MarketNewsId": n.MarketNewsId, "Tags": n.Tags, "Notes": n.Notes, "CreatedAt": n.CreatedAt.isoformat() if n.CreatedAt else None}
        for n in db.query(MNModel).filter(MNModel.VisitId == visit_id).all()
    ]

    # Photos
    photo_rows = db.query(VPModel, FileModel).join(FileModel, FileModel.FileId == VPModel.FileId).filter(VPModel.VisitId == visit_id).all()
    photos = []
    for vp, f in photo_rows:
        url = storage.get_url(f.BlobKey) if f.BlobKey else (f.Url or "")
        photos.append({"FileId": f.FileId, "PhotoType": vp.PhotoType, "url": url, "Notes": vp.Notes})

    return {
        "visit": {
            "VisitId": v.VisitId, "PdvId": v.PdvId, "UserId": v.UserId,
            "Status": v.Status, "OpenedAt": v.OpenedAt.isoformat() if v.OpenedAt else None,
            "ClosedAt": v.ClosedAt.isoformat() if v.ClosedAt else None,
            "CloseReason": v.CloseReason,
        },
        "pdv": {"PdvId": pdv.PdvId, "Name": pdv.Name, "Address": pdv.Address, "Channel": getattr(pdv, "ChannelName", None) or getattr(pdv, "Channel", None)} if pdv else None,
        "user": {"UserId": user.UserId, "DisplayName": user.DisplayName, "Email": user.Email} if user else None,
        "answers": answers,
        "coverage": coverage,
        "pop": pop,
        "marketNews": news,
        "photos": photos,
    }


@router.post("", response_model=Visit, status_code=201)
def create_visit(
    data: VisitCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    # 1. Validar PDV existe y está activo
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == data.PdvId).first()
    if not pdv:
        raise HTTPException(status_code=400, detail="PDV no existe")
    if not pdv.IsActive:
        raise HTTPException(status_code=400, detail="No se puede crear visita en un PDV inactivo")

    # 2. Validar ownership: el TM Rep sólo crea visitas para sí mismo (admin puede crear para otros)
    role = get_user_role(db, current_user.UserId)
    if role != "admin" and data.UserId != current_user.UserId:
        raise HTTPException(
            status_code=403,
            detail="Sólo podés crear visitas a tu nombre",
        )

    # 3. No permitir crear una visita nueva si el usuario ya tiene CUALQUIER visita OPEN/IN_PROGRESS
    open_visit = (
        db.query(VisitModel)
        .filter(
            VisitModel.UserId == data.UserId,
            VisitModel.Status.in_(["OPEN", "IN_PROGRESS"]),
        )
        .first()
    )
    if open_visit:
        if open_visit.PdvId == data.PdvId:
            raise HTTPException(
                status_code=409,
                detail=f"Ya tenés una visita abierta en este PDV (visit_id={open_visit.VisitId})",
            )
        raise HTTPException(
            status_code=409,
            detail=f"Tenés una visita abierta en otro PDV (visit_id={open_visit.VisitId}, pdv_id={open_visit.PdvId}). Cerrala antes de hacer check-in.",
        )

    # 4. Validar Status del request si vino
    if data.Status and data.Status not in _VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Status inválido. Permitidos: {sorted(_VALID_STATUSES)}",
        )

    # 4b. No permitir crear visitas directamente como COMPLETED/CLOSED
    if data.Status and data.Status in _TERMINAL_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"No se puede crear una visita con Status '{data.Status}'. Solo se permite OPEN o IN_PROGRESS.",
        )

    v = VisitModel(
        PdvId=data.PdvId,
        UserId=data.UserId,
        RouteDayId=data.RouteDayId,
        Status=data.Status,
        FormId=data.FormId,
        FormVersion=data.FormVersion,
        FormStatus=data.FormStatus,
        MaterialExternalId=data.MaterialExternalId,
        CloseReason=data.CloseReason,
    )
    db.add(v)
    db.commit()
    db.refresh(v)

    # Mark RouteDayPdv as IN_PROGRESS when visit is opened
    if v.RouteDayId:
        from ..models.route import RouteDayPdv as RouteDayPdvModel
        rdp = (
            db.query(RouteDayPdvModel)
            .filter(
                RouteDayPdvModel.RouteDayId == v.RouteDayId,
                RouteDayPdvModel.PdvId == v.PdvId,
            )
            .first()
        )
        if rdp and rdp.ExecutionStatus == "PENDING":
            rdp.ExecutionStatus = "IN_PROGRESS"
            db.commit()

    # Auto-create mandatory actions for this visit
    _create_mandatory_actions(v, db)
    # Carry over BACKLOG actions from previous visits to this PDV
    _carry_over_backlog(v, db)

    return v


def _create_mandatory_actions(visit: VisitModel, db: Session):
    """Create VisitAction entries for each applicable MandatoryActivity."""
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == visit.PdvId).first()
    channel_id = pdv.ChannelId if pdv else None

    # Get route from RouteDayId if present
    route_id = None
    if visit.RouteDayId:
        rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == visit.RouteDayId).first()
        if rd:
            route_id = rd.RouteId

    # Find applicable mandatory activities (global + channel match + route match)
    q = db.query(MAModel).filter(MAModel.IsActive== True)
    templates = q.all()

    for t in templates:
        # Scope check: if template has ChannelId, PDV must match
        if t.ChannelId is not None and t.ChannelId != channel_id:
            continue
        # Scope check: if template has RouteId, visit must be on that route
        if t.RouteId is not None and t.RouteId != route_id:
            continue

        action = VisitActionModel(
            VisitId=visit.VisitId,
            ActionType=t.ActionType,
            Description=t.Description,
            DetailsJson=t.DetailsJson,
            PhotoRequired=t.PhotoRequired,
            IsMandatory=True,
            MandatoryActivityId=t.MandatoryActivityId,
            Status="PENDING",
        )
        db.add(action)
    db.commit()


def _carry_over_backlog(visit: VisitModel, db: Session):
    """Find BACKLOG actions from previous closed visits to same PDV and re-create them."""
    # Get the most recent closed visit to this PDV (excluding current)
    prev_visits = (
        db.query(VisitModel)
        .filter(
            VisitModel.PdvId == visit.PdvId,
            VisitModel.VisitId != visit.VisitId,
            VisitModel.Status.in_(("CLOSED", "COMPLETED")),
        )
        .order_by(VisitModel.ClosedAt.desc())
        .limit(1)
        .all()
    )
    if not prev_visits:
        return

    prev = prev_visits[0]
    backlog_actions = (
        db.query(VisitActionModel)
        .filter(
            VisitActionModel.VisitId == prev.VisitId,
            VisitActionModel.Status == "BACKLOG",
        )
        .all()
    )

    for ba in backlog_actions:
        # Check we haven't already created this mandatory activity
        if ba.MandatoryActivityId:
            existing = (
                db.query(VisitActionModel)
                .filter(
                    VisitActionModel.VisitId == visit.VisitId,
                    VisitActionModel.MandatoryActivityId == ba.MandatoryActivityId,
                )
                .first()
            )
            if existing:
                continue

        action = VisitActionModel(
            VisitId=visit.VisitId,
            ActionType=ba.ActionType,
            Description=f"[BACKLOG] {ba.Description or ''}".strip(),
            DetailsJson=ba.DetailsJson,
            PhotoRequired=ba.PhotoRequired,
            IsMandatory=True,
            MandatoryActivityId=ba.MandatoryActivityId,
            Status="PENDING",
        )
        db.add(action)
    db.commit()


@router.patch("/{visit_id}", response_model=Visit)
def update_visit(
    visit_id: int,
    data: VisitUpdate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    # Ownership: sólo el dueño o admin
    _check_visit_ownership(v, current_user, db)

    dump = data.model_dump(exclude_unset=True)

    # Validar transición de Status si está cambiando
    new_status = dump.get("Status")
    if new_status is not None and new_status != v.Status:
        if new_status not in _VALID_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Status inválido. Permitidos: {sorted(_VALID_STATUSES)}",
            )
        current_status = v.Status or "OPEN"
        if current_status in _TERMINAL_STATUSES:
            raise HTTPException(
                status_code=409,
                detail=f"La visita ya está {current_status}, no se puede modificar",
            )
        allowed = _TRANSITIONS.get(current_status, set())
        if new_status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Transición inválida {current_status} → {new_status}",
            )

    is_closing = dump.get("Status") in ("CLOSED", "COMPLETED") and v.ClosedAt is None
    if is_closing:
        dump["ClosedAt"] = dump.get("ClosedAt") or datetime.now(timezone.utc)
    for k, val in dump.items():
        setattr(v, k, val)
    db.commit()
    db.refresh(v)

    # On close: mark incomplete mandatory actions as BACKLOG + update RouteDayPdv status
    if is_closing:
        _mark_backlog(v.VisitId, db)
        _update_route_day_pdv_status(v, db)

    return v


def _update_route_day_pdv_status(visit: VisitModel, db: Session):
    """Al cerrar la visita, marca el RouteDayPdv correspondiente como DONE."""
    if not visit.RouteDayId:
        return
    from ..models.route import RouteDayPdv as RouteDayPdvModel
    rdp = (
        db.query(RouteDayPdvModel)
        .filter(
            RouteDayPdvModel.RouteDayId == visit.RouteDayId,
            RouteDayPdvModel.PdvId == visit.PdvId,
        )
        .first()
    )
    if rdp:
        rdp.ExecutionStatus = "DONE"
        db.commit()


def _mark_backlog(visit_id: int, db: Session):
    """Mark incomplete mandatory actions as BACKLOG so they carry over."""
    pending = (
        db.query(VisitActionModel)
        .filter(
            VisitActionModel.VisitId == visit_id,
            VisitActionModel.IsMandatory== True,
            VisitActionModel.Status == "PENDING",
        )
        .all()
    )
    for a in pending:
        a.Status = "BACKLOG"
    if pending:
        db.commit()


@router.delete("/{visit_id}", status_code=204)
def delete_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    # Sólo admin puede borrar visitas (los TM Reps no, así no pueden ocultar evidencia)
    role = get_user_role(db, current_user.UserId)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Sólo un admin puede borrar visitas")
    # Borrar tablas hijas que pueden no tener CASCADE en la DB
    from ..models.visit import VisitPhoto as VisitPhotoModel
    from ..models.visit_loose import VisitLooseSurvey as LooseModel
    from ..models.market_news import MarketNews as MNModel
    from ..models.incident import Incident as IncidentModel
    for child in (VisitAnswerModel, VisitCheckModel, VisitActionModel,
                  CoverageModel, POPModel, VisitFormTimeModel,
                  VisitPhotoModel, LooseModel):
        db.query(child).filter(child.VisitId == visit_id).delete()
    # Nullificar FK opcionales
    db.query(MNModel).filter(MNModel.VisitId == visit_id).delete()
    db.query(IncidentModel).filter(IncidentModel.VisitId == visit_id).update({IncidentModel.VisitId: None})
    from ..models.pdv_note import PdvNote as NoteModel
    db.query(NoteModel).filter(NoteModel.VisitId == visit_id).update({NoteModel.VisitId: None})
    db.delete(v)
    db.commit()


# ── Visit Answers ──────────────────────────────────────────

@router.get("/{visit_id}/answers", response_model=list[VisitAnswer])
def list_visit_answers(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    # Ownership check: only the visit owner or supervisor+ can see answers
    role = get_user_role(db, current_user.UserId)
    if v.UserId != current_user.UserId and role not in ("admin", "territory_manager", "regional"):
        raise HTTPException(
            status_code=403,
            detail="Sólo el dueño de la visita o un supervisor pueden ver las respuestas",
        )

    return (
        db.query(VisitAnswerModel)
        .filter(VisitAnswerModel.VisitId == visit_id)
        .order_by(VisitAnswerModel.AnswerId)
        .all()
    )


@router.post("/{visit_id}/answers", response_model=list[VisitAnswer], status_code=201)
def save_visit_answers(
    visit_id: int,
    data: VisitAnswerBulk,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    # Ownership
    _check_visit_ownership(v, current_user, db)

    # No permitir modificar respuestas si la visita ya está cerrada
    current_status = (v.Status or "OPEN").upper()
    if current_status in _TERMINAL_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="No se puede modificar respuestas de una visita cerrada",
        )

    # Delete existing answers for this visit to allow re-submission
    db.query(VisitAnswerModel).filter(VisitAnswerModel.VisitId == visit_id).delete()
    created = []
    for ans in data.answers:
        row = VisitAnswerModel(
            VisitId=visit_id,
            QuestionId=ans.QuestionId,
            ValueText=ans.ValueText,
            ValueNumber=ans.ValueNumber,
            ValueBool=ans.ValueBool,
            OptionId=ans.OptionId,
            ValueJson=ans.ValueJson,
        )
        db.add(row)
        created.append(row)
    db.commit()
    for r in created:
        db.refresh(r)
    return created


# ── Visit Close Validation ─────────────────────────────────

@router.post("/{visit_id}/validate-close")
def validate_visit_close(visit_id: int, db: Session = Depends(get_db)):
    """Check if mandatory fields are filled before allowing visit close."""
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    missing = []

    # Find forms assigned to this route day
    form_ids: list[int] = []
    if v.RouteDayId:
        rd = db.query(RouteDayModel).filter(RouteDayModel.RouteDayId == v.RouteDayId).first()
        if rd:
            rfs = db.query(RouteFormModel).filter(RouteFormModel.RouteId == rd.RouteId).all()
            form_ids = [rf.FormId for rf in rfs]

    if form_ids:
        # Get required questions from assigned forms
        required_qs = (
            db.query(FormQuestionModel)
            .filter(FormQuestionModel.FormId.in_(form_ids), FormQuestionModel.IsRequired == True)
            .all()
        )
        if required_qs:
            answered_qids = {
                a.QuestionId
                for a in db.query(VisitAnswerModel)
                .filter(VisitAnswerModel.VisitId == visit_id)
                .all()
            }
            for q in required_qs:
                if q.QuestionId not in answered_qids:
                    missing.append({"questionId": q.QuestionId, "label": q.Label, "formId": q.FormId})

    # Check mandatory steps from paso-a-paso (pasos 6, 10, 11)
    # Paso 6: Proveedor de cigarrillos
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == v.PdvId).first()
    if pdv and pdv.DistributorId is None:
        missing.append({"label": "Proveedor de cigarrillos no asignado (paso 6)"})

    # Paso 10: Cobertura y precios
    # - Productos propios (Espert): obligatorios CADA visita
    # - Productos competencia: obligatorios cada N visitas (configurable)
    from ..routers.app_settings import get_setting

    coverage_count = db.query(CoverageModel).filter(CoverageModel.VisitId == visit_id).count()
    if coverage_count == 0:
        missing.append({"label": "Cobertura y precios no completada (paso 10)"})
    else:
        # Own products: always required
        own_coverage = (
            db.query(CoverageModel)
            .join(ProductModel, CoverageModel.ProductId == ProductModel.ProductId)
            .filter(CoverageModel.VisitId == visit_id, ProductModel.IsOwn == True)
            .count()
        )
        if own_coverage == 0:
            missing.append({"label": "Faltan productos Espert en cobertura (obligatorios cada visita)"})

        # Competitor products: required every N visits
        n_str = get_setting(db, "competitor_coverage_every_n_visits")
        n = int(n_str) if n_str.isdigit() else 4

        # Count closed visits to this PDV (before this one)
        closed_visits_count = (
            db.query(VisitModel)
            .filter(
                VisitModel.PdvId == v.PdvId,
                VisitModel.VisitId != visit_id,
                VisitModel.Status.in_(["CLOSED", "COMPLETED"]),
            )
            .count()
        )
        # Visit number (1-based): this is visit #(closed+1)
        visit_number = closed_visits_count + 1
        competitor_due = (visit_number % n) == 0 or visit_number == 1  # first visit + every N

        if competitor_due:
            competitor_coverage = (
                db.query(CoverageModel)
                .join(ProductModel, CoverageModel.ProductId == ProductModel.ProductId)
                .filter(CoverageModel.VisitId == visit_id, ProductModel.IsOwn == False)
                .count()
            )
            if competitor_coverage == 0:
                missing.append({"label": f"Cobertura de competencia obligatoria (cada {n} visitas, visita #{visit_number})"})

    # Paso 11: Censo POP
    pop_count = db.query(POPModel).filter(POPModel.VisitId == visit_id).count()
    if pop_count == 0:
        missing.append({"label": "Censo de materiales POP no completado (paso 11)"})

    # Check execution actions have photos
    actions_without_photo = (
        db.query(VisitActionModel)
        .filter(
            VisitActionModel.VisitId == visit_id,
            VisitActionModel.PhotoRequired == True,
            VisitActionModel.PhotoTaken == False,
        )
        .all()
    )
    for a in actions_without_photo:
        missing.append({"actionId": a.VisitActionId, "label": f"Foto pendiente: {a.ActionType}"})

    return {
        "valid": len(missing) == 0,
        "missing": missing,
    }


# ── Visit Checks (GPS check-in / check-out) ────────────────

@router.get("/{visit_id}/checks")
def list_visit_checks(visit_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(VisitCheckModel)
        .filter(VisitCheckModel.VisitId == visit_id)
        .order_by(VisitCheckModel.Ts)
        .all()
    )
    return [
        {
            "VisitCheckId": r.VisitCheckId,
            "CheckType": r.CheckType,
            "Ts": r.Ts.isoformat() if r.Ts else None,
            "Lat": float(r.Lat) if r.Lat is not None else None,
            "Lon": float(r.Lon) if r.Lon is not None else None,
            "AccuracyMeters": float(r.AccuracyMeters) if r.AccuracyMeters is not None else None,
            "DistanceToPdvM": float(r.DistanceToPdvM) if r.DistanceToPdvM is not None else None,
        }
        for r in rows
    ]


@router.post("/{visit_id}/checks", status_code=201)
def create_visit_check(
    visit_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Payload: { CheckType: 'IN'|'OUT', Lat, Lon, AccuracyMeters?, DistanceToPdvM? }"""
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    # Sólo el dueño o admin
    _check_visit_ownership(v, current_user, db)

    check_type = (data.get("CheckType") or "").upper()
    if check_type not in ("IN", "OUT"):
        raise HTTPException(status_code=400, detail="CheckType debe ser IN u OUT")

    # Validar que la visita esté en un estado donde tiene sentido el check
    current_status = (v.Status or "OPEN").upper()
    if check_type == "IN" and current_status in _TERMINAL_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="No se puede hacer check-in en una visita ya cerrada",
        )

    # Validar coordenadas si vienen
    lat = data.get("Lat")
    lon = data.get("Lon")
    if lat is not None and (lat < -90 or lat > 90):
        raise HTTPException(status_code=400, detail="Latitud fuera de rango (-90 a 90)")
    if lon is not None and (lon < -180 or lon > 180):
        raise HTTPException(status_code=400, detail="Longitud fuera de rango (-180 a 180)")

    row = VisitCheckModel(
        VisitId=visit_id,
        CheckType=check_type,
        Ts=datetime.now(timezone.utc),
        Lat=lat,
        Lon=lon,
        AccuracyMeters=data.get("AccuracyMeters"),
        DistanceToPdvM=data.get("DistanceToPdvM"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "VisitCheckId": row.VisitCheckId,
        "CheckType": row.CheckType,
        "Ts": row.Ts.isoformat() if row.Ts else None,
        "Lat": float(row.Lat) if row.Lat is not None else None,
        "Lon": float(row.Lon) if row.Lon is not None else None,
    }


# ── Form Times (tracking) ──────────────────────────────────

@router.get("/{visit_id}/form-times")
def list_form_times(visit_id: int, db: Session = Depends(get_db)):
    rows = db.query(VisitFormTimeModel).filter(VisitFormTimeModel.VisitId == visit_id).all()
    return [
        {"FormId": r.FormId, "ElapsedSeconds": r.ElapsedSeconds}
        for r in rows
    ]


@router.post("/{visit_id}/form-times")
def upsert_form_times(visit_id: int, data: dict, db: Session = Depends(get_db)):
    """Payload: { form_times: [{ FormId, ElapsedSeconds }] }. Suma el tiempo al registro existente."""
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    items = data.get("form_times", [])
    for item in items:
        fid = item.get("FormId")
        seconds = int(item.get("ElapsedSeconds", 0))
        if not fid or seconds <= 0:
            continue
        row = (
            db.query(VisitFormTimeModel)
            .filter(VisitFormTimeModel.VisitId == visit_id, VisitFormTimeModel.FormId == fid)
            .first()
        )
        if row:
            row.ElapsedSeconds = (row.ElapsedSeconds or 0) + seconds
        else:
            row = VisitFormTimeModel(VisitId=visit_id, FormId=fid, ElapsedSeconds=seconds)
            db.add(row)
    db.commit()
    return {"ok": True}
