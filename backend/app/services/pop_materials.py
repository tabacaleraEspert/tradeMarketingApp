"""Catálogo de material POP real (artículos MKT de Bejerman) + regla "solo Espert".

Fuente: comercial-nuevo-mobiliza `GET {COMERCIAL_API_URL}/api/public/material`
(header `X-Api-Key`), que lee Bejerman. Respuesta:
    {"generadoEn": iso, "articulos": [{"codigo", "descripcion", "linea", "tipo",
                                       "anio", "fotoUrl", "stock"}]}

Sync = upsert por `Code`; lo que ya no viene queda `IsActive=False` (nunca se
borra: hay censos/colocaciones históricos que lo referencian). Respuesta sin
artículos -> error, NO se desactiva nada (un origen caído no puede vaciar el
catálogo).
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..config import settings
from ..models import PopMaterial
from ..models.audit import AuditEvent

log = logging.getLogger(__name__)

FETCH_TIMEOUT_S = 60


class PopSyncDisabled(Exception):
    """Faltan COMERCIAL_API_URL / COMERCIAL_MATERIAL_API_KEY."""


class PopSyncError(Exception):
    """El origen falló o devolvió algo inutilizable (no se tocó nada)."""


# ─── KPI: "solo Espert" ──────────────────────────────────────────────

ESPERT_ONLY_FROM = (2026, 10)
"""Desde octubre 2026 (decisión 08/10, aplica al mes en curso) el nivel de
comunicación y "con material" cuentan solo material Espert. Los meses previos
se siguen calculando como antes: `compute_kpis` recalcula en vivo los meses
cerrados sin `KpiMonthlySnapshot`, y `/kpi/...` llama a
`pdv_communication_scores` directo para cualquier mes."""

_ESPERT_RE = re.compile(r"\bespert\b", re.IGNORECASE)


def espert_only_applies(year: int, month: int) -> bool:
    return (year, month) >= ESPERT_ONLY_FROM


def is_espert_pop(company: str | None, material_code: str | None) -> bool:
    """Fila de censo POP que cuenta como material Espert: artículo del catálogo
    (`MaterialCode`) o `Company` (string unido por comas) con el token Espert."""
    if material_code:
        return True
    return bool(company and _ESPERT_RE.search(company))


# ─── Sync ────────────────────────────────────────────────────────────

def fetch_catalog() -> dict:
    """GET al endpoint público de mobiliza. Separado para poder mockearlo."""
    base = settings.comercial_api_url.rstrip("/")
    key = settings.comercial_material_api_key
    if not base or not key:
        raise PopSyncDisabled("COMERCIAL_API_URL / COMERCIAL_MATERIAL_API_KEY no configurados")
    req = urllib.request.Request(
        f"{base}/api/public/material",
        headers={"X-Api-Key": key, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:  # noqa: S310 — URL de config
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise PopSyncError(f"Origen respondió HTTP {e.code}") from e
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise PopSyncError(f"No se pudo leer el catálogo: {e}") from e


def _str(value, max_len: int) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s[:max_len] if s else None


def _int(value) -> int | None:
    try:
        return int(str(value).strip()) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _float(value) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _parse_articles(payload) -> dict[str, dict]:
    if not isinstance(payload, dict) or not isinstance(payload.get("articulos"), list):
        raise PopSyncError("Respuesta sin 'articulos'")
    parsed: dict[str, dict] = {}
    for a in payload["articulos"]:
        if not isinstance(a, dict):
            continue
        code = _str(a.get("codigo"), 30)
        if not code:
            continue
        parsed[code] = {
            "Description": _str(a.get("descripcion"), 200) or code,
            "Line": _str(a.get("linea"), 80),
            "Type": _str(a.get("tipo"), 120),
            "Year": _int(a.get("anio")),
            "PhotoUrl": _str(a.get("fotoUrl"), 400),
            "Stock": _float(a.get("stock")),
        }
    return parsed


def sync_pop_materials(db: Session, user=None, payload: dict | None = None) -> dict:
    """Upsert del catálogo. `user` = admin que lo disparó (None = cron).
    Devuelve {Created, Updated, Deactivated, Total}."""
    if payload is None:
        payload = fetch_catalog()
    articles = _parse_articles(payload)
    if not articles:
        raise PopSyncError("El origen devolvió 0 artículos: no se desactiva el catálogo")

    now = datetime.now(timezone.utc)
    existing = {m.Code: m for m in db.query(PopMaterial).all()}
    # Respuesta truncada/parcial del origen: no vaciar el picker de golpe.
    active = [c for c, m in existing.items() if m.IsActive]
    to_deactivate = [c for c in active if c not in articles]
    if len(active) >= 20 and len(to_deactivate) > len(active) // 2:
        raise PopSyncError(
            f"El origen devolvió {len(articles)} artículos y se desactivarían {len(to_deactivate)} "
            f"de {len(active)} activos: se aborta (posible respuesta parcial)"
        )
    created = updated = deactivated = 0

    for code, fields in articles.items():
        m = existing.get(code)
        if m is None:
            db.add(PopMaterial(Code=code, IsActive=True, SyncedAt=now, **fields))
            created += 1
            continue
        changed = not m.IsActive or any(getattr(m, k) != v for k, v in fields.items())
        for k, v in fields.items():
            setattr(m, k, v)
        m.IsActive = True
        m.SyncedAt = now
        if changed:
            updated += 1

    deactivated_codes = []
    for code, m in existing.items():
        if code not in articles and m.IsActive:
            m.IsActive = False
            m.SyncedAt = now
            deactivated += 1
            deactivated_codes.append(code)

    result = {"Created": created, "Updated": updated, "Deactivated": deactivated, "Total": len(articles)}
    # Rastro en AuditEvent, misma transacción (estándar de auditoría).
    db.add(AuditEvent(
        UserId=user.UserId if user is not None else None,
        # EntityId "0" = catálogo completo: en prod la columna es INT (drift vs el modelo String),
        # un texto rompe el INSERT. El resto del código también manda ids numéricos.
        Entity="PopMaterial", EntityId="0", Action="sync",
        PayloadJson=json.dumps(
            {**result, "DeactivatedCodes": deactivated_codes,
             "Source": "manual" if user is not None else "cron",
             "GeneradoEn": payload.get("generadoEn")},
            ensure_ascii=False, default=str,
        ),
    ))
    db.commit()
    log.info("Sync material POP: %s", result)
    return result


# ─── Validación de códigos (censo / colocación) ──────────────────────

def resolve_item_names(db: Session, items, name_max_len: int) -> None:
    """Para cada ítem con `MaterialCode`: valida que exista en `PopMaterial`
    (activo o no: una colocación encolada offline no debe romper porque el
    artículo se desactivó después) y completa `MaterialName` vacío con la
    descripción. Ítem sin código y sin nombre -> error. Muta `items`.
    Lanza ValueError con mensaje para el 422."""
    for it in items:
        it.MaterialCode = (it.MaterialCode or "").strip() or None
        it.MaterialName = (it.MaterialName or "").strip()
    codes = {it.MaterialCode for it in items if it.MaterialCode}
    found = {}
    if codes:
        found = {
            code: desc for code, desc in
            db.query(PopMaterial.Code, PopMaterial.Description).filter(PopMaterial.Code.in_(codes))
        }
    missing = sorted(codes - set(found))
    if missing:
        raise ValueError(f"MaterialCode inexistente: {', '.join(missing)}")
    for it in items:
        if not it.MaterialName and it.MaterialCode:
            it.MaterialName = (found[it.MaterialCode] or it.MaterialCode)[:name_max_len]
        if not it.MaterialName:
            raise ValueError("MaterialName requerido si no hay MaterialCode")
        it.MaterialName = it.MaterialName[:name_max_len]
