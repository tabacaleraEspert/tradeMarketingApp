import uuid
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func as sqlfunc, or_
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import PDV as PDVModel, Channel, SubChannel, PdvContact as PdvContactModel, Distributor
from ..models import User as UserModel
from ..models.pdv import PdvDistributor as PdvDistributorModel
from ..models.route import Route as RouteModel, RoutePdv as RoutePdvModel, RouteDayPdv as RouteDayPdvModel
from ..models.pdv import PdvPhoto as PdvPhotoModel, PdvAssignment as PdvAssignmentModel
from ..models.pdv_kpi import PdvKpiSnapshot as PdvKpiModel
from ..models.pdv_note import PdvNote as PdvNoteModel
from ..models.pdv_product_category import PdvProductCategory as PdvProductCategoryModel
from ..models.pdv_supplier import PdvSupplier as PdvSupplierModel
from ..models.visit import Visit as VisitModel, VisitCheck, VisitAnswer, VisitPhoto as VisitPhotoModel
from ..models.visit_action import VisitAction as VisitActionModel
from ..models.visit_coverage import VisitCoverage as VisitCoverageModel
from ..models.visit_loose import VisitLooseSurvey as VisitLooseModel
from ..models.visit_pop import VisitPOPItem as VisitPOPModel
from ..models.visit_form_time import VisitFormTime as VisitFormTimeModel
from ..models.market_news import MarketNews as MarketNewsModel
from ..models.incident import Incident as IncidentModel
from ..schemas.pdv import Pdv, PdvCreate, PdvUpdate, PdvContactCreate, DistributorInfo, volume_to_category
from ..schemas.pdv_contact import PdvContact
from ..auth import require_role, get_current_user, get_user_role, ROLE_HIERARCHY
from ..hierarchy import visible_pdv_ids
from ..utils.pagination import PageParams, paginate, make_page
from ..utils.geo_zones import zone_id_from_coords

router = APIRouter(prefix="/pdvs", tags=["PDVs"])


def _visible_pdv_ids(db: Session, user: UserModel) -> set[int] | None:
    """Return the set of PdvIds visible to this user, or None if they can see all.

    Delega en el helper unificado de hierarchy (sub-árbol completo + uno mismo;
    admin = None). Reemplaza la lógica vieja que dejaba ver todo a regional_manager,
    solo expandía a reportes directos del territory_manager e ignoraba a ejecutivos.
    """
    return visible_pdv_ids(db, user)


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


