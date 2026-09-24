"""Inteligencia Comercial — censo consolidado, competencia y oportunidades.

Tres recursos de solo lectura sobre `services/intelligence.py`:

    GET /intelligence/overview       resumen, zonas, competencia, portfolio, trades, alertas
    GET /intelligence/opportunities  motor de 5 reglas, con filtros y paginado
    GET /intelligence/map            puntos para el mapa canvas
    GET /intelligence/behavior       comportamiento de un vendedor por rango (auditoría)

Solo admin (decisión 2026-08-27: Inteligencia y Tablero TMR son de dirección).
El recorte jerárquico por `visible_pdv_ids`/`visible_user_ids` se mantiene por
si mañana se abre a managers — hoy es un no-op porque admin ve todo.

Cache TTL in-process de 30 min: el censo histórico completo de `VisitCoverage`
es el escaneo más caro del backend y estos datos cambian a ritmo de visitas de
campo, no de clicks. El censo se cachea aparte de los responses para que los
tres endpoints del primer render paguen UNA sola vez el escaneo. La key incluye
al solicitante (o "all" para admins, que comparten scope completo).
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_role
from ..database import get_db
from ..hierarchy import visible_pdv_ids, visible_user_ids
from ..models import User as UserModel
from ..services import behavior as B
from ..services import intelligence as I
from ..utils.ttl_cache import TTLCache

router = APIRouter(
    prefix="/intelligence",
    tags=["Inteligencia Comercial"],
    dependencies=[Depends(require_role("admin"))],
)

_INTEL_CACHE = TTLCache(ttl_seconds=1800.0, max_entries=500)
# Comportamiento: TTL más corto (10 min) porque se mira "hoy" mientras el
# vendedor sigue en la calle.
_BEHAVIOR_CACHE = TTLCache(ttl_seconds=600.0, max_entries=500)


def _scope_key(scope: Optional[set[int]], current_user: UserModel):
    """Los admins comparten cache (scope completo); los managers cachean por usuario."""
    return "all" if scope is None else current_user.UserId


def _census_cached(db: Session, current_user: UserModel) -> tuple[I.Census, Optional[set[int]]]:
    pdv_scope = visible_pdv_ids(db, current_user)
    key = ("census", _scope_key(pdv_scope, current_user))
    census = _INTEL_CACHE.get_or_build(key, lambda: I.load_census(db, pdv_scope))
    return census, pdv_scope


@router.get("/overview")
def get_overview(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    census, pdv_scope = _census_cached(db, current_user)
    user_scope = visible_user_ids(db, current_user)
    key = ("overview", _scope_key(pdv_scope, current_user))
    return _INTEL_CACHE.get_or_build(key, lambda: I.build_overview(db, census, user_scope))


@router.get("/opportunities")
def get_opportunities(
    zona: Optional[str] = Query(default=None),
    trade_id: Optional[int] = Query(default=None),
    prioridad: Optional[str] = Query(default=None),
    tipo: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    # page_size alto para el export CSV client-side (una sola página con todo).
    page_size: int = Query(default=50, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """El motor completo se cachea por scope; los filtros y el paginado se
    aplican en memoria por request (los agregados son siempre del total)."""
    census, pdv_scope = _census_cached(db, current_user)
    key = ("opportunities", _scope_key(pdv_scope, current_user))
    full = _INTEL_CACHE.get_or_build(key, lambda: I.build_opportunities(census))

    items = full["items"]
    if zona:
        items = [r for r in items if r["zona"] == zona]
    if trade_id is not None:
        items = [r for r in items if r["tradeId"] == trade_id]
    if prioridad:
        items = [r for r in items if r["prioridad"] == prioridad]
    if tipo:
        items = [r for r in items if r["tipo"] == tipo]

    start = (page - 1) * page_size
    return {
        "items": items[start:start + page_size],
        "filteredTotal": len(items),
        "page": page,
        "pageSize": page_size,
        "total": full["total"],
        "porTipo": full["porTipo"],
        "porZona": full["porZona"],
        "porTrade": full["porTrade"],
        "porPrioridad": full["porPrioridad"],
        "aCompletar": full["aCompletar"],
    }


@router.get("/pdv/{pdv_id}")
def get_pdv_detail(
    pdv_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Ficha completa de un PDV (último nivel de drill). Sin cache propio:
    el costo es un puñado de queries por PDV; el censo compartido ya está."""
    census, _pdv_scope = _census_cached(db, current_user)
    detail = I.build_pdv_detail(db, census, pdv_id)
    if detail is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="PDV no encontrado o fuera de tu alcance")
    return detail


@router.get("/suppliers")
def get_suppliers(
    user_id: Optional[int] = Query(default=None, description="Trade dueño de las rutas foco"),
    ruta: Optional[str] = Query(default=None, description="Nombre de UNA ruta foco (opcional, con user_id)"),
    zone_id: Optional[int] = Query(default=None, description="Zona completa (todos sus PDVs activos)"),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Proveedores cargados en los PDVs de un recorte del drill: rutas foco de
    un trade (user_id [+ruta]) o una zona entera (zone_id). Sin cache: es un
    join chico e indexado, y el censo de proveedores se edita en campo —
    mejor verlo fresco."""
    if user_id is None and zone_id is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Pasá user_id o zone_id")
    return I.build_suppliers(db, trade_user_id=user_id, ruta_nombre=ruta, zone_id=zone_id)


@router.get("/map")
def get_map(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    census, pdv_scope = _census_cached(db, current_user)
    key = ("map", _scope_key(pdv_scope, current_user))
    return _INTEL_CACHE.get_or_build(key, lambda: I.build_map(db, census))


@router.get("/behavior")
def get_behavior(
    user_id: int = Query(..., description="Vendedor a auditar"),
    date_from: date = Query(..., description="Desde (fecha AR, inclusive)"),
    date_to: date = Query(..., description="Hasta (fecha AR, inclusive)"),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """Comportamiento en campo de UN vendedor por día (ON/OFF, GPS, plan,
    alertas) — ver `services/behavior.py`. Rango inclusivo, tope
    `MAX_RANGE_DAYS`. Cache 10 min por (user_id, from, to)."""
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="date_to debe ser mayor o igual a date_from")
    if (date_to - date_from).days + 1 > B.MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"El rango no puede superar {B.MAX_RANGE_DAYS} días")
    user_scope = visible_user_ids(db, current_user)
    if user_scope is not None and user_id not in user_scope:
        raise HTTPException(status_code=403, detail="No tenés acceso a los datos de este usuario")
    if db.query(UserModel.UserId).filter(UserModel.UserId == user_id).first() is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    key = ("behavior", user_id, date_from, date_to)
    return _BEHAVIOR_CACHE.get_or_build(key, lambda: B.build_behavior(db, user_id, date_from, date_to))
