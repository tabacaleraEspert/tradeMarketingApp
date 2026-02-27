from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Notification as NotificationModel
from ..schemas.notification import Notification, NotificationCreate, NotificationUpdate

router = APIRouter(prefix="/notifications", tags=["Notificaciones"])


@router.get("", response_model=list[Notification])
def list_notifications(
    skip: int = 0,
    limit: int = 100,
    active_only: bool = False,
    db: Session = Depends(get_db),
):
    """Lista notificaciones. active_only=True para vista Trade (solo activas y no expiradas)."""
    q = db.query(NotificationModel)
    if active_only:
        q = q.filter(NotificationModel.IsActive == True)
        now = datetime.now(timezone.utc)
        q = q.filter(
            (NotificationModel.ExpiresAt == None) | (NotificationModel.ExpiresAt > now)
        )
    return q.order_by(NotificationModel.CreatedAt.desc()).offset(skip).limit(limit).all()


@router.get("/{notification_id}", response_model=Notification)
def get_notification(notification_id: int, db: Session = Depends(get_db)):
    n = db.query(NotificationModel).filter(NotificationModel.NotificationId == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    return n


@router.post("", response_model=Notification, status_code=201)
def create_notification(data: NotificationCreate, db: Session = Depends(get_db)):
    n = NotificationModel(
        Title=data.Title,
        Message=data.Message,
        Type=data.Type,
        Priority=data.Priority,
        IsActive=data.IsActive,
        ExpiresAt=data.ExpiresAt,
        CreatedBy=data.CreatedBy,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


@router.patch("/{notification_id}", response_model=Notification)
def update_notification(notification_id: int, data: NotificationUpdate, db: Session = Depends(get_db)):
    n = db.query(NotificationModel).filter(NotificationModel.NotificationId == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(n, k, v)
    db.commit()
    db.refresh(n)
    return n


@router.delete("/{notification_id}", status_code=204)
def delete_notification(notification_id: int, db: Session = Depends(get_db)):
    n = db.query(NotificationModel).filter(NotificationModel.NotificationId == notification_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    db.delete(n)
    db.commit()
