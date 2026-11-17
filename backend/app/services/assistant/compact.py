"""Compactación de resultados de herramientas antes de mandarlos al modelo.

El historial del turno se reenvía en cada vuelta: un resultado grande se paga N
veces. La forma columnar (`columnas` una vez + `filas` como arrays) midió −51%
de tokens en Bachi contra una lista de objetos.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Optional, Sequence

MAX_ROWS = 150
MAX_CHARS = 12000

EMPTY_NOTE = (
    "SIN_RESULTADOS: la consulta no devolvió filas. Puede significar que no hubo casos "
    "O que no hay datos relevados para ese recorte — verificá con get_cobertura_datos "
    "antes de afirmar que no hubo."
)


def _default(o: Any):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (set, frozenset)):
        return sorted(o)
    return str(o)


def _dumps(o: Any) -> str:
    # ensure_ascii=False: los acentos como texto, no como é (menos tokens).
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"), default=_default)


def tabla(
    rows: Iterable[dict], columns: Optional[Sequence[str]] = None, *,
    max_rows: int = MAX_ROWS, total: Optional[int] = None,
) -> Optional[dict]:
    """Forma columnar como dict, para embeber en un `objeto()`. `None` si no hay filas.

    `columns` fija columnas y orden; sin él salen las claves escalares de la
    primera fila (limitación heredada: una clave que aparece recién en la
    segunda fila se pierde — por eso las herramientas pasan `columns`).
    `total`: cantidad real cuando `rows` ya vino recortado por la consulta
    (LIMIT en SQL), para que la nota de truncado diga la verdad."""
    rows = list(rows)
    if not rows:
        return None
    if columns is None:
        columns = [k for k, v in rows[0].items() if not isinstance(v, (dict, list, tuple, set))]
    n = min(len(rows), max_rows)
    total = max(total or 0, len(rows))
    return {
        "columnas": list(columns),
        "filas": [[r.get(c) for c in columns] for r in rows[:n]],
        "nota": f"[truncado a {n} filas de {total}]" if n < total else None,
    }


def lista(
    rows: Iterable[dict],
    columns: Optional[Sequence[str]] = None,
    *,
    max_rows: int = MAX_ROWS,
    max_chars: int = MAX_CHARS,
    empty_note: str = EMPTY_NOTE,
    extra: Optional[dict] = None,
    total: Optional[int] = None,
) -> str:
    """`{"columnas": [...], "filas": [[...], ...], "nota": ...}` como texto.

    Trunca a `max_rows` y, si el JSON sigue pasando `max_chars`, parte la
    cantidad de filas a la mitad hasta entrar (piso: 1 fila). `extra` agrega
    campos de cabecera (totales, período) al objeto.
    """
    rows = list(rows)
    if not rows:
        return empty_note
    n = max_rows
    while True:
        out: dict[str, Any] = dict(extra or {})
        out.update(tabla(rows, columns, max_rows=n, total=total))
        text = _dumps(out)
        shown = len(out["filas"])
        if len(text) <= max_chars or shown <= 1:
            return text
        n = max(1, shown // 2)


def objeto(data: Any, *, max_chars: int = MAX_CHARS) -> str:
    """JSON plano para resúmenes. Si pasa el tope se corta y se avisa: un JSON
    cortado no es parseable, pero el modelo lo lee igual y sabe que falta."""
    text = _dumps(data)
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"\n[truncado: {len(text)} caracteres, se muestran {max_chars}]"