def _pdvs_to_response_batch(pdvs: list[PDVModel], db: Session) -> list[dict]:
    """Batch version: preloads channels, subchannels, contacts, distributors in 4 queries instead of N*4."""
    if not pdvs:
        return []

    pdv_ids = [p.PdvId for p in pdvs]
    ch_ids = {p.ChannelId for p in pdvs if p.ChannelId}
    sc_ids = {p.SubChannelId for p in pdvs if p.SubChannelId}

    ch_map = {c.ChannelId: c.Name for c in db.query(Channel).filter(Channel.ChannelId.in_(ch_ids)).all()} if ch_ids else {}
    sc_map = {s.SubChannelId: s.Name for s in db.query(SubChannel).filter(SubChannel.SubChannelId.in_(sc_ids)).all()} if sc_ids else {}

    all_contacts = db.query(PdvContactModel).filter(PdvContactModel.PdvId.in_(pdv_ids)).order_by(PdvContactModel.PdvContactId).all()
    contacts_map: dict[int, list] = {}
    for c in all_contacts:
        contacts_map.setdefault(c.PdvId, []).append(c)

    all_pd = (
        db.query(PdvDistributorModel, Distributor)
        .join(Distributor, Distributor.DistributorId == PdvDistributorModel.DistributorId)
        .filter(PdvDistributorModel.PdvId.in_(pdv_ids))
        .order_by(Distributor.Name)
        .all()
    )
    dist_map: dict[int, list] = {}
    for pd, d in all_pd:
        dist_map.setdefault(pd.PdvId, []).append(DistributorInfo(DistributorId=d.DistributorId, Name=d.Name))

    result = []
    for pdv in pdvs:
        channel_name = ch_map.get(pdv.ChannelId) if pdv.ChannelId else None
        if channel_name is None and pdv.Channel:
            channel_name = pdv.Channel
        subchannel_name = sc_map.get(pdv.SubChannelId) if pdv.SubChannelId else None

        result.append(Pdv(
            PdvId=pdv.PdvId, Code=pdv.Code, Name=pdv.Name,
            BusinessName=getattr(pdv, "BusinessName", None),
            Channel=pdv.Channel, ChannelId=pdv.ChannelId, SubChannelId=pdv.SubChannelId,
            Address=pdv.Address, City=pdv.City, ZoneId=pdv.ZoneId,
            DistributorId=pdv.DistributorId, Lat=pdv.Lat, Lon=pdv.Lon,
            ContactName=pdv.ContactName, ContactPhone=pdv.ContactPhone,
            OpeningTime=getattr(pdv, "OpeningTime", None),
            ClosingTime=getattr(pdv, "ClosingTime", None),
            TimeSlotsJson=getattr(pdv, "TimeSlotsJson", None),
            VisitDay=getattr(pdv, "VisitDay", None),
            DefaultMaterialExternalId=pdv.DefaultMaterialExternalId,
            AssignedUserId=getattr(pdv, "AssignedUserId", None),
            WorksEspertProducts=getattr(pdv, "WorksEspertProducts", None),
            SellsLooseCigarettes=getattr(pdv, "SellsLooseCigarettes", None),
            MonthlyVolume=getattr(pdv, "MonthlyVolume", None),
            Category=getattr(pdv, "Category", None),
            IsActive=pdv.IsActive,
            InactiveReason=getattr(pdv, "InactiveReason", None),
            ReactivateOn=getattr(pdv, "ReactivateOn", None),
            SupplierTypes=getattr(pdv, "SupplierTypes", "").split(",") if getattr(pdv, "SupplierTypes", None) else None,
            CreatedAt=getattr(pdv, "CreatedAt", None),
            UpdatedAt=getattr(pdv, "UpdatedAt", None),
            ChannelName=channel_name, SubChannelName=subchannel_name,
            Contacts=[PdvContact.model_validate(c) for c in contacts_map.get(pdv.PdvId, [])],
            Distributors=dist_map.get(pdv.PdvId, []),
        ).model_dump())
    return result


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
        WorksEspertProducts=getattr(pdv, "WorksEspertProducts", None),
        SellsLooseCigarettes=getattr(pdv, "SellsLooseCigarettes", None),
        MonthlyVolume=getattr(pdv, "MonthlyVolume", None),
        Category=getattr(pdv, "Category", None),
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


