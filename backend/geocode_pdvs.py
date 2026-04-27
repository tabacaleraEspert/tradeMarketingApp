#!/usr/bin/env python3
"""
Geocodifica PDVs sin coordenadas usando Google Maps Geocoding API.

Busca: "{Dirección}, {Ciudad}, {Provincia}, Argentina"
Actualiza Lat/Lon en la base de datos.

Ejecutar: python geocode_pdvs.py
"""
import os
import sys
import time
import json
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from decimal import Decimal

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy.orm import Session
from app.database import engine, SessionLocal, Base
from app.models.pdv import PDV

# Google Maps API key (from frontend .env or environment)
API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
if not API_KEY:
    # Try reading from frontend .env
    env_path = Path(__file__).parent.parent / "frontend" / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("VITE_GOOGLE_MAPS_API_KEY="):
                API_KEY = line.split("=", 1)[1].strip()
                break

if not API_KEY:
    print("ERROR: No se encontró GOOGLE_MAPS_API_KEY")
    sys.exit(1)

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

# Rate limit: Google allows 50 req/sec, we'll be conservative
DELAY_SECONDS = 0.1  # 10 req/sec


def geocode(address: str, city: str, province: str) -> tuple[float, float] | None:
    """Geocode an address using Google Maps API. Returns (lat, lon) or None."""
    full_address = f"{address}, {city}, {province}, Argentina"
    params = urlencode({"address": full_address, "key": API_KEY})
    url = f"{GEOCODE_URL}?{params}"

    try:
        req = Request(url)
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        if data["status"] == "OK" and data["results"]:
            loc = data["results"][0]["geometry"]["location"]
            return loc["lat"], loc["lng"]
        elif data["status"] == "ZERO_RESULTS":
            return None
        else:
            print(f"    API error: {data['status']} — {data.get('error_message', '')}")
            return None
    except Exception as e:
        print(f"    Network error: {e}")
        return None


def main():
    db = SessionLocal()
    try:
        # Find PDVs without coordinates
        pdvs = (
            db.query(PDV)
            .filter(PDV.IsActive == True, PDV.Lat == None)
            .order_by(PDV.PdvId)
            .all()
        )

        total = len(pdvs)
        if total == 0:
            print("Todos los PDVs ya tienen coordenadas.")
            return

        print(f"Geocodificando {total} PDVs sin coordenadas...\n")

        success = 0
        failed = 0
        for i, pdv in enumerate(pdvs, 1):
            address = pdv.Address or ""
            city = pdv.City or ""
            province = "Buenos Aires"  # Default

            if not address.strip():
                print(f"  [{i}/{total}] PDV {pdv.PdvId} — Sin dirección, saltando")
                failed += 1
                continue

            result = geocode(address, city, province)

            if result:
                lat, lon = result
                pdv.Lat = Decimal(str(round(lat, 6)))
                pdv.Lon = Decimal(str(round(lon, 6)))
                success += 1
                print(f"  [{i}/{total}] {address}, {city} → {lat:.6f}, {lon:.6f}")
            else:
                failed += 1
                print(f"  [{i}/{total}] {address}, {city} → NO ENCONTRADO")

            # Commit every 50 PDVs
            if i % 50 == 0:
                db.commit()
                print(f"  --- Guardados {i}/{total} ---")

            time.sleep(DELAY_SECONDS)

        db.commit()

        print(f"\n{'=' * 50}")
        print(f"Resultado: {success} geocodificados, {failed} fallidos de {total} total")
        print(f"{'=' * 50}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
