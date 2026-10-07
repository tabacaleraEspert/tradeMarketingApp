"""Normalización de nombres de proveedor / vendedor para evitar duplicados."""
import re
import unicodedata


def normalize_name(s: str | None) -> str:
    """minúsculas, sin tildes, espacios colapsados, trim."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s).strip().lower()