@router.get("")
def list_pdvs(
    skip: int = 0,
    limit: int = Query(default=50, le=1000),
    zone_id: int | None = None,
    distributor_id: int | None = None,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(PDVModel)

    # Role-based visibility filter
    visible = _visible_pdv_ids(db, current_user)
    if visible is not None:
        q = q.filter(PDVModel.PdvId.in_(visible)) if visible else q.filter(False)

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
    total = q.count()
    pdvs = q.order_by(PDVModel.PdvId).offset(skip).limit(limit).all()
    items = _pdvs_to_response_batch(pdvs, db)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


def _tri_state_filter(query, column, value: str | None):
    """Filtro tri-estado si/no/nd sobre una columna boolean nullable."""
    if value == "si":
        return query.filter(column == True)  # noqa: E712
    if value == "no":
        return query.filter(column == False)  # noqa: E712
    if value == "nd":
        return query.filter(column.is_(None))
    return query


@router.get("/admin-list")
def admin_list_pdvs(
    p: PageParams = Depends(),
    zone_id: int | None = None,
    channel_id: int | None = None,
    is_active: bool | None = None,
    assigned_user_id: int | None = None,
    unassigned: bool = False,
    distributor_id: int | None = None,
    no_distributor: bool = False,
    has_coords: bool | None = None,
    has_route: bool | None = None,
    days_since_visit: str | None = Query(None, pattern="^(7|14|30|60|60plus|never)$"),
    visit_freq: str | None = Query(None, pattern="^(0|1-5|6-20|20plus)$"),
    works_espert: str | None = Query(None, pattern="^(si|no|nd)$"),
    sells_loose: str | None = Query(None, pattern="^(si|no|nd)$"),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lista paginada de PDVs para /admin/pos-management (Gestión).

    Envelope {items, total, page, page_size, has_more}. Cada item es un Pdv
    completo + enriquecido con VisitCount, LastVisit, HasRoute, HasCoords y
    TradeMarketerName (PDV.AssignedUserId). ``q`` busca en Name/Address/Code
    (ILIKE). Todos los filtros de la vista se resuelven server-side; los buckets
    de última visita/frecuencia solo joinean la subquery agrupada de Visit si
    vienen en el request. Respeta jerarquía de visibilidad.
    """
    q = db.query(PDVModel)

    visible = _visible_pdv_ids(db, current_user)
    if visible is not None:
        q = q.filter(PDVModel.PdvId.in_(visible)) if visible else q.filter(False)

    if zone_id is not None:
        q = q.filter(PDVModel.ZoneId == zone_id)
    if channel_id is not None:
        q = q.filter(PDVModel.ChannelId == channel_id)
    if is_active is not None:
        q = q.filter(PDVModel.IsActive == is_active)

    if unassigned:
        q = q.filter(PDVModel.AssignedUserId.is_(None))
    elif assigned_user_id is not None:
        q = q.filter(PDVModel.AssignedUserId == assigned_user_id)

    if no_distributor:
        junction_ids = db.query(PdvDistributorModel.PdvId).scalar_subquery()
        q = q.filter(~PDVModel.PdvId.in_(junction_ids), PDVModel.DistributorId.is_(None))
    elif distributor_id is not None:
        pdv_ids_with_dist = (
            db.query(PdvDistributorModel.PdvId)
            .filter(PdvDistributorModel.DistributorId == distributor_id)
            .scalar_subquery()
        )
        q = q.filter(
            PDVModel.PdvId.in_(pdv_ids_with_dist) | (PDVModel.DistributorId == distributor_id)
        )

    if has_coords is True:
        q = q.filter(PDVModel.Lat.isnot(None), PDVModel.Lon.isnot(None))
    elif has_coords is False:
        q = q.filter(or_(PDVModel.Lat.is_(None), PDVModel.Lon.is_(None)))

    if has_route is not None:
        route_exists = (
            db.query(RoutePdvModel.PdvId)
            .filter(RoutePdvModel.PdvId == PDVModel.PdvId)
            .exists()
        )
        q = q.filter(route_exists) if has_route else q.filter(~route_exists)

    q = _tri_state_filter(q, PDVModel.WorksEspertProducts, works_espert)
    q = _tri_state_filter(q, PDVModel.SellsLooseCigarettes, sells_loose)

    # Buckets de última visita / frecuencia: outerjoin a subquery agrupada de
    # Visit, solo cuando algún filtro lo necesita.
    if days_since_visit or visit_freq:
        vs = (
            db.query(
                VisitModel.PdvId.label("PdvId"),
                sqlfunc.count(VisitModel.VisitId).label("cnt"),
                sqlfunc.max(VisitModel.OpenedAt).label("last"),
            )
            .group_by(VisitModel.PdvId)
            .subquery()
        )
        q = q.outerjoin(vs, vs.c.PdvId == PDVModel.PdvId)

        if days_since_visit:
            now = datetime.now(timezone.utc)
            d7, d14, d30, d60 = (now - timedelta(days=n) for n in (7, 14, 30, 60))
            if days_since_visit == "7":
                q = q.filter(vs.c.last >= d7)
            elif days_since_visit == "14":
                q = q.filter(vs.c.last < d7, vs.c.last >= d14)
            elif days_since_visit == "30":
                q = q.filter(vs.c.last < d14, vs.c.last >= d30)
            elif days_since_visit == "60":
                q = q.filter(vs.c.last < d30, vs.c.last >= d60)
            elif days_since_visit == "60plus":
                q = q.filter(vs.c.last < d60)
            elif days_since_visit == "never":
                q = q.filter(vs.c.last.is_(None))

        if visit_freq:
            cnt = sqlfunc.coalesce(vs.c.cnt, 0)
            if visit_freq == "0":
                q = q.filter(cnt == 0)
            elif visit_freq == "1-5":
                q = q.filter(cnt >= 1, cnt <= 5)
            elif visit_freq == "6-20":
                q = q.filter(cnt >= 6, cnt <= 20)
            elif visit_freq == "20plus":
                q = q.filter(cnt > 20)

    if p.q:
        like = f"%{p.q}%"
        q = q.filter(or_(
            PDVModel.Name.ilike(like),
            PDVModel.Address.ilike(like),
            PDVModel.Code.ilike(like),
        ))

    items, total = paginate(q.order_by(PDVModel.Name, PDVModel.PdvId), p)

    # Enriquecido por página (solo los ids de esta página, ~page_size filas)
    page_ids = [pdv.PdvId for pdv in items]
    visit_map: dict[int, tuple] = {}
    routed_ids: set[int] = set()
    tm_names: dict[int, str] = {}
    if page_ids:
        visit_stats = (
            db.query(
                VisitModel.PdvId,
                sqlfunc.count(VisitModel.VisitId),
                sqlfunc.max(VisitModel.OpenedAt),
            )
            .filter(VisitModel.PdvId.in_(page_ids))
            .group_by(VisitModel.PdvId)
            .all()
        )
        visit_map = {pid: (cnt, last) for pid, cnt, last in visit_stats}
        routed_ids = {
            r[0]
            for r in db.query(RoutePdvModel.PdvId)
            .filter(RoutePdvModel.PdvId.in_(page_ids))
            .distinct()
            .all()
        }
        tm_ids = {pdv.AssignedUserId for pdv in items if pdv.AssignedUserId}
        if tm_ids:
            tm_names = dict(
                db.query(UserModel.UserId, UserModel.DisplayName)
                .filter(UserModel.UserId.in_(tm_ids))
                .all()
            )

    out = _pdvs_to_response_batch(items, db)
    for pdv, item in zip(items, out):
        cnt, last = visit_map.get(pdv.PdvId, (0, None))
        item["VisitCount"] = cnt
        item["LastVisit"] = last.isoformat() if last else None
        item["HasRoute"] = pdv.PdvId in routed_ids
        item["HasCoords"] = pdv.Lat is not None and pdv.Lon is not None
        item["TradeMarketerName"] = tm_names.get(pdv.AssignedUserId) if pdv.AssignedUserId else None
    return make_page(out, total, p)


@router.get("/{pdv_id}", response_model=Pdv)
def get_pdv(
    pdv_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")

    # Role-based access check
    visible = _visible_pdv_ids(db, current_user)
    if visible is not None and pdv_id not in visible:
        raise HTTPException(status_code=403, detail="No tenés acceso a este PDV")

    return _pdv_to_response(pdv, db)


@router.post("", status_code=201)
def create_pdv(data: PdvCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    # Nota: sin response_model porque devolvemos un dict que puede incluir
    # `_warning` (campo extra que no está en Pdv). El response_model lo filtraría.
    code = data.Code or f"PDV-{uuid.uuid4().hex[:12].upper()}"
    channel = db.query(Channel).filter(Channel.ChannelId == data.ChannelId).first()
    if not channel:
        raise HTTPException(status_code=400, detail="Canal no encontrado")
    channel_name = channel.Name

    # Detectar duplicado por nombre + dirección (warn, don't block)
    duplicate_warning = None
    dup_q = db.query(PDVModel).filter(PDVModel.Name == data.Name.strip(), PDVModel.IsActive == True)
    if data.ZoneId is not None:
        dup_q = dup_q.filter(PDVModel.ZoneId == data.ZoneId)
    existing = dup_q.first()
    if existing:
        duplicate_warning = f"Ya existe un PDV con el nombre '{existing.Name}' (ID: {existing.PdvId}, Dir: {existing.Address or 'sin dirección'}). Si son locales distintos, cambiá el nombre para diferenciarlos."

    # Use first distributor as legacy DistributorId for backward compat
    legacy_dist_id = data.DistributorId
    if not legacy_dist_id and data.DistributorIds:
        legacy_dist_id = data.DistributorIds[0]

    category = volume_to_category(data.MonthlyVolume)

    # Zona: default heredado (del body o del creador), pero si las coordenadas
    # caen claramente en OTRA zona, ganan las coordenadas. Evita que un vendedor
    # censando fuera de su territorio (o con la zona de usuario mal asignada)
    # genere PDVs mal zonificados — causa del backfill 2026-09-01.
    zone_id = data.ZoneId if data.ZoneId is not None else current_user.ZoneId
    if data.Lat is not None and data.Lon is not None:
        geo_zone_id = zone_id_from_coords(db, float(data.Lat), float(data.Lon))
        if geo_zone_id is not None and geo_zone_id != zone_id:
            zone_id = geo_zone_id

    pdv = PDVModel(
        Code=code,
        Name=data.Name,
        BusinessName=data.BusinessName,
        Channel=channel_name,
        ChannelId=data.ChannelId,
        SubChannelId=data.SubChannelId,
        Address=data.Address,
        City=data.City,
        ZoneId=zone_id,
        DistributorId=legacy_dist_id,
        Lat=data.Lat,
        Lon=data.Lon,
        OpeningTime=data.OpeningTime,
        ClosingTime=data.ClosingTime,
        VisitDay=data.VisitDay,
        WorksEspertProducts=data.WorksEspertProducts,
        SellsLooseCigarettes=data.SellsLooseCigarettes,
        MonthlyVolume=data.MonthlyVolume,
        Category=category,
        DefaultMaterialExternalId=data.DefaultMaterialExternalId,
        SupplierTypes=",".join(data.SupplierTypes) if data.SupplierTypes else None,
        IsActive=data.IsActive,
        AssignedUserId=current_user.UserId,
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
    resp = _pdv_to_response(pdv, db).model_dump(mode="json")
    if duplicate_warning:
        resp["_warning"] = duplicate_warning
    return resp


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

    # Auto-derive Category when MonthlyVolume changes
    if "MonthlyVolume" in dump:
        pdv.Category = volume_to_category(pdv.MonthlyVolume)

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


@router.delete("/{pdv_id}", status_code=204, dependencies=[Depends(require_role("territory_manager"))])
def delete_pdv(pdv_id: int, db: Session = Depends(get_db)):
    pdv = db.query(PDVModel).filter(PDVModel.PdvId == pdv_id).first()
    if not pdv:
        raise HTTPException(status_code=404, detail="PDV no encontrado")
    # Delete all visit-related data
    visit_ids = [v.VisitId for v in db.query(VisitModel.VisitId).filter(VisitModel.PdvId == pdv_id).all()]
    if visit_ids:
        db.query(VisitPhotoModel).filter(VisitPhotoModel.VisitId.in_(visit_ids)).delete(synchronize_session=False)
        db.query(VisitActionModel).filter(VisitActionModel.VisitId.in_(visit_ids)).delete(synchronize_session=False)
        db.query(VisitCheck).filter(VisitCheck.VisitId.in_(visit_ids)).delete(synchronize_session=False)
        db.query(VisitAnswer).filter(VisitAnswer.VisitId.in_(visit_ids)).delete(synchronize_session=False)
        db.query(VisitCoverageModel).filter(VisitCoverageModel.VisitId.in_(visit_ids)).delete(synchronize_session=False)
        db.query(VisitLooseModel).filter(VisitLooseModel.VisitId.in_(visit_ids)).delete(synchronize_session=False)
        db.query(VisitPOPModel).filter(VisitPOPModel.VisitId.in_(visit_ids)).delete(synchronize_session=False)
        db.query(VisitFormTimeModel).filter(VisitFormTimeModel.VisitId.in_(visit_ids)).delete(synchronize_session=False)
        # Break external references to these visits (prod FKs are strict, not SET NULL)
        db.query(PdvNoteModel).filter(PdvNoteModel.VisitId.in_(visit_ids)).update(
            {PdvNoteModel.VisitId: None}, synchronize_session=False
        )
        db.query(IncidentModel).filter(IncidentModel.VisitId.in_(visit_ids)).update(
            {IncidentModel.VisitId: None}, synchronize_session=False
        )
        db.query(MarketNewsModel).filter(MarketNewsModel.VisitId.in_(visit_ids)).delete(synchronize_session=False)
        db.query(VisitModel).filter(VisitModel.PdvId == pdv_id).delete(synchronize_session=False)
    # Delete PDV-related data
    db.query(PdvDistributorModel).filter(PdvDistributorModel.PdvId == pdv_id).delete()
    db.query(PdvContactModel).filter(PdvContactModel.PdvId == pdv_id).delete()
    db.query(PdvPhotoModel).filter(PdvPhotoModel.PdvId == pdv_id).delete()
    db.query(PdvAssignmentModel).filter(PdvAssignmentModel.PdvId == pdv_id).delete()
    db.query(PdvKpiModel).filter(PdvKpiModel.PdvId == pdv_id).delete()
    db.query(PdvNoteModel).filter(PdvNoteModel.PdvId == pdv_id).delete()
    db.query(PdvProductCategoryModel).filter(PdvProductCategoryModel.PdvId == pdv_id).delete()
    db.query(PdvSupplierModel).filter(PdvSupplierModel.PdvId == pdv_id).delete()
    db.query(MarketNewsModel).filter(MarketNewsModel.PdvId == pdv_id).delete()
    db.query(IncidentModel).filter(IncidentModel.PdvId == pdv_id).delete()
    db.query(RouteDayPdvModel).filter(RouteDayPdvModel.PdvId == pdv_id).delete()
    db.query(RoutePdvModel).filter(RoutePdvModel.PdvId == pdv_id).delete()
    db.delete(pdv)
    db.commit()
