"""Cadenas / banderas: reglas de negocio compartidas por routers/chains.py y routers/pdvs.py.

Dos ejes separados: Channel › SubChannel = formato del local; Chain = de quién es.
Reglas (server-side):
  - PDV.ChainId exige cadena activa y chain.ChannelId == PDV.ChannelId.
  - Kind='cadena': el SubChannelId se DERIVA del tamaño de la cadena (≤10 Chica,
    11–30 Mediana, >30 Grande) buscando en el canal el subcanal que se llama
    exactamente Chica/Mediana/Grande (se tolera un paréntesis: "Chica (menos de 10
    PDVs)"; "Chicago Kiosco" NO cuenta). Si el canal no los tiene, se respeta el enviado.
  - Un canal con cadenas 'cadena' activas exige ChainId en el alta (lo exige el
    FRONT; ver la regla siguiente).
  - El ALTA de PDV nunca se rechaza por clasificación (subcanal de otro canal, cadena
    inexistente / de otro canal, cadena faltante): la cola offline descarta la
    operación después de 5 intentos y se pierde el dato de campo. Se descarta el dato
    malo, se guarda el PDV y queda PDV_CHAIN_PENDING (resolve_pdv_classification_lenient).
    La validación estricta (422) queda en la EDICIÓN, que es interactiva.
  - EDICIÓN desde un cliente viejo / formulario desactualizado (body SIN la clave
    ChainId) sobre un PDV que tiene cadena 'cadena': se ignoran ChannelId/SubChannelId
    entrantes (stale_classification_guard) — si no, un form viejo deshace la migración.
  - Clientes viejos (PWA cacheada / cola offline) NO mandan la clave ChainId: nunca
    se les rechaza el alta (se perdería dato de campo). Se intenta deducir la cadena
    del subcanal legacy (cuando el subcanal ERA el nombre de la cadena) y, si no,
    el PDV entra sin cadena y queda auditado como PDV_CHAIN_PENDING (filtro
    "missing_chain" de Gestión PDV). El front nuevo hace lo mismo cuando no conoce
    las cadenas del canal (cache offline viejo): omite la clave.
  - En el ALTA una cadena inactiva tampoco rechaza (ver resolve_pdv_chain).
"""
from __future__ import annotations

import json
import re
import unicodedata

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import PDV, Channel, SubChannel
from ..models.audit import AuditEvent
from ..models.chain import Chain

KIND_CADENA = "cadena"
KIND_BANDERA = "bandera"

# (prefijo normalizado del subcanal, tope inclusive de locales) — None = sin tope
SIZE_BUCKETS: tuple[tuple[str, int | None], ...] = (("chica", 10), ("mediana", 30), ("grande", None))
BUCKET_LABELS = {"chica": "Chica", "mediana": "Mediana", "grande": "Grande"}


_BUCKET_RE = re.compile(r"^(chica|mediana|grande)(\s*\(|$)")


def bucket_key(name: str | None) -> str | None:
    """'chica' | 'mediana' | 'grande' si el nombre del subcanal ES un escalón de tamaño
    ("Chica", "Mediana (11 a 30 PDVs)"); None para cualquier otro ("Chicago Kiosco",
    "Grande Almacen"). Misma regla en scripts/migrate_chains_20261119.py."""
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    m = _BUCKET_RE.match(" ".join(s.split()))
    return m.group(1) if m else None


