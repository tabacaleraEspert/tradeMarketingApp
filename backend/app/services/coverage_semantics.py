"""Semántica del censo de cobertura en 3 estados: Sí / No / Sin dato.

Contexto (2026-09-23): `VisitCoverage.Works` es booleano y el form viejo
guardaba `Works=False` para TODO producto de una categoría abierta, aunque el
vendedor no hubiera preguntado por él. "No pregunté" y "no lo tiene" quedaban
idénticos y la Inteligencia inflaba oportunidades.

Modelo nuevo:
  - **Sin dato = no hay fila.** El form solo persiste lo que el vendedor tocó
    (Sí o No). `VisitCoverage` no cambia de esquema.
  - **Corte histórico** (decisión "A"): las filas `Works=False` anteriores al
    corte se ignoran en todos los consumidores — sobreviven solo los "Sí". El
    corte vive en AppSetting `coverage_explicit_no_since` (ISO 8601, lo setea
    el hotfix de prod al deployar). Sin setting → comportamiento anterior
    (toda fila cuenta). Reversible sin tocar datos.
  - **Marca** (`Product.Brand`): nivel intermedio Categoría → Marca → Variante
    para cargar "No" de un tap. Se backfillea por prefijo del nombre con
    `brand_of()`; después es editable en Gestión de Productos.

Todo consumidor de `VisitCoverage` que decida "trabaja / no trabaja" pasa por
`row_is_known()`. Un solo lugar, una sola regla.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

COVERAGE_CUTOFF_SETTING = "coverage_explicit_no_since"


def get_coverage_cutoff(db: Session) -> Optional[datetime]:
    """Timestamp (aware, UTC) desde el cual un `Works=False` es un "No" explícito.
    None = sin corte (todas las filas cuentan)."""
    from ..models.app_setting import AppSetting

    row = db.query(AppSetting.Value).filter(AppSetting.Key == COVERAGE_CUTOFF_SETTING).first()
    if not row or not row[0]:
        return None
    try:
        return _as_utc(datetime.fromisoformat(row[0].strip()))
    except ValueError:
        return None


def _as_utc(dt: datetime) -> datetime:
    """SQLite devuelve naive; Azure SQL aware. Se normaliza a UTC para comparar."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def row_is_known(works: bool, created_at: Optional[datetime], cutoff: Optional[datetime]) -> bool:
    """¿Esta fila de `VisitCoverage` aporta un dato real (Sí o No explícito)?

    - `Works=True` siempre es dato.
    - `Works=False` es dato solo si se cargó desde el corte en adelante (form
      de 3 estados). Antes del corte era ambiguo → se trata como "sin dato".
    """
    if works:
        return True
    if cutoff is None:
        return True
    if created_at is None:
        return False
    return _as_utc(created_at) >= cutoff


# ---------------------------------------------------------------------------
# Marca
# ---------------------------------------------------------------------------

# Marcas de más de una palabra (o cuyo nombre de SKU no arranca con la marca
# "comercial"). Se matchea el prefijo más largo; si nada matchea, la marca es
# la primera palabra del nombre ("Corona", "Kiel", "Zyn", "Bold").
BRAND_PREFIXES: tuple[tuple[str, str], ...] = (
    # Espert
    ("Van Kiff", "Van Kiff"),
    ("Milenio", "Milenio"),
    ("Melbourne", "Melbourne"),
    ("Mill", "Mill"),
    ("Lebonn", "Lebonn"),
    # Competencia
    ("Marlboro", "Marlboro"),
    ("Philip Morris", "Philip Morris"),
    ("Lucky", "Lucky Strike"),
    ("Luckies", "Lucky Strike"),
    ("Red Point", "Red Point"),
    ("Golden King", "Golden King"),
    ("Van Hasenn", "Van Hasenn"),
    ("4 Leguas", "4 Leguas"),
    ("Las Hojas", "Las Hojas"),
    ("Pier", "Pier"),
)


def brand_of(name: str) -> str:
    """Marca inferida del nombre del producto (backfill / fallback si `Brand` está vacío)."""
    n = (name or "").strip()
    if not n:
        return ""
    best = ""
    best_len = -1
    for prefix, brand in BRAND_PREFIXES:
        if n.lower().startswith(prefix.lower()) and len(prefix) > best_len:
            # Evita que "Mill" matchee "Millenium": el prefijo debe terminar en límite de palabra.
            rest = n[len(prefix):]
            if rest and rest[0].isalnum():
                continue
            best, best_len = brand, len(prefix)
    if best:
        return best
    return n.split()[0]


def product_brand(product) -> str:
    """`Brand` del producto, o la inferida por nombre si todavía no está cargada."""
    b = getattr(product, "Brand", None)
    return b.strip() if b and b.strip() else brand_of(getattr(product, "Name", "") or "")
