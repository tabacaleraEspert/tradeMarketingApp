from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.pdv_note import PdvNote as PdvNoteModel
from ..models.user import User as UserModel

router = APIRouter(prefix="/pdvs", tags=["PDV Notes"])


class PdvNoteCreate(BaseModel):
    Content: str
    CreatedByUserId: int | None = None
    VisitId: int | None = None


class PdvNoteUpdate(BaseModel):
    Content: str | None = None
    IsResolved: bool | None = None
    ResolvedByUserId: int | None = None


def _serialize(n: PdvNoteModel, user_map: dict[int, str] | None = None) -> dict:
    user_map = user_map or {}
    return {
        "PdvNoteId": n.PdvNoteId,
        "PdvId": n.PdvId,
        "Content": n.Content,
        "CreatedByUserId": n.CreatedByUserId,
        "CreatedByName": user_map.get(n.CreatedByUserId or 0),
        "VisitId": n.VisitId,
        "IsResolved": bool(n.IsResolved),
        "ResolvedByUserId": n.ResolvedByUserId,
        "ResolvedByName": user_map.get(n.ResolvedByUserId or 0),
        "ResolvedAt": n.ResolvedAt.isoformat() if n.ResolvedAt else None,
        "CreatedAt": n.CreatedAt.isoformat() if n.CreatedAt else None,
    }


@router.get("/{pdv_id}/notes")
def list_pdv_notes(
    pdv_id: int,
    open_only: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """Lista las notas/TODOs de un PDV. Si `open_only=true`, sólo las no resueltas."""
    q = db.query(PdvNoteModel).filter(PdvNoteModel.PdvId == pdv_id)
    if open_only:
        q = q.filter(PdvNoteModel.IsResolved== False)
    rows = q.order_by(PdvNoteModel.CreatedAt.desc()).all()

    user_ids = {r.CreatedByUserId for r in rows if r.CreatedByUserId} | {
        r.ResolvedByUserId for r in rows if r.ResolvedByUserId
    }
    user_map = {
        u.UserId: u.DisplayName
        for u in db.query(UserModel).filter(UserModel.UserId.in_(user_ids)).all()
    } if user_ids else {}

    return [_serialize(n, user_map) for n in rows]


@router.post("/{pdv_id}/notes", status_code=201)
def create_pdv_note(pdv_id: int, data: PdvNoteCreate, db: Session = Depends(get_db)):
    if not data.Content or not data.Content.strip():
        raise HTTPException(status_code=400, detail="El contenido de la nota es obligatorio")
    n = PdvNoteModel(
        PdvId=pdv_id,
        Content=data.Content.strip(),
        CreatedByUserId=data.CreatedByUserId,
        VisitId=data.VisitId,
        IsResolved=False,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    user_map = {}
    if n.CreatedByUserId:
        u = db.query(UserModel).filter(UserModel.UserId == n.CreatedByUserId).first()
        if u:
            user_map[u.UserId] = u.DisplayName
    return _serialize(n, user_map)


@router.patch("/notes/{note_id}")
def update_pdv_note(note_id: int, data: PdvNoteUpdate, db: Session = Depends(get_db)):
    n = db.query(PdvNoteModel).filter(PdvNoteModel.PdvNoteId == note_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    if data.Content is not None:
        n.Content = data.Content.strip()
    if data.IsResolved is not None:
        n.IsResolved = data.IsResolved
        if data.IsResolved:
            n.ResolvedAt = datetime.now(timezone.utc)
            if data.ResolvedByUserId is not None:
                n.ResolvedByUserId = data.ResolvedByUserId
        else:
            n.ResolvedAt = None
            n.ResolvedByUserId = None
    db.commit()
    db.refresh(n)

    user_ids = {n.CreatedByUserId, n.ResolvedByUserId} - {None}
    user_map = {
        u.UserId: u.DisplayName
        for u in db.query(UserModel).filter(UserModel.UserId.in_(user_ids)).all()
    } if user_ids else {}
    return _serialize(n, user_map)


@router.delete("/notes/{note_id}", status_code=204)
def delete_pdv_note(note_id: int, db: Session = Depends(get_db)):
    n = db.query(PdvNoteModel).filter(PdvNoteModel.PdvNoteId == note_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    db.delete(n)
    db.commit()