def norm(s: str | None) -> str:
    """Clave de comparación: sin tildes, minúsculas, solo alfanumérico."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def split_aliases(aliases: str | None) -> list[str]:
    return [a.strip() for a in (aliases or "").split(",") if a.strip()]


def add_alias(aliases: str | None, *new: str) -> str | None:
    """Agrega alias sin duplicar (comparación normalizada). Trunca a 500 chars."""
    out = split_aliases(aliases)
    seen = {norm(a) for a in out}
    for n in new:
        for part in split_aliases(n):
            if norm(part) and norm(part) not in seen:
                out.append(part)
                seen.add(norm(part))
    joined = ", ".join(out)
    while len(joined) > 500 and out:
        out.pop()
        joined = ", ".join(out)
    return joined or None


def size_bucket(store_count: int) -> str:
    """'chica' | 'mediana' | 'grande' según cantidad de locales."""
    for key, top in SIZE_BUCKETS:
        if top is None or store_count <= top:
            return key
    return SIZE_BUCKETS[-1][0]


def audit(db: Session, user, entity: str, entity_id: int, action: str, payload: dict) -> None:
    """Rastro en AuditEvent, misma transacción que el cambio. EntityId numérico
    (en prod la columna es INT)."""
    db.add(AuditEvent(
        UserId=user.UserId if user is not None else None,
        Entity=entity, EntityId=str(int(entity_id)), Action=action,
        PayloadJson=json.dumps(payload, default=str, ensure_ascii=False),
    ))


def chain_snapshot(c: Chain) -> dict:
    return {
        "ChainId": c.ChainId, "Name": c.Name, "ChannelId": c.ChannelId, "Kind": c.Kind,
        "IsKeyAccount": c.IsKeyAccount, "AccountManagerUserId": c.AccountManagerUserId,
        "StoreCount": c.StoreCount, "Aliases": c.Aliases, "IsActive": c.IsActive,
    }


def pdv_count(db: Session, chain_id: int) -> int:
    return (
        db.query(func.count(PDV.PdvId))
        .filter(PDV.ChainId == chain_id, PDV.IsActive == True)  # noqa: E712
        .scalar() or 0
    )


def effective_store_count(db: Session, chain: Chain) -> int:
    return chain.StoreCount if chain.StoreCount is not None else pdv_count(db, chain.ChainId)


def bucket_subchannels(db: Session, channel_id: int) -> dict[str, int]:
    """{'chica': SubChannelId, ...} de los subcanales de tamaño del canal (activos primero)."""
    rows = (
        db.query(SubChannel)
        .filter(SubChannel.ChannelId == channel_id)
        .order_by(SubChannel.IsActive.desc(), SubChannel.SubChannelId)
        .all()
    )
    out: dict[str, int] = {}
    for sc in rows:
        key = bucket_key(sc.Name)
        if key and key not in out:
            out[key] = sc.SubChannelId
    return out


def bucket_subchannel_id(db: Session, chain: Chain) -> int | None:
    """Subcanal de tamaño que le corresponde a la cadena; None si no aplica o no existe."""
    if chain.Kind != KIND_CADENA:
        return None
    return bucket_subchannels(db, chain.ChannelId).get(size_bucket(effective_store_count(db, chain)))


def sync_chain_bucket(db: Session, chain: Chain, user=None) -> int:
    """Alinea el SubChannelId de TODOS los PDVs de la cadena con su tamaño actual.
    Se llama después de cada alta/cambio que pueda mover el tamaño. Devuelve filas tocadas."""
    target = bucket_subchannel_id(db, chain)
    if target is None:
        return 0
    n = (
        db.query(PDV)
        .filter(PDV.ChainId == chain.ChainId, (PDV.SubChannelId != target) | PDV.SubChannelId.is_(None))
        .update({PDV.SubChannelId: target}, synchronize_session=False)
    )
    if n > 1:  # 1 = el propio PDV que se está guardando; >1 = cambió el tamaño de la cadena
        audit(db, user, "Chain", chain.ChainId, "CHAIN_REBUCKET", {
            "SubChannelId": target, "bucket": size_bucket(effective_store_count(db, chain)), "pdvs": n,
        })
    return n


def channel_has_cadenas(db: Session, channel_id: int) -> bool:
    return db.query(Chain.ChainId).filter(
        Chain.ChannelId == channel_id, Chain.Kind == KIND_CADENA, Chain.IsActive == True,  # noqa: E712
    ).first() is not None


def find_chain_by_text(db: Session, channel_id: int, text: str | None) -> Chain | None:
    """Cadena activa del canal cuyo nombre o alias coincide (normalizado) con el texto."""
    key = norm(text)
    if not key:
        return None
    for c in db.query(Chain).filter(Chain.ChannelId == channel_id, Chain.IsActive == True).all():  # noqa: E712
        if key == norm(c.Name) or key in {norm(a) for a in split_aliases(c.Aliases)}:
            return c
    return None


def find_duplicate(db: Session, channel_id: int, name: str, exclude_id: int | None = None) -> Chain | None:
    """Otra cadena del canal que ya "ocupa" ese nombre: por Name (activa o inactiva) o
    por alias de una cadena ACTIVA (los alias guardan el historial de fusiones: el
    nombre de una cadena fusionada pertenece a la que la absorbió)."""
    key = norm(name)
    if not key:
        return None
    rows = [c for c in db.query(Chain).filter(Chain.ChannelId == channel_id).order_by(Chain.ChainId).all()
            if c.ChainId != exclude_id]
    for c in rows:
        if norm(c.Name) == key:
            return c
    for c in rows:
        if c.IsActive and key in {norm(a) for a in split_aliases(c.Aliases)}:
            return c
    return None


def find_alias_owner(db: Session, channel_id: int, name: str, exclude_id: int | None = None) -> Chain | None:
    """Cadena ACTIVA del canal que tiene `name` como alias (≠ exclude_id)."""
    key = norm(name)
    for c in db.query(Chain).filter(Chain.ChannelId == channel_id, Chain.IsActive == True).all():  # noqa: E712
        if c.ChainId != exclude_id and key and key in {norm(a) for a in split_aliases(c.Aliases)}:
            return c
    return None


def validate_subchannel(db: Session, channel_id: int | None, subchannel_id: int | None) -> None:
    """El subcanal tiene que pertenecer al canal."""
    if subchannel_id is None:
        return
    sc = db.query(SubChannel).filter(SubChannel.SubChannelId == subchannel_id).first()
    if not sc:
        raise HTTPException(status_code=422, detail="Subcanal no encontrado")
    if sc.ChannelId != channel_id:
        raise HTTPException(status_code=422, detail="El subcanal no pertenece al canal elegido")


def resolve_pdv_chain(
    db: Session,
    *,
    channel_id: int | None,
    subchannel_id: int | None,
    chain_id: int | None,
    chain_sent: bool,
    require_chain: bool,
    current_chain_id: int | None = None,
    tolerate_inactive: bool = False,
) -> tuple[Chain | None, bool]:
    """Valida/deduce la cadena de un PDV. Devuelve (cadena | None, pendiente).

    chain_sent: el cliente mandó la clave ChainId (front nuevo). Los clientes viejos
      no la mandan → modo tolerante (ver docstring del módulo).
    require_chain: alta, o edición que mueve el PDV a un canal con cadenas.
    current_chain_id: cadena que el PDV ya tenía (si no cambia, no se re-exige activa).
    tolerate_inactive: ALTA. El alta puede venir de la cola offline, capturada antes de
      que la cadena se desactivara o fusionara: rechazarla dejaría el PDV trabado en el
      teléfono. Se sigue la fusión (cadena activa del canal que tiene el nombre viejo
      como alias) y, si no hay, se guarda con la cadena inactiva (dato histórico correcto).
    pendiente=True → canal con cadenas, cliente viejo, no se pudo deducir: se acepta sin cadena.
    """
    if chain_id is not None:
        chain = db.query(Chain).filter(Chain.ChainId == chain_id).first()
        if not chain:
            raise HTTPException(status_code=422, detail="Cadena no encontrada")
        if chain.ChannelId != channel_id:
            raise HTTPException(status_code=422, detail=f"La cadena '{chain.Name}' no pertenece al canal elegido")
        if not chain.IsActive and chain.ChainId != current_chain_id:
            if not tolerate_inactive:
                raise HTTPException(status_code=422, detail=f"La cadena '{chain.Name}' está inactiva")
            merged_into = find_chain_by_text(db, channel_id, chain.Name)
            if merged_into is not None and merged_into.Kind == chain.Kind:
                return merged_into, False
        return chain, False

    if channel_id is None or not require_chain or not channel_has_cadenas(db, channel_id):
        return None, False
    if chain_sent:
        raise HTTPException(status_code=422, detail="Elegí la cadena del PDV: este canal la exige")
    # Cliente viejo: ¿el subcanal legacy es el nombre de una cadena?
    if subchannel_id is not None:
        sc = db.query(SubChannel).filter(SubChannel.SubChannelId == subchannel_id).first()
        chain = find_chain_by_text(db, channel_id, sc.Name if sc else None)
        if chain is not None and chain.Kind == KIND_CADENA:
            return chain, False
    return None, True


def resolve_pdv_classification_lenient(
    db: Session, *, channel_id: int, subchannel_id: int | None, chain_id: int | None, chain_sent: bool,
) -> tuple[int | None, Chain | None, bool, list[str]]:
    """ALTA de PDV: nunca rechaza por clasificación. Devuelve
    (SubChannelId a guardar, cadena | None, pendiente, motivos de lo descartado).

    El alta puede venir de la cola offline (capturada con datos de ayer, o desde una
    PWA vieja): un 4xx la deja reintentando y a los 5 intentos se descarta — se pierde
    el PDV relevado en campo. Entonces: subcanal que no es del canal → se descarta;
    cadena inexistente / de otro canal / faltante en canal que la exige → sin cadena;
    todo queda auditado (PDV_CHAIN_PENDING) para completarlo desde Gestión PDV."""
    reasons: list[str] = []
    if subchannel_id is not None:
        try:
            validate_subchannel(db, channel_id, subchannel_id)
        except HTTPException as e:
            reasons.append(f"SubChannelId {subchannel_id} descartado: {e.detail}")
            subchannel_id = None
    try:
        chain, pending = resolve_pdv_chain(
            db, channel_id=channel_id, subchannel_id=subchannel_id, chain_id=chain_id,
            chain_sent=chain_sent, require_chain=True, tolerate_inactive=True,
        )
    except HTTPException as e:
        reasons.append(f"ChainId {chain_id} descartado: {e.detail}" if chain_id is not None else str(e.detail))
        # Sin el dato malo, mismo camino que un cliente viejo (deduce del subcanal legacy)
        chain, pending = resolve_pdv_chain(
            db, channel_id=channel_id, subchannel_id=subchannel_id, chain_id=None,
            chain_sent=False, require_chain=True, tolerate_inactive=True,
        )
    return subchannel_id, chain, pending or bool(reasons), reasons


def stale_classification_guard(db: Session, pdv: PDV, dump: dict) -> dict | None:
    """EDICIÓN: si el body NO trae la clave ChainId (cliente viejo o formulario cargado
    antes de la migración) y el PDV tiene una cadena Kind='cadena', saca del dump los
    ChannelId/SubChannelId entrantes que cambiarían la clasificación. Devuelve lo
    ignorado (para auditar) o None. Un cambio deliberado de canal sobre un PDV con
    cadena tiene que venir de un cliente que manda la clave ChainId explícita."""
    if "ChainId" in dump or not pdv.ChainId:
        return None
    chain = db.query(Chain).filter(Chain.ChainId == pdv.ChainId).first()
    if chain is None or chain.Kind != KIND_CADENA:
        return None
    ignored = {}
    for key in ("ChannelId", "SubChannelId"):
        if key in dump:
            value = dump.pop(key)
            if value != getattr(pdv, key):
                ignored[key] = {"sent": value, "kept": getattr(pdv, key)}
    return ignored or None


def schema_problems(db: Session) -> list[str]:
    """Guarda de orden de deploy: el backend nuevo hace SELECT de PDV.ChainId en todos
    los endpoints de PDV. Si el DDL (scripts/ddl_chains_20261119.py) no corrió, lista
    qué falta. [] = todo bien. Usa el inspector (catálogo), no un SELECT: en SQLite un
    identificador entre comillas que no existe se evalúa como texto y no falla."""
    from sqlalchemy import inspect
    insp = inspect(db.connection())
    problems = []
    if not insp.has_table("Chain"):
        problems.append("tabla Chain")
    if not insp.has_table("PDV") or "ChainId" not in {c["name"] for c in insp.get_columns("PDV")}:
        problems.append("columna PDV.ChainId")
    return problems


def chain_info_map(db: Session, chain_ids: set[int]) -> dict[int, Chain]:
    """Batch para respuestas de PDV (evita N+1)."""
    if not chain_ids:
        return {}
    return {c.ChainId: c for c in db.query(Chain).filter(Chain.ChainId.in_(chain_ids)).all()}
