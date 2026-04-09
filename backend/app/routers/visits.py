from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Visit as VisitModel
from ..models.visit import VisitAnswer as VisitAnswerModel, VisitCheck as VisitCheckModel
from ..models.visit_action import VisitAction as VisitActionModel
from ..models.mandatory_activity import MandatoryActivity as MAModel
from ..models.pdv import PDV as PDVModel
from ..models.visit_form_time import VisitFormTime as VisitFormTimeModel
from ..models.form import FormQuestion as FormQuestionModel
from ..models.route import RouteForm as RouteFormModel, RouteDay as RouteDayModel
from ..schemas.visit import Visit, VisitCreate, VisitUpdate
from ..schemas.visit_answer import VisitAnswer, VisitAnswerCreate, VisitAnswerBulk

router = APIRouter(prefix="/visits", tags=["Visitas"])


@router.get("", response_model=list[Visit])
def list_visits(
    skip: int = 0,
    limit: int = 100,
    user_id: int | None = None,
    pdv_id: int | None = None,
    route_day_id: int | None = None,
    status: str | None = None,
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
    return q.order_by(VisitModel.OpenedAt.desc()).offset(skip).limit(limit).all()


@router.get("/{visit_id}", response_model=Visit)
def get_visit(visit_id: int, db: Session = Depends(get_db)):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    return v


@router.post("", response_model=Visit, status_code=201)
def create_visit(data: VisitCreate, db: Session = Depends(get_db)):
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
    q = db.query(MAModel).filter(MAModel.IsActive.is_(True))
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
def update_visit(visit_id: int, data: VisitUpdate, db: Session = Depends(get_db)):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    dump = data.model_dump(exclude_unset=True)
    is_closing = dump.get("Status") in ("CLOSED", "COMPLETED") and v.ClosedAt is None
    if is_closing:
        dump["ClosedAt"] = dump.get("ClosedAt") or datetime.now(timezone.utc)
    for k, val in dump.items():
        setattr(v, k, val)
    db.commit()
    db.refresh(v)

    # On close: mark incomplete mandatory actions as BACKLOG
    if is_closing:
        _mark_backlog(v.VisitId, db)

    return v


def _mark_backlog(visit_id: int, db: Session):
    """Mark incomplete mandatory actions as BACKLOG so they carry over."""
    pending = (
        db.query(VisitActionModel)
        .filter(
            VisitActionModel.VisitId == visit_id,
            VisitActionModel.IsMandatory.is_(True),
            VisitActionModel.Status == "PENDING",
        )
        .all()
    )
    for a in pending:
        a.Status = "BACKLOG"
    if pending:
        db.commit()


@router.delete("/{visit_id}", status_code=204)
def delete_visit(visit_id: int, db: Session = Depends(get_db)):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    db.delete(v)
    db.commit()


# ── Visit Answers ──────────────────────────────────────────

@router.get("/{visit_id}/answers", response_model=list[VisitAnswer])
def list_visit_answers(visit_id: int, db: Session = Depends(get_db)):
    return (
        db.query(VisitAnswerModel)
        .filter(VisitAnswerModel.VisitId == visit_id)
        .order_by(VisitAnswerModel.AnswerId)
        .all()
    )


@router.post("/{visit_id}/answers", response_model=list[VisitAnswer], status_code=201)
def save_visit_answers(visit_id: int, data: VisitAnswerBulk, db: Session = Depends(get_db)):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
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
def create_visit_check(visit_id: int, data: dict, db: Session = Depends(get_db)):
    """Payload: { CheckType: 'IN'|'OUT', Lat, Lon, AccuracyMeters?, DistanceToPdvM? }"""
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    check_type = (data.get("CheckType") or "").upper()
    if check_type not in ("IN", "OUT"):
        raise HTTPException(status_code=400, detail="CheckType debe ser IN u OUT")
    row = VisitCheckModel(
        VisitId=visit_id,
        CheckType=check_type,
        Ts=datetime.now(timezone.utc),
        Lat=data.get("Lat"),
        Lon=data.get("Lon"),
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
