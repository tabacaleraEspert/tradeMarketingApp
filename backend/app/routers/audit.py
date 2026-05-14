"""Audit endpoints — user activity timeline aggregated from all tables."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import User as UserModel, Visit as VisitModel, PDV as PDVModel
from ..models.visit import VisitCheck as VisitCheckModel, VisitAnswer as VisitAnswerModel, VisitPhoto as VisitPhotoModel
from ..models.visit_action import VisitAction as VisitActionModel
from ..models.visit_coverage import VisitCoverage as CoverageModel
from ..models.visit_pop import VisitPOPItem as POPModel
from ..models.visit_loose import VisitLooseSurvey as LooseModel
from ..models.market_news import MarketNews as MNModel
from ..models.incident import Incident as IncidentModel
from ..models.pdv_note import PdvNote as NoteModel
from ..models.file import File as FileModel
from ..models.product import Product as ProductModel

router = APIRouter(prefix="/audit", tags=["Auditoría"])


@router.get("/user-timeline")
def user_timeline(
    user_id: int,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(default=500, le=2000),
    db: Session = Depends(get_db),
):
    """Returns a chronological timeline of ALL activity for a user across all tables."""

    # Parse date filters
    dt_from = datetime.fromisoformat(date_from) if date_from else None
    dt_to = datetime.fromisoformat(date_to) if date_to else None

    user = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    events: list[dict] = []

    # --- 1. Visits (opened / closed) ---
    vq = db.query(VisitModel).filter(VisitModel.UserId == user_id)
    if dt_from:
        vq = vq.filter(VisitModel.OpenedAt >= dt_from)
    if dt_to:
        vq = vq.filter(VisitModel.OpenedAt <= dt_to)
    visits = vq.order_by(VisitModel.OpenedAt.desc()).limit(limit).all()

    # Preload PDV names
    pdv_ids = {v.PdvId for v in visits}
    pdv_map = {p.PdvId: p.Name for p in db.query(PDVModel).filter(PDVModel.PdvId.in_(pdv_ids)).all()} if pdv_ids else {}

    visit_ids = [v.VisitId for v in visits]

    for v in visits:
        pdv_name = pdv_map.get(v.PdvId, f"PDV #{v.PdvId}")
        events.append({
            "ts": v.OpenedAt.isoformat() if v.OpenedAt else None,
            "type": "visit_open",
            "icon": "🏪",
            "title": f"Visita abierta — {pdv_name}",
            "detail": f"Status: {v.Status}",
            "visitId": v.VisitId,
            "pdvId": v.PdvId,
            "pdvName": pdv_name,
        })
        if v.ClosedAt:
            duration = (v.ClosedAt - v.OpenedAt).total_seconds() / 60 if v.OpenedAt else 0
            events.append({
                "ts": v.ClosedAt.isoformat(),
                "type": "visit_close",
                "icon": "✅",
                "title": f"Visita cerrada — {pdv_name}",
                "detail": f"Duración: {int(duration)} min" + (f" · Motivo: {v.CloseReason}" if v.CloseReason else ""),
                "visitId": v.VisitId,
                "pdvId": v.PdvId,
                "pdvName": pdv_name,
            })

    if not visit_ids:
        events.sort(key=lambda e: e["ts"] or "", reverse=True)
        return {"user": {"UserId": user.UserId, "DisplayName": user.DisplayName, "Email": user.Email}, "events": events}

    # --- 2. Check-ins / Check-outs ---
    checks = db.query(VisitCheckModel).filter(VisitCheckModel.VisitId.in_(visit_ids)).all()
    visit_pdv = {v.VisitId: pdv_map.get(v.PdvId, f"PDV #{v.PdvId}") for v in visits}
    for c in checks:
        events.append({
            "ts": c.Ts.isoformat() if c.Ts else None,
            "type": f"check_{c.CheckType.lower()}",
            "icon": "📍" if c.CheckType == "IN" else "🚶",
            "title": f"Check-{c.CheckType} — {visit_pdv.get(c.VisitId, '')}",
            "detail": f"GPS: {c.Lat}, {c.Lon}" + (f" · Precisión: {c.AccuracyMeters}m" if c.AccuracyMeters else "") + (f" · Distancia PDV: {c.DistanceToPdvM}m" if c.DistanceToPdvM else ""),
            "visitId": c.VisitId,
        })

    # --- 3. Photos ---
    photos = (
        db.query(VisitPhotoModel, FileModel)
        .join(FileModel, FileModel.FileId == VisitPhotoModel.FileId)
        .filter(VisitPhotoModel.VisitId.in_(visit_ids))
        .all()
    )
    for vp, f in photos:
        events.append({
            "ts": (f.TakenAt or f.CreatedAt).isoformat() if (f.TakenAt or f.CreatedAt) else None,
            "type": "photo",
            "icon": "📸",
            "title": f"Foto — {visit_pdv.get(vp.VisitId, '')}",
            "detail": f.OriginalName or "photo.jpg",
            "visitId": vp.VisitId,
        })

    # --- 4. Form answers ---
    answers = db.query(VisitAnswerModel).filter(VisitAnswerModel.VisitId.in_(visit_ids)).all()
    # Group by visit to count
    answer_counts: dict[int, int] = {}
    answer_ts: dict[int, str] = {}
    for a in answers:
        answer_counts[a.VisitId] = answer_counts.get(a.VisitId, 0) + 1
        ts = a.CreatedAt.isoformat() if a.CreatedAt else None
        if ts and (a.VisitId not in answer_ts or ts > answer_ts[a.VisitId]):
            answer_ts[a.VisitId] = ts
    for vid, count in answer_counts.items():
        events.append({
            "ts": answer_ts.get(vid),
            "type": "form_fill",
            "icon": "📋",
            "title": f"Formulario completado — {visit_pdv.get(vid, '')}",
            "detail": f"{count} respuestas",
            "visitId": vid,
        })

    # --- 5. Actions (canje, POP, promo, etc.) ---
    actions = db.query(VisitActionModel).filter(VisitActionModel.VisitId.in_(visit_ids)).all()
    ACTION_LABELS = {"canje_sueltos": "Canje de Sueltos", "pop": "Material POP", "promo": "Promoción", "juego": "Juego", "otra": "Otra"}
    for a in actions:
        detail_parts = [a.Description or ""]
        if a.DetailsJson:
            try:
                import json
                details = json.loads(a.DetailsJson)
                if isinstance(details, dict):
                    for k, v in details.items():
                        if v and k not in ("type",):
                            detail_parts.append(f"{k}: {v}")
            except: pass
        events.append({
            "ts": a.CreatedAt.isoformat() if a.CreatedAt else None,
            "type": "action",
            "icon": "⚡",
            "title": f"{ACTION_LABELS.get(a.ActionType, a.ActionType)} — {visit_pdv.get(a.VisitId, '')}",
            "detail": " · ".join(p for p in detail_parts if p),
            "visitId": a.VisitId,
        })

    # --- 6. Coverage ---
    coverages = db.query(CoverageModel).filter(CoverageModel.VisitId.in_(visit_ids)).all()
    cov_by_visit: dict[int, int] = {}
    cov_ts: dict[int, str] = {}
    for c in coverages:
        cov_by_visit[c.VisitId] = cov_by_visit.get(c.VisitId, 0) + 1
        ts = c.CreatedAt.isoformat() if c.CreatedAt else None
        if ts and (c.VisitId not in cov_ts or ts > cov_ts[c.VisitId]):
            cov_ts[c.VisitId] = ts
    for vid, count in cov_by_visit.items():
        events.append({
            "ts": cov_ts.get(vid),
            "type": "coverage",
            "icon": "📊",
            "title": f"Cobertura — {visit_pdv.get(vid, '')}",
            "detail": f"{count} productos relevados",
            "visitId": vid,
        })

    # --- 7. POP ---
    pops = db.query(POPModel).filter(POPModel.VisitId.in_(visit_ids)).all()
    for p in pops:
        events.append({
            "ts": p.CreatedAt.isoformat() if p.CreatedAt else None,
            "type": "pop",
            "icon": "🏷️",
            "title": f"Material POP — {visit_pdv.get(p.VisitId, '')}",
            "detail": f"{p.MaterialName} ({p.MaterialType})" + (f" · {p.Company}" if p.Company else "") + (" · Presente" if p.Present else " · No presente"),
            "visitId": p.VisitId,
        })

    # --- 8. Market News ---
    news = db.query(MNModel).filter(MNModel.VisitId.in_(visit_ids)).all()
    for n in news:
        events.append({
            "ts": n.CreatedAt.isoformat() if n.CreatedAt else None,
            "type": "market_news",
            "icon": "📰",
            "title": f"Novedad de mercado — {visit_pdv.get(n.VisitId, '')}",
            "detail": (n.Notes or "")[:100] + (f" · Tags: {n.Tags}" if n.Tags else ""),
            "visitId": n.VisitId,
        })

    # --- 9. Incidents ---
    incidents = db.query(IncidentModel).filter(IncidentModel.CreatedBy == user_id)
    if dt_from:
        incidents = incidents.filter(IncidentModel.CreatedAt >= dt_from)
    if dt_to:
        incidents = incidents.filter(IncidentModel.CreatedAt <= dt_to)
    for i in incidents.all():
        events.append({
            "ts": i.CreatedAt.isoformat() if i.CreatedAt else None,
            "type": "incident",
            "icon": "⚠️",
            "title": f"Incidente: {i.Type or 'general'}",
            "detail": f"{i.Notes or ''} · Prioridad: {i.Priority}",
        })

    # --- 10. PDV Notes ---
    notes = db.query(NoteModel).filter(NoteModel.CreatedByUserId == user_id)
    if dt_from:
        notes = notes.filter(NoteModel.CreatedAt >= dt_from)
    if dt_to:
        notes = notes.filter(NoteModel.CreatedAt <= dt_to)
    for n in notes.all():
        events.append({
            "ts": n.CreatedAt.isoformat() if n.CreatedAt else None,
            "type": "note",
            "icon": "📝",
            "title": f"Nota en PDV #{n.PdvId}",
            "detail": n.Content[:100] if n.Content else "",
        })

    # --- 11. PDV creation (by this user) ---
    pdv_q = db.query(PDVModel).filter(PDVModel.AssignedUserId == user_id)
    if dt_from:
        pdv_q = pdv_q.filter(PDVModel.CreatedAt >= dt_from)
    if dt_to:
        pdv_q = pdv_q.filter(PDVModel.CreatedAt <= dt_to)
    for p in pdv_q.all():
        events.append({
            "ts": p.CreatedAt.isoformat() if p.CreatedAt else None,
            "type": "pdv_create",
            "icon": "🏠",
            "title": f"Alta PDV: {p.Name}",
            "detail": f"{p.Address or ''} · Canal: {p.Channel or ''}" + (f" · Vol: {p.MonthlyVolume} atados" if p.MonthlyVolume else ""),
            "pdvId": p.PdvId,
            "pdvName": p.Name,
        })

    # --- 12. Route creation (by this user) ---
    from ..models.route import Route as RouteModel
    route_q = db.query(RouteModel).filter(RouteModel.CreatedByUserId == user_id)
    if dt_from:
        route_q = route_q.filter(RouteModel.CreatedAt >= dt_from)
    if dt_to:
        route_q = route_q.filter(RouteModel.CreatedAt <= dt_to)
    for r in route_q.all():
        events.append({
            "ts": r.CreatedAt.isoformat() if r.CreatedAt else None,
            "type": "route_create",
            "icon": "🗺️",
            "title": f"Ruta creada: {r.Name}",
            "detail": f"Frecuencia: {r.FrequencyType or 'sin definir'}" + (f" · Zona: {r.BejermanZone}" if r.BejermanZone else ""),
        })

    # Sort by timestamp descending
    events.sort(key=lambda e: e["ts"] or "", reverse=True)

    return {
        "user": {"UserId": user.UserId, "DisplayName": user.DisplayName, "Email": user.Email},
        "events": events[:limit],
        "totalEvents": len(events),
    }
