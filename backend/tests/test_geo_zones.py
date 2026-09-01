"""Zona derivada de coordenadas en el alta de PDV (app/utils/geo_zones.py).

La herencia de la zona del creador generó cientos de PDVs mal zonificados
(backfill 2026-09-01): si las coordenadas caen claramente en otra zona, ganan
las coordenadas.
"""
import uuid

import pytest

from app.utils.geo_zones import zone_name_from_coords


def _uid():
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# Unit: clasificador geográfico
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "lat,lon,expected",
    [
        (-34.6037, -58.3816, "AMBA"),                 # CABA
        (-34.9214, -57.9544, "AMBA"),                 # La Plata
        (-38.0055, -57.5426, "Buenos Aires Costa"),   # Mar del Plata
        (-36.7169, -56.6767, "Buenos Aires Costa"),   # Mar de Ajó
        (-38.7196, -62.2724, "Buenos Aires Costa"),   # Bahía Blanca
        (-33.8964, -60.5732, "Buenos Aires Núcleo"),  # Pergamino
        (-33.3358, -60.2107, "Buenos Aires Núcleo"),  # San Nicolás
        (-31.4201, -64.1888, "Córdoba"),              # Córdoba capital
        (-32.9442, -60.6505, "Litoral"),              # Rosario
        (-31.3893, -58.0209, "Litoral"),              # Concordia
        (-32.8895, -68.8458, "Cuyo"),                 # Mendoza
        (-24.7821, -65.4232, "NOA"),                  # Salta
        (-27.3671, -55.8961, "NEA"),                  # Posadas
        (-38.9516, -68.0591, "Patagonia Andina"),     # Neuquén (Alto Valle)
        (-41.1335, -71.3103, "Patagonia Andina"),     # Bariloche
        (-40.8135, -62.9967, "Patagonia Costa"),      # Viedma
        (-45.8641, -67.4966, "Patagonia Costa"),      # Comodoro Rivadavia
        (21.5012, -104.8782, None),                   # México (coords basura)
        (32.9483, -96.7299, None),                    # Texas (coords basura)
        (0.0, 0.0, None),                             # null island
    ],
)
def test_zone_name_from_coords(lat, lon, expected):
    assert zone_name_from_coords(lat, lon) == expected


# ---------------------------------------------------------------------------
# Integración: POST /pdvs corrige la zona heredada cuando las coords contradicen
# ---------------------------------------------------------------------------

def _make_channel(client):
    resp = client.post("/channels", json={"Name": f"Ch_{_uid()}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _get_or_make_zone(client, name):
    zones = client.get("/zones").json()
    items = zones["items"] if isinstance(zones, dict) and "items" in zones else zones
    for z in items:
        if z["Name"] == name:
            return z
    resp = client.post("/zones", json={"Name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_pdv_coords_override_inherited_zone(client):
    """Body dice AMBA, coords dicen Córdoba → gana Córdoba."""
    channel = _make_channel(client)
    amba = _get_or_make_zone(client, "AMBA")
    cordoba = _get_or_make_zone(client, "Córdoba")
    resp = client.post("/pdvs", json={
        "Name": f"PDV_{_uid()}", "ChannelId": channel["ChannelId"], "IsActive": True,
        "ZoneId": amba["ZoneId"], "Lat": -31.4201, "Lon": -64.1888,
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["ZoneId"] == cordoba["ZoneId"]


def test_create_pdv_coords_agree_keeps_zone(client):
    """Body dice AMBA y coords son CABA → queda AMBA."""
    channel = _make_channel(client)
    amba = _get_or_make_zone(client, "AMBA")
    resp = client.post("/pdvs", json={
        "Name": f"PDV_{_uid()}", "ChannelId": channel["ChannelId"], "IsActive": True,
        "ZoneId": amba["ZoneId"], "Lat": -34.6037, "Lon": -58.3816,
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["ZoneId"] == amba["ZoneId"]


def test_create_pdv_garbage_coords_keep_inherited_zone(client):
    """Coords basura (fuera de Argentina) → no se toca la zona heredada."""
    channel = _make_channel(client)
    amba = _get_or_make_zone(client, "AMBA")
    resp = client.post("/pdvs", json={
        "Name": f"PDV_{_uid()}", "ChannelId": channel["ChannelId"], "IsActive": True,
        "ZoneId": amba["ZoneId"], "Lat": 21.5012, "Lon": -104.8782,
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["ZoneId"] == amba["ZoneId"]


def test_create_pdv_unknown_geo_zone_name_keeps_inherited(client):
    """Coords válidas pero cuya zona no existe en la tabla Zone del entorno
    (p.ej. 'Cuyo' no creada) → gana la herencia, no rompe."""
    channel = _make_channel(client)
    zone = _get_or_make_zone(client, f"Zona_{_uid()}")
    resp = client.post("/pdvs", json={
        "Name": f"PDV_{_uid()}", "ChannelId": channel["ChannelId"], "IsActive": True,
        "ZoneId": zone["ZoneId"], "Lat": -32.8895, "Lon": -68.8458,  # Mendoza
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["ZoneId"] == zone["ZoneId"]
