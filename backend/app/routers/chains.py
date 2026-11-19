"""Cadenas y banderas (eje "de quién es el PDV", independiente de canal › subcanal).

GET /chains (selects del alta de PDV, offline-first): cualquier usuario autenticado,
solo datos públicos (sin responsable ni cantidades).
GET /chains/all, GET /chains/{id} y escritura: territory_manager+. Fusión: solo admin.
Reglas y auditoría en app/services/chains.py.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import require_role
from ..database import get_db
from ..models import PDV, Channel, User as UserModel
from ..models.chain import Chain as ChainModel
from ..schemas.chain import ChainAdmin, ChainCreate, ChainMerge, ChainPublic, ChainUpdate
from ..services import chains as svc

router = APIRouter(prefix="/chains", tags=["Cadenas"])


def _get_or_404(db: Session, chain_id: int) -> ChainModel:
    c = db.query(ChainModel).filter(ChainModel.ChainId == chain_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cadena no encontrada")
    return c


def _check_manager(db: Session, user_id: int | None) -> None:
    if user_id is None:
        return
    u = db.query(UserModel).filter(UserModel.UserId == user_id).first()
    if not u or not u.IsActive:
        raise HTTPException(status_code=422, detail="El responsable de la cuenta no existe o está inactivo")


def _admin_rows(db: Session, chains: list[ChainModel]) -> list[ChainAdmin]:
    """Enriquecido en 4 queries fijas (sin N+1)."""
    if not chains:
        return []
    ids = [c.ChainId for c in chains]
    counts = dict(
        db.query(PDV.ChainId, func.count(PDV.PdvId))
        .filter(PDV.ChainId.in_(ids), PDV.IsActive == True)  # noqa: E712
        .group_by(PDV.ChainId).all()
    )
    ch_names = dict(db.query(Channel.ChannelId, Channel.Name).filter(
        Channel.ChannelId.in_({c.ChannelId for c in chains})).all())
    mgr_ids = {c.AccountManagerUserId for c in chains if c.AccountManagerUserId}
    mgr_names = dict(db.query(UserModel.UserId, UserModel.DisplayName).filter(
        UserModel.UserId.in_(mgr_ids)).all()) if mgr_ids else {}
    out = []
    for c in chains:
        n = counts.get(c.ChainId, 0)
        eff = c.StoreCount if c.StoreCount is not None else n
        row = ChainAdmin.model_validate(c)
        row.ChannelName = ch_names.get(c.ChannelId)
        row.AccountManagerName = mgr_names.get(c.AccountManagerUserId)
        row.PdvCount = n
        row.EffectiveStoreCount = eff
        row.SizeBucket = svc.BUCKET_LABELS[svc.size_bucket(eff)] if c.Kind == svc.KIND_CADENA else None
        out.append(row)
    return out


def _commit_or_409(db: Session) -> None:
    """UNIQUE (ChannelId, Name) en carrera (dos altas a la vez) → 409, no 500."""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ya existe una cadena con ese nombre en ese canal")


@router.get("", response_model=list[ChainPublic])
def list_chains(channel_id: int | None = None, kind: str | None = None, db: Session = Depends(get_db)):
    """Cadenas activas (para los selects del alta/edición de PDV; se cachea offline)."""
    q = db.query(ChainModel).filter(ChainModel.IsActive == True)  # noqa: E712
    if channel_id is not None:
        q = q.filter(ChainModel.ChannelId == channel_id)
    if kind:
        q = q.filter(ChainModel.Kind == kind)
    return q.order_by(ChainModel.Name).all()


@router.get("/all", response_model=list[ChainAdmin])
def list_all_chains(
    channel_id: int | None = None,
    _user: UserModel = Depends(require_role("territory_manager")),
    db: Session = Depends(get_db),
):
    """Todas (incl. inactivas) con conteo de PDVs, responsable y tamaño — gestión admin."""
    q = db.query(ChainModel)
    if channel_id is not None:
        q = q.filter(ChainModel.ChannelId == channel_id)
    return _admin_rows(db, q.order_by(ChainModel.Name).all())


@router.get("/{chain_id}", response_model=ChainAdmin)
def get_chain(
    chain_id: int,
    _user: UserModel = Depends(require_role("territory_manager")),
    db: Session = Depends(get_db),
):
    return _admin_rows(db, [_get_or_404(db, chain_id)])[0]


@router.post("", response_model=ChainAdmin, status_code=201)
def create_chain(
    data: ChainCreate,
    current_user: UserModel = Depends(require_role("territory_manager")),
    db: Session = Depends(get_db),
):
    if not db.query(Channel).filter(Channel.ChannelId == data.ChannelId).first():
        raise HTTPException(status_code=422, detail="Canal no encontrado")
    dup = svc.find_duplicate(db, data.ChannelId, data.Name)
    if dup:
        if svc.norm(dup.Name) != svc.norm(data.Name):
            raise HTTPException(status_code=409, detail=f"'{data.Name}' ya es un alias de la cadena '{dup.Name}'")
        estado = "" if dup.IsActive else " (inactiva: reactivala en vez de crear otra)"
        raise HTTPException(status_code=409, detail=f"Ya existe la cadena '{dup.Name}' en ese canal{estado}")
    _check_manager(db, data.AccountManagerUserId)
    c = ChainModel(**data.model_dump())
    db.add(c)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ya existe una cadena con ese nombre en ese canal")
    svc.audit(db, current_user, "Chain", c.ChainId, "CHAIN_CREATE", {"after": svc.chain_snapshot(c)})
    _commit_or_409(db)
    db.refresh(c)
    return _admin_rows(db, [c])[0]


@router.patch("/{chain_id}", response_model=ChainAdmin)
def update_chain(
    chain_id: int,
    data: ChainUpdate,
    current_user: UserModel = Depends(require_role("territory_manager")),
    db: Session = Depends(get_db),
):
    """Edición parcial. AccountManagerUserId / StoreCount / Aliases aceptan null
    explícito para limpiarse (se distingue "no enviado" con exclude_unset)."""
    c = _get_or_404(db, chain_id)
    dump = data.model_dump(exclude_unset=True)
    for required in ("Name", "Kind", "IsKeyAccount", "IsActive"):
        if required in dump and dump[required] is None:
            dump.pop(required)
    if "Name" in dump and svc.norm(dump["Name"]) != svc.norm(c.Name):
        dup = svc.find_duplicate(db, c.ChannelId, dump["Name"], exclude_id=c.ChainId)
        if dup:
            detalle = (f"Ya existe la cadena '{dup.Name}' en ese canal" if svc.norm(dup.Name) == svc.norm(dump["Name"])
                       else f"'{dump['Name']}' ya es un alias de la cadena '{dup.Name}'")
            raise HTTPException(status_code=409, detail=detalle)
    if dump.get("IsActive") is True and not c.IsActive:
        # Reactivar una cadena fusionada: su nombre quedó como alias de la que la absorbió
        owner = svc.find_alias_owner(db, c.ChannelId, dump.get("Name") or c.Name, exclude_id=c.ChainId)
        if owner:
            raise HTTPException(status_code=409, detail=(
                f"'{c.Name}' fue fusionada en '{owner.Name}' (es un alias suyo). "
                f"Sacale ese alias a '{owner.Name}' antes de reactivarla."))
    if dump.get("AccountManagerUserId") is not None and dump["AccountManagerUserId"] != c.AccountManagerUserId:
        _check_manager(db, dump["AccountManagerUserId"])
    before = svc.chain_snapshot(c)
    for k, v in dump.items():
        setattr(c, k, v)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ya existe una cadena con ese nombre en ese canal")
    after = svc.chain_snapshot(c)
    if after != before:
        action = "CHAIN_DEACTIVATE" if before["IsActive"] and not after["IsActive"] else "CHAIN_UPDATE"
        svc.audit(db, current_user, "Chain", c.ChainId, action, {"before": before, "after": after})
        # StoreCount / Kind pueden mover el tamaño → re-derivar subcanal de sus PDVs
        svc.sync_chain_bucket(db, c, current_user)
    _commit_or_409(db)
    db.refresh(c)
    return _admin_rows(db, [c])[0]


@router.delete("/{chain_id}", status_code=204)
def delete_chain(
    chain_id: int,
    current_user: UserModel = Depends(require_role("territory_manager")),
    db: Session = Depends(get_db),
):
    """Baja lógica. Los PDVs conservan su ChainId (histórico); deja de ofrecerse en el alta."""
    c = _get_or_404(db, chain_id)
    if c.IsActive:
        before = svc.chain_snapshot(c)
        c.IsActive = False
        svc.audit(db, current_user, "Chain", c.ChainId, "CHAIN_DEACTIVATE",
                  {"before": before, "after": svc.chain_snapshot(c), "pdvs": svc.pdv_count(db, c.ChainId)})
        db.commit()


@router.post("/{chain_id}/merge", response_model=ChainAdmin)
def merge_chain(
    chain_id: int,
    data: ChainMerge,
    current_user: UserModel = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Fusiona la cadena {chain_id} (origen) DENTRO de TargetChainId: repunta sus PDVs,
    desactiva el origen y guarda su nombre y alias como alias del destino."""
    src = _get_or_404(db, chain_id)
    if data.TargetChainId == chain_id:
        raise HTTPException(status_code=422, detail="No se puede fusionar una cadena con sí misma")
    dst = db.query(ChainModel).filter(ChainModel.ChainId == data.TargetChainId).first()
    if not dst:
        raise HTTPException(status_code=404, detail="Cadena destino no encontrada")
    if not dst.IsActive:
        raise HTTPException(status_code=422, detail="La cadena destino está inactiva")
    if dst.ChannelId != src.ChannelId or dst.Kind != src.Kind:
        raise HTTPException(status_code=422, detail="Solo se fusionan cadenas del mismo canal y tipo")

    before = {"source": svc.chain_snapshot(src), "target": svc.chain_snapshot(dst)}
    pdv_ids = [r[0] for r in db.query(PDV.PdvId).filter(PDV.ChainId == src.ChainId).order_by(PDV.PdvId).all()]
    if pdv_ids:
        db.query(PDV).filter(PDV.ChainId == src.ChainId).update(
            {PDV.ChainId: dst.ChainId}, synchronize_session=False)
    dst.Aliases = svc.add_alias(dst.Aliases, src.Name, src.Aliases or "")
    src.IsActive = False
    db.flush()
    svc.sync_chain_bucket(db, dst, current_user)
    payload = {
        "sourceChainId": src.ChainId, "targetChainId": dst.ChainId, "before": before,
        "after": {"source": svc.chain_snapshot(src), "target": svc.chain_snapshot(dst)},
        "pdvCount": len(pdv_ids), "pdvIds": pdv_ids,
    }
    # Una fila por cadena: la fusión aparece en el historial de ambas.
    svc.audit(db, current_user, "Chain", src.ChainId, "CHAIN_MERGE", payload)
    svc.audit(db, current_user, "Chain", dst.ChainId, "CHAIN_MERGE", payload)
    db.commit()
    db.refresh(dst)
    return _admin_rows(db, [dst])[0]
