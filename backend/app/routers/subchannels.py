from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import require_role
from ..models import SubChannel as SubChannelModel
from ..schemas.channel import SubChannel, SubChannelCreate, SubChannelUpdate

router = APIRouter(prefix="/subchannels", tags=["Subcanales"])


@router.get("", response_model=list[SubChannel])
def list_subchannels(
    channel_id: int | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    q = db.query(SubChannelModel).filter(SubChannelModel.IsActive == True)
    if channel_id is not None:
        q = q.filter(SubChannelModel.ChannelId == channel_id)
    return q.order_by(SubChannelModel.Name).offset(skip).limit(limit).all()


@router.get("/all", response_model=list[SubChannel])
def list_all_subchannels(
    channel_id: int | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    """Lista todos los subcanales (incl. inactivos) para admin."""
    q = db.query(SubChannelModel)
    if channel_id is not None:
        q = q.filter(SubChannelModel.ChannelId == channel_id)
    return q.order_by(SubChannelModel.Name).offset(skip).limit(limit).all()


@router.get("/{subchannel_id}", response_model=SubChannel)
def get_subchannel(subchannel_id: int, db: Session = Depends(get_db)):
    sc = db.query(SubChannelModel).filter(SubChannelModel.SubChannelId == subchannel_id).first()
    if not sc:
        raise HTTPException(status_code=404, detail="Subcanal no encontrado")
    return sc


@router.post("", response_model=SubChannel, status_code=201, dependencies=[Depends(require_role("territory_manager"))])
def create_subchannel(data: SubChannelCreate, db: Session = Depends(get_db)):
    sc = SubChannelModel(
        ChannelId=data.ChannelId,
        Name=data.Name,
        IsActive=data.IsActive,
    )
    db.add(sc)
    db.commit()
    db.refresh(sc)
    return sc


@router.patch("/{subchannel_id}", response_model=SubChannel, dependencies=[Depends(require_role("territory_manager"))])
def update_subchannel(subchannel_id: int, data: SubChannelUpdate, db: Session = Depends(get_db)):
    sc = db.query(SubChannelModel).filter(SubChannelModel.SubChannelId == subchannel_id).first()
    if not sc:
        raise HTTPException(status_code=404, detail="Subcanal no encontrado")
    if data.ChannelId is not None:
        sc.ChannelId = data.ChannelId
    if data.Name is not None:
        sc.Name = data.Name
    if data.IsActive is not None:
        sc.IsActive = data.IsActive
    db.commit()
    db.refresh(sc)
    return sc


@router.delete("/{subchannel_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_subchannel(subchannel_id: int, db: Session = Depends(get_db)):
    sc = db.query(SubChannelModel).filter(SubChannelModel.SubChannelId == subchannel_id).first()
    if not sc:
        raise HTTPException(status_code=404, detail="Subcanal no encontrado")
    sc.IsActive = False
    db.commit()
