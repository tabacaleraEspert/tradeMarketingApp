"""Inteligencia Comercial — censo consolidado, competencia y oportunidades.

Tres recursos de solo lectura sobre `services/intelligence.py`:

    GET /intelligence/overview       resumen, zonas, competencia, portfolio, trades, alertas
    GET /intelligence/opportunities  motor de 5 reglas, con filtros y paginado
    GET /intelligence/map            puntos para el mapa canvas

Solo admin (decisión 2026-08-27: Inteligencia y Tablero TMR son de dirección).
El recorte jerárquico por `visible_pdv_ids`/`visible_user_ids` se mantiene por
si mañana se abre a managers — hoy es un no-op porque admin ve todo.

Cache TTL in-process de 30 min: el censo histórico completo de `VisitCoverage`
es el escaneo más caro del backend y estos datos cambian a ritmo de visitas de
campo, no de clicks. El censo se cachea aparte de los responses para que los
tres endpoints del primer render paguen UNA sola vez el escaneo. La key incluye
al solicitante (o "all" para admins, que comparten scope completo).
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_role
from ..database import get_db
from ..hierarchy import visible_pdv_ids, visible_user_ids
from ..models import User as UserModel
from ..services import intelligence as I
from ..utils.ttl_cache import TTLCache

router = APIRouter(
    prefix="/intelligence",
    tags=["Inteligencia Comercial"],
    dependencies=[Depends(require_role("admin"))],
)

_INTEL_CACHE = TTLCache(ttl_seconds=1800.0, max_entries=500)


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
    }


@router.get("/map")
def get_map(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    census, pdv_scope = _census_cached(db, current_user)
    key = ("map", _scope_key(pdv_scope, current_user))
    return _INTEL_CACHE.get_or_build(key, lambda: I.build_map(census))
