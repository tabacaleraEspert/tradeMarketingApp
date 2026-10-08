"""Catálogo de material POP real (ver `services/pop_materials.py`).

- `router` (JWT): `GET /pop-materials` (cualquier usuario), `POST /pop-materials/sync` (admin).
- `internal_router` (sin JWT, registrado aparte en main.py): `POST /internal/pop-materials/sync`,
  lo dispara el cron diario de GitHub Actions con header `X-Cron-Key` = `CRON_SECRET`
  (mismo patrón que `routers/behavior_reports.py`).
"""
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_role
from ..config import settings
from ..database import get_db
from ..models import PopMaterial
from ..models.user import User as UserModel
from ..schemas.pop_material import PopMaterialRead, PopSyncResult
from ..services.pop_materials import PopSyncDisabled, PopSyncError, sync_pop_materials

router = APIRouter(prefix="/pop-materials", tags=["Material POP"])
internal_router = APIRouter(prefix="/internal/pop-materials", tags=["Material POP"])


def _run_sync(db: Session, user) -> dict:
    try:
        return sync_pop_materials(db, user=user)
    except PopSyncDisabled as e:
        raise HTTPException(503, str(e))
    except PopSyncError as e:
        db.rollback()
        raise HTTPException(502, str(e))


@router.get("", response_model=list[PopMaterialRead])
def list_pop_materials(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Catálogo activo, más nuevos primero (código correlativo desc)."""
    return (
        db.query(PopMaterial)
        .filter(PopMaterial.IsActive == True)  # noqa: E712
        .order_by(PopMaterial.Code.desc())
        .all()
    )


@router.post("/sync", response_model=PopSyncResult)
def sync_manual(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_role("admin")),
):
    return _run_sync(db, current_user)


@internal_router.post("/sync", response_model=PopSyncResult)
def sync_cron(x_cron_key: str = Header(default=""), db: Session = Depends(get_db)):
    if not settings.cron_secret:
        raise HTTPException(503, "CRON_SECRET no configurado")
    if not hmac.compare_digest(x_cron_key.encode(), settings.cron_secret.encode()):
        raise HTTPException(401, "X-Cron-Key inválida")
    return _run_sync(db, None)
