from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import require_role
from ..models import Channel as ChannelModel
from ..models.channel import SubChannel as SubChannelModel
from ..schemas.channel import Channel, ChannelCreate, ChannelUpdate

router = APIRouter(prefix="/channels", tags=["Canales"])


@router.get("", response_model=list[Channel])
def list_channels(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return (
        db.query(ChannelModel)
        .filter(ChannelModel.IsActive == True)
        .order_by(ChannelModel.Name)
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/all", response_model=list[Channel])
def list_all_channels(skip: int = 0, limit: int = 200, db: Session = Depends(get_db)):
    """Lista todos los canales (incl. inactivos) para admin."""
    return db.query(ChannelModel).order_by(ChannelModel.Name).offset(skip).limit(limit).all()


@router.get("/{channel_id}", response_model=Channel)
def get_channel(channel_id: int, db: Session = Depends(get_db)):
    ch = db.query(ChannelModel).filter(ChannelModel.ChannelId == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Canal no encontrado")
    return ch


@router.post("", response_model=Channel, status_code=201, dependencies=[Depends(require_role("territory_manager"))])
def create_channel(data: ChannelCreate, db: Session = Depends(get_db)):
    ch = ChannelModel(Name=data.Name, Description=data.Description, IsActive=data.IsActive)
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


@router.patch("/{channel_id}", response_model=Channel, dependencies=[Depends(require_role("territory_manager"))])
def update_channel(channel_id: int, data: ChannelUpdate, db: Session = Depends(get_db)):
    ch = db.query(ChannelModel).filter(ChannelModel.ChannelId == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Canal no encontrado")
    if data.Name is not None:
        ch.Name = data.Name
    if data.Description is not None:
        ch.Description = data.Description
    if data.IsActive is not None:
        ch.IsActive = data.IsActive
    db.commit()
    db.refresh(ch)
    return ch


@router.delete("/{channel_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_channel(channel_id: int, hard: bool = False, db: Session = Depends(get_db)):
    ch = db.query(ChannelModel).filter(ChannelModel.ChannelId == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Canal no encontrado")
    if hard:
        # Delete subchannels first, then the channel
        db.query(SubChannelModel).filter(SubChannelModel.ChannelId == channel_id).delete()
        db.delete(ch)
    else:
        ch.IsActive = False
    db.commit()
