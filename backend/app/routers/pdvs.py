import uuid
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import PDV as PDVModel, Channel, SubChannel, PdvContact as PdvContactModel, Distributor
from ..models.pdv import PdvDistributor as PdvDistributorModel
from ..schemas.pdv import Pdv, PdvCreate, PdvUpdate, PdvContactCreate, DistributorInfo
from ..schemas.pdv_contact import PdvContact
from ..auth import require_role

router = APIRouter(prefix="/pdvs", tags=["PDVs"])


def _sync_distributors(db: Session, pdv_id: int, distributor_ids: list[int]):
    """Replace all distributor associations for a PDV."""
    db.query(PdvDistributorModel).filter(PdvDistributorModel.PdvId == pdv_id).delete()
    for did in distributor_ids:
        db.add(PdvDistributorModel(PdvId=pdv_id, DistributorId=did))


def _get_distributors(db: Session, pdv_id: int) -> list[DistributorInfo]:
    """Get distributor list for a PDV."""
    rows = (
        db.query(Distributor)
        .join(PdvDistributorModel, PdvDistributorModel.DistributorId == Distributor.DistributorId)
        .filter(PdvDistributorModel.PdvId == pdv_id)
        .order_by(Distributor.Name)
        .all()
    )
    return [DistributorInfo(DistributorId=r.DistributorId, Name=r.Name) for r in rows]


def _pdv_to_response(pdv: PDVModel, db: Session) -> dict:
    """Construye la respuesta Pdv con ChannelName, SubChannelName, Contacts y Distributors."""
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

    distributors = _get_distributors(db, pdv.PdvId)

    return Pdv(
        PdvId=pdv.PdvId,
        Code=pdv.Code,
        Name=pdv.Name,
        BusinessName=getattr(pdv, "BusinessName", None),
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
        OpeningTime=getattr(pdv, "OpeningTime", None),
        ClosingTime=getattr(pdv, "ClosingTime", None),
        TimeSlotsJson=getattr(pdv, "TimeSlotsJson", None),
        VisitDay=getattr(pdv, "VisitDay", None),
        DefaultMaterialExternalId=pdv.DefaultMaterialExternalId,
        AssignedUserId=getattr(pdv, "AssignedUserId", None),
        IsActive=pdv.IsActive,
        InactiveReason=getattr(pdv, "InactiveReason", None),
        ReactivateOn=getattr(pdv, "ReactivateOn", None),
        ChannelName=channel_name,
        SubChannelName=subchannel_name,
        Contacts=[PdvContact.model_validate(c) for c in contacts],
        Distributors=distributors,
        CreatedAt=pdv.CreatedAt,
        UpdatedAt=pdv.UpdatedAt,
    )


@router.get("", response_model=list[Pdv])
def list_pdvs(
    skip: int = 0,
    limit: int = Query(default=100, le=500),
    zone_id: int | None = None,
    distributor_id: int | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(PDVModel)
    if zone_id is not None:
        q = q.filter(PDVModel.ZoneId == zone_id)
    if distributor_id is not None:
        # Filter by junction table or legacy field
        pdv_ids_with_dist = (
            db.query(PdvDistributorModel.PdvId)
            .filter(PdvDistributorModel.DistributorId == distributor_id)
            .subquery()
        )
        q = q.filter(
            PDVModel.PdvId.in_(pdv_ids_with_dist) | (PDVModel.DistributorId == distributor_id)
        )
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

    # Use first distributor as legacy DistributorId for backward compat
    legacy_dist_id = data.DistributorId
    if not legacy_dist_id and data.DistributorIds:
        legacy_dist_id = data.DistributorIds[0]

    pdv = PDVModel(
        Code=code,
        Name=data.Name,
        BusinessName=data.BusinessName,
        Channel=channel_name,
        ChannelId=data.ChannelId,
        SubChannelId=data.SubChannelId,
        Address=data.Address,
        City=data.City,
        ZoneId=data.ZoneId,
        DistributorId=legacy_dist_id,
        Lat=data.Lat,
        Lon=data.Lon,
        OpeningTime=data.OpeningTime,
        ClosingTime=data.ClosingTime,
        VisitDay=data.VisitDay,
        DefaultMaterialExternalId=data.DefaultMaterialExternalId,
        IsActive=data.IsActive,
    )
    db.add(pdv)
    db.flush()

    # Sync distributors junction table
    dist_ids = data.DistributorIds or ([data.DistributorId] if data.DistributorId else [])
    if dist_ids:
        _sync_distributors(db, pdv.PdvId, dist_ids)

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
                ContactRole=c.ContactRole,
                DecisionPower=c.DecisionPower,
                Birthday=bd,
                Notes=c.Notes,
                ProfileNotes=c.ProfileNotes,
            )
            db.add(pc)
    db.commit()
    db.refresh(pdv)
    return _pdv_to_response(pdv, db)


@router.patch("/{pdv_id}", response_model=Pdv)
def update_pdv(pdv_id: int, data: PdvUpdate, db: Session = Depends(get_db)):
    from datetime import datetime, timedelta, timezone

    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")

    dump = data.model_dump(exclude_unset=True)
    contacts_data = dump.pop("Contacts", None)
    distributor_ids = dump.pop("DistributorIds", None)

    # Detectar transición Activo → Inactivo
    new_is_active = dump.get("IsActive")
    transitioning_to_inactive = (
        new_is_active is False and pdv.IsActive is True
    )
    transitioning_to_active = (
        new_is_active is True and pdv.IsActive is False
    )

    for k, v in dump.items():
        if k == "ChannelId" and v is not None:
            ch = db.query(Channel).filter(Channel.ChannelId == v).first()
            if ch:
                pdv.Channel = ch.Name
        setattr(pdv, k, v)

    # Si estamos desactivando: setear InactiveSince y, si no vino, ReactivateOn = +60d
    if transitioning_to_inactive:
        now = datetime.now(timezone.utc)
        pdv.InactiveSince = now
        if not pdv.ReactivateOn:
            pdv.ReactivateOn = (now + timedelta(days=60)).date()

    # Si estamos reactivando: limpiar todo lo de inactivo
    if transitioning_to_active:
        pdv.InactiveSince = None
        pdv.InactiveReason = None
        pdv.ReactivateOn = None

    # Sync distributors if provided
    if distributor_ids is not None:
        _sync_distributors(db, pdv_id, distributor_ids)
        # Keep legacy field in sync
        pdv.DistributorId = distributor_ids[0] if distributor_ids else None

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
                ContactRole=c.get("ContactRole"),
                DecisionPower=c.get("DecisionPower"),
                Birthday=bd,
                Notes=c.get("Notes"),
                ProfileNotes=c.get("ProfileNotes"),
            )
            db.add(pc)

    db.commit()
    db.refresh(pdv)
    return _pdv_to_response(pdv, db)


@router.delete("/{pdv_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_pdv(pdv_id: int, db: Session = Depends(get_db)):
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")
    db.query(PdvDistributorModel).filter(PdvDistributorModel.PdvId == pdv_id).delete()
    db.query(PdvContactModel).filter(PdvContactModel.PdvId == pdv_id).delete()
    db.delete(pdv)
    db.commit()
