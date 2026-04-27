"""Shared visit ownership check for all visit-related routers."""
from fastapi import HTTPException
from sqlalchemy.orm import Session
from ..models.visit import Visit
from ..models.user import User
from ..auth import get_user_role


def check_visit_ownership(visit: Visit, current_user: User, db: Session) -> None:
    """El dueño de la visita o un admin pueden modificarla. Caso contrario, 403."""
    if visit.UserId == current_user.UserId:
        return
    role = get_user_role(db, current_user.UserId)
    if role in ("admin", "territory_manager", "regional_manager"):
        return
    raise HTTPException(
        status_code=403,
        detail="Sólo el TM Rep dueño de la visita o un admin pueden modificarla",
    )
