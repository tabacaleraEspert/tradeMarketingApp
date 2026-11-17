"""Movimientos por usuario en un rango: visitas + altas de PDV + incidentes + notas.

Único conteo de "movimiento en la app". Lo usan `GET /audit/active-users`
(Auditoría de Usuario) y la vista gerencial de Inteligencia (columna "Mov. en la
app"), para que las dos pantallas den el mismo número.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import PDV, Incident, PdvNote, Visit


def count_user_activity(
    db: Session,
    dt_from: Optional[datetime],
    dt_to: Optional[datetime],
    *,
    end_exclusive: bool = False,
) -> dict[int, dict]:
    """`{user_id: {"count": n, "last": datetime | None}}`.

    `end_exclusive=False` mantiene el `<= dt_to` histórico de Auditoría; la vista
    gerencial pasa ventanas de mes con límite exclusivo."""
    acc: dict[int, dict] = {}

    def add(uid, count, last_ts):
        if uid is None:
            return
        slot = acc.setdefault(uid, {"count": 0, "last": None})
        slot["count"] += int(count or 0)
        if last_ts and (slot["last"] is None or last_ts > slot["last"]):
            slot["last"] = last_ts

    sources = (
        (Visit.UserId, Visit.VisitId, Visit.OpenedAt),
        # Altas de PDV (proxy: AssignedUserId = creador en el alta).
        (PDV.AssignedUserId, PDV.PdvId, PDV.CreatedAt),
        (Incident.CreatedBy, Incident.CreatedBy, Incident.CreatedAt),
        (PdvNote.CreatedByUserId, PdvNote.CreatedByUserId, PdvNote.CreatedAt),
    )
    for user_col, count_col, ts_col in sources:
        q = db.query(user_col, func.count(count_col), func.max(ts_col))
        if dt_from:
            q = q.filter(ts_col >= dt_from)
        if dt_to:
            q = q.filter(ts_col < dt_to if end_exclusive else ts_col <= dt_to)
        for uid, cnt, last in q.group_by(user_col).all():
            add(uid, cnt, last)
    return acc
