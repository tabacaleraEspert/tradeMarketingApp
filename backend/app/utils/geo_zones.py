"""Clasificación geográfica de coordenadas → zona comercial.

El alta de PDV hereda la zona del usuario creador, lo que generó cientos de
PDVs mal zonificados cuando el usuario tenía la zona mal asignada o censaba
fuera de su territorio (backfill 2026-09-01, ver
scripts/rezonify_pdvs_20260901.py). Este helper permite corregir esa herencia
cuando las coordenadas del PDV caen claramente en otra zona.

Las cajas se expresan por NOMBRE de zona (no por ID) para no atar el código a
los IDs de prod: si el nombre no existe en la tabla Zone del entorno, no se
corrige nada y gana la herencia.
"""
from sqlalchemy.orm import Session

from ..models.zone import Zone

# Cajas geográficas (min_lat, max_lat, min_lon, max_lon) en orden de prioridad:
# las más específicas primero, porque algunas se solapan en los bordes.
_BOXES: list[tuple[str, float, float, float, float]] = [
    ("Patagonia Andina", -56.0, -39.5, -74.0, -69.5),
    ("Patagonia Costa", -56.0, -39.5, -69.5, -53.0),
    ("Patagonia Andina", -39.5, -38.5, -69.0, -67.5),  # Alto Valle (Neuquén/Cipolletti)
    ("Cuyo", -37.5, -30.5, -70.5, -65.5),
    ("Córdoba", -35.0, -29.8, -65.8, -61.9),
    ("AMBA", -35.35, -34.2, -59.35, -57.9),
    ("Buenos Aires Núcleo", -35.0, -33.15, -62.0, -59.3),
    ("Litoral", -33.15, -30.0, -61.9, -57.7),
    ("Buenos Aires Costa", -39.2, -35.8, -59.5, -56.4),
    ("Buenos Aires Costa", -38.9, -38.55, -62.5, -62.0),  # Bahía Blanca
    ("NOA", -30.0, -20.0, -70.0, -63.7),
    ("NEA", -30.5, -20.0, -63.7, -53.0),
]


def zone_name_from_coords(lat: float, lon: float) -> str | None:
    """Nombre de zona para unas coordenadas, o None si no caen en ninguna caja
    (incluye coordenadas basura fuera de Argentina)."""
    if not (-56 < lat < -20 and -74 < lon < -53):
        return None
    for name, min_lat, max_lat, min_lon, max_lon in _BOXES:
        if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
            return name
    return None


def zone_id_from_coords(db: Session, lat: float, lon: float) -> int | None:
    """ZoneId del entorno para unas coordenadas, o None si no se puede
    clasificar o el nombre no existe en la tabla Zone."""
    name = zone_name_from_coords(lat, lon)
    if name is None:
        return None
    zone = db.query(Zone.ZoneId).filter(Zone.Name == name).first()
    return zone.ZoneId if zone else None
