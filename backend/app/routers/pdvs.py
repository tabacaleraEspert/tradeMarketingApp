import uuid
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import PDV as PDVModel, Channel, SubChannel, PdvContact as PdvContactModel
from ..schemas.pdv import Pdv, PdvCreate, PdvUpdate, PdvContactCreate
from ..schemas.pdv_contact import PdvContact

router = APIRouter(prefix="/pdvs", tags=["PDVs"])


def _pdv_to_response(pdv: PDVModel, db: Session) -> dict:
    """Construye la respuesta Pdv con ChannelName, SubChannelName y Contacts."""
    channel_name = None
    subchannel_name = None
    if pdv.ChannelId:
        ch = db.query(Channel).filter(Channel.ChannelId == pdv.ChannelId).first()
        if ch:
            channel_name = ch.Name
    if pdv.SubChannelId:
        sc = db.query(SubChannel).filter(SubChannel.SubChannelId == pdv.SubChannelId).first()
        if sc:
            subchannel_name = sc.Name
    if channel_name is None and pdv.Channel:
        channel_name = pdv.Channel

    contacts = (
        db.query(PdvContactModel)
        .filter(PdvContactModel.PdvId == pdv.PdvId)
        .order_by(PdvContactModel.PdvContactId)
        .all()
    )

    return Pdv(
        PdvId=pdv.PdvId,
        Code=pdv.Code,
        Name=pdv.Name,
        Channel=pdv.Channel,
        ChannelId=pdv.ChannelId,
        SubChannelId=pdv.SubChannelId,
        Address=pdv.Address,
        City=pdv.City,
        ZoneId=pdv.ZoneId,
        DistributorId=pdv.DistributorId,
        Lat=pdv.Lat,
        Lon=pdv.Lon,
        ContactName=pdv.ContactName,
        ContactPhone=pdv.ContactPhone,
        DefaultMaterialExternalId=pdv.DefaultMaterialExternalId,
        IsActive=pdv.IsActive,
        ChannelName=channel_name,
        SubChannelName=subchannel_name,
        Contacts=[PdvContact.model_validate(c) for c in contacts],
        CreatedAt=pdv.CreatedAt,
        UpdatedAt=pdv.UpdatedAt,
    )


@router.get("", response_model=list[Pdv])
def list_pdvs(
    skip: int = 0,
    limit: int = 100,
    zone_id: int | None = None,
    distributor_id: int | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(PDVModel)
    if zone_id is not None:
        q = q.filter(PDVModel.ZoneId == zone_id)
    if distributor_id is not None:
        q = q.filter(PDVModel.DistributorId == distributor_id)
    pdvs = q.order_by(PDVModel.PdvId).offset(skip).limit(limit).all()
    return [_pdv_to_response(p, db) for p in pdvs]


@router.get("/{pdv_id}", response_model=Pdv)
def get_pdv(pdv_id: int, db: Session = Depends(get_db)):
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")
    return _pdv_to_response(pdv, db)


@router.post("", response_model=Pdv, status_code=201)
def create_pdv(data: PdvCreate, db: Session = Depends(get_db)):
    code = data.Code or f"PDV-{uuid.uuid4().hex[:12].upper()}"
    channel = db.query(Channel).filter(Channel.ChannelId == data.ChannelId).first()
    if not channel:
        raise HTTPException(status_code=400, detail="Canal no encontrado")
    channel_name = channel.Name

    pdv = PDVModel(
        Code=code,
        Name=data.Name,
        Channel=channel_name,
        ChannelId=data.ChannelId,
        SubChannelId=data.SubChannelId,
        Address=data.Address,
        City=data.City,
        ZoneId=data.ZoneId,
        DistributorId=data.DistributorId,
        Lat=data.Lat,
        Lon=data.Lon,
        DefaultMaterialExternalId=data.DefaultMaterialExternalId,
        IsActive=data.IsActive,
    )
    db.add(pdv)
    db.flush()

    if data.Contacts:
        for c in data.Contacts:
            bd = c.Birthday
            if isinstance(bd, str) and bd:
                try:
                    bd = date.fromisoformat(bd)
                except ValueError:
                    bd = None
            pc = PdvContactModel(
                PdvId=pdv.PdvId,
                ContactName=c.ContactName,
                ContactPhone=c.ContactPhone,
                Birthday=bd,
            )
            db.add(pc)
    db.commit()
    db.refresh(pdv)
    return _pdv_to_response(pdv, db)


@router.patch("/{pdv_id}", response_model=Pdv)
def update_pdv(pdv_id: int, data: PdvUpdate, db: Session = Depends(get_db)):
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")

    dump = data.model_dump(exclude_unset=True)
    contacts_data = dump.pop("Contacts", None)

    for k, v in dump.items():
        if k == "ChannelId" and v is not None:
            ch = db.query(Channel).filter(Channel.ChannelId == v).first()
            if ch:
                pdv.Channel = ch.Name
        setattr(pdv, k, v)

    if contacts_data is not None:
        db.query(PdvContactModel).filter(PdvContactModel.PdvId == pdv_id).delete()
        for c in contacts_data:
            bd = c.get("Birthday")
            if isinstance(bd, str) and bd:
                try:
                    bd = date.fromisoformat(bd)
                except ValueError:
                    bd = None
            pc = PdvContactModel(
                PdvId=pdv_id,
                ContactName=c["ContactName"],
                ContactPhone=c.get("ContactPhone"),
                Birthday=bd,
            )
            db.add(pc)

    db.commit()
    db.refresh(pdv)
    return _pdv_to_response(pdv, db)


@router.delete("/{pdv_id}", status_code=204)
def delete_pdv(pdv_id: int, db: Session = Depends(get_db)):
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")
    db.query(PdvContactModel).filter(PdvContactModel.PdvId == pdv_id).delete()
    db.delete(pdv)
    db.commit()
