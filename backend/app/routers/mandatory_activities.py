from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..auth import require_role, get_current_user
from ..database import get_db
from ..models.mandatory_activity import MandatoryActivity as MAModel
from ..models import User as UserModel

router = APIRouter(prefix="/mandatory-activities", tags=["Actividades Mandatorias"])


@router.get("")
def list_mandatory_activities(
    channel_id: int | None = None,
    route_id: int | None = None,
    active_only: bool = True,
    current_only: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(MAModel)
    if active_only:
        q = q.filter(MAModel.IsActive == True)
    if channel_id is not None:
        q = q.filter((MAModel.ChannelId == channel_id) | (MAModel.ChannelId.is_(None)))
    if route_id is not None:
        q = q.filter((MAModel.RouteId == route_id) | (MAModel.RouteId.is_(None)))
    if current_only:
        today = date.today()
        q = q.filter(
            (MAModel.ValidFrom.is_(None)) | (MAModel.ValidFrom <= today)
        ).filter(
            (MAModel.ValidTo.is_(None)) | (MAModel.ValidTo >= today)
        )
    rows = q.order_by(MAModel.MandatoryActivityId).all()
    return [_serialize(r) for r in rows]


@router.get("/{ma_id}")
def get_mandatory_activity(ma_id: int, db: Session = Depends(get_db)):
    r = db.query(MAModel).filter(MAModel.MandatoryActivityId == ma_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Actividad mandatoria no encontrada")
    return _serialize(r)


@router.post("", status_code=201, dependencies=[Depends(require_role("territory_manager"))])
def create_mandatory_activity(
    data: dict,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    r = MAModel(
        Name=data["Name"],
        ActionType=data.get("ActionType", "otra"),
        Description=data.get("Description"),
        DetailsJson=data.get("DetailsJson"),
        PhotoRequired=data.get("PhotoRequired", True),
        ChannelId=data.get("ChannelId"),
        RouteId=data.get("RouteId"),
        FormId=data.get("FormId"),
        ValidFrom=date.fromisoformat(data["ValidFrom"]) if data.get("ValidFrom") else None,
        ValidTo=date.fromisoformat(data["ValidTo"]) if data.get("ValidTo") else None,
        CreatedByUserId=current_user.UserId,
        IsActive=data.get("IsActive", True),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _serialize(r)


@router.patch("/{ma_id}", dependencies=[Depends(require_role("territory_manager"))])
def update_mandatory_activity(ma_id: int, data: dict, db: Session = Depends(get_db)):
    r = db.query(MAModel).filter(MAModel.MandatoryActivityId == ma_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Actividad mandatoria no encontrada")
    for k in ("Name", "ActionType", "Description", "DetailsJson", "PhotoRequired",
              "ChannelId", "RouteId", "FormId", "ValidFrom", "ValidTo", "IsActive"):
        if k in data:
            val = data[k]
            if k in ("ValidFrom", "ValidTo") and isinstance(val, str) and val:
                val = date.fromisoformat(val)
            setattr(r, k, val)
    db.commit()
    db.refresh(r)
    return _serialize(r)


@router.delete("/{ma_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_mandatory_activity(ma_id: int, db: Session = Depends(get_db)):
    r = db.query(MAModel).filter(MAModel.MandatoryActivityId == ma_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Actividad mandatoria no encontrada")
    db.delete(r)
    db.commit()


def _serialize(r: MAModel) -> dict:
    return {
        "MandatoryActivityId": r.MandatoryActivityId,
        "Name": r.Name,
        "ActionType": r.ActionType,
        "Description": r.Description,
        "DetailsJson": r.DetailsJson,
        "PhotoRequired": r.PhotoRequired,
        "ChannelId": r.ChannelId,
        "RouteId": r.RouteId,
        "FormId": r.FormId,
        "ValidFrom": r.ValidFrom.isoformat() if r.ValidFrom else None,
        "ValidTo": r.ValidTo.isoformat() if r.ValidTo else None,
        "CreatedByUserId": r.CreatedByUserId,
        "IsActive": r.IsActive,
        "CreatedAt": r.CreatedAt.isoformat() if r.CreatedAt else None,
    }
