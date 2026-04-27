from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..auth import require_role, get_current_user, get_user_role
from ..database import get_db
from ..models import Notification as NotificationModel
from ..models.user import User as UserModel
from ..schemas.notification import Notification, NotificationCreate, NotificationUpdate

router = APIRouter(prefix="/notifications", tags=["Notificaciones"])


@router.get("", response_model=list[Notification])
def list_notifications(
    skip: int = 0,
    limit: int = 100,
    active_only: bool = False,
    for_user: int | None = None,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lista notificaciones.

    - active_only=True: solo activas y no expiradas.
    - for_user=ID: solo las dirigidas a ese usuario o las globales (TargetUserId=null).
    """
    q = db.query(NotificationModel)
    if active_only:
        q = q.filter(NotificationModel.IsActive == True)
        now = datetime.now(timezone.utc)
        q = q.filter(
            (NotificationModel.ExpiresAt == None) | (NotificationModel.ExpiresAt > now)
        )
    if for_user is not None:
        # Users can only query their own notifications unless they're managers
        role = get_user_role(db, current_user.UserId)
        if for_user != current_user.UserId and role not in ("admin", "territory_manager", "regional_manager"):
            raise HTTPException(403, "No puede consultar notificaciones de otro usuario")
        q = q.filter(
            (NotificationModel.TargetUserId == None) | (NotificationModel.TargetUserId == for_user)
        )
    return q.order_by(NotificationModel.CreatedAt.desc()).offset(skip).limit(limit).all()


@router.get("/{notification_id}", response_model=Notification)
def get_notification(notification_id: int, db: Session = Depends(get_db)):
    n = db.query(NotificationModel).filter(NotificationModel.NotificationId == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    return n


@router.post("", response_model=Notification, status_code=201, dependencies=[Depends(require_role("vendedor"))])
def create_notification(data: NotificationCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    n = NotificationModel(
        Title=data.Title,
        Message=data.Message,
        Type=data.Type,
        Priority=data.Priority,
        IsActive=data.IsActive,
        ExpiresAt=data.ExpiresAt,
        CreatedBy=current_user.UserId,  # Always use current user, ignore client-supplied CreatedBy
        TargetUserId=data.TargetUserId,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


@router.patch("/{notification_id}", response_model=Notification, dependencies=[Depends(require_role("territory_manager"))])
def update_notification(notification_id: int, data: NotificationUpdate, db: Session = Depends(get_db)):
    n = db.query(NotificationModel).filter(NotificationModel.NotificationId == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(n, k, v)
    db.commit()
    db.refresh(n)
    return n


@router.delete("/{notification_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_notification(notification_id: int, db: Session = Depends(get_db)):
    n = db.query(NotificationModel).filter(NotificationModel.NotificationId == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    db.delete(n)
    db.commit()
