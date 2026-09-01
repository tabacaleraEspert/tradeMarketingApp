"""Reasigna PDV.ZoneId a la zona correcta (prod, 2026-09-01).

Causa: el alta de PDV estampa la zona del usuario creador (NewPointOfSale.tsx
manda currentUser.zoneId; backend cae a current_user.ZoneId). Cuando arrancó el
censo los vendedores tenían zona AMBA → cientos de PDVs de MdP/Pergamino/
Córdoba/Rosario quedaron como AMBA.

Estrategia:
  1. Backup JSON de PDV(ZoneId) y Route(ZoneId) actuales.
  2. Rutas con ZoneId NULL → zona por mayoría geográfica de sus PDVs.
  3. PDV: zona correcta = zona de su ruta (si tiene); si no, caja geográfica.
     Solo se actualiza si difiere de la actual y hay clasificación confiable.

Uso:  python rezonify_pdvs_20260901.py           (dry-run, no toca nada)
      python rezonify_pdvs_20260901.py --apply   (aplica con backup)
"""
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import pymssql

HERE = Path(__file__).resolve().parent
src = (HERE.parent / "seed_azure.py").read_text()
SERVER = re.search(r'SERVER = "(.*?)"', src).group(1)
DB = re.search(r'DB = "(.*?)"', src).group(1)
USER = re.search(r'USER = "(.*?)"', src).group(1)
PWD = re.search(r'PWD = "(.*?)"', src).group(1)

# ZoneId prod: 18 AMBA · 19 BA Costa · 20 BA Núcleo · 21 NEA · 22 Córdoba
#              23 Patagonia Costa · 24 Patagonia Andina · 25 Litoral · 26 Cuyo · 27 NOA
AMBA, COSTA, NUCLEO, NEA, CBA, PAT_C, PAT_A, LITORAL, CUYO, NOA = (
    18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
)


def classify(lat: float, lon: float) -> int | None:
    """Zona por caja geográfica. None = fuera de toda caja (no se toca)."""
    if not (-56 < lat < -20 and -74 < lon < -53):
        return None  # coords fuera de Argentina (basura)
    if lat <= -39.5:
        return PAT_A if lon <= -69.5 else PAT_C
    if -39.5 <= lat <= -38.5 and -69.0 <= lon <= -67.5:
        return PAT_A  # Alto Valle (Neuquén/Cipolletti)
    if -37.5 <= lat <= -30.5 and -70.5 <= lon <= -65.5:
        return CUYO
    if lat >= -30 and lon <= -63.7:
        return NOA
    if -35.0 <= lat <= -29.8 and -65.8 <= lon <= -61.9:
        return CBA
    if -35.35 <= lat <= -34.2 and -59.35 <= lon <= -57.9:
        return AMBA
    if -35.0 <= lat <= -33.15 and -62.0 <= lon <= -59.3:
        return NUCLEO
    if -33.15 <= lat <= -30.0 and -61.9 <= lon <= -57.7:
        return LITORAL
    if -39.2 <= lat <= -35.8 and -59.5 <= lon <= -56.4:
        return COSTA
    if -38.9 <= lat <= -38.55 and -62.5 <= lon <= -62.0:
        return COSTA  # Bahía Blanca (consenso actual en prod)
    if lat >= -30.5 and lon > -63.7:
        return NEA
    return None


def main() -> None:
    apply = "--apply" in sys.argv
    conn = pymssql.connect(server=SERVER, user=USER, password=PWD, database=DB)
    cur = conn.cursor()

    cur.execute("SELECT ZoneId, Name FROM Zone")
    zname = dict(cur.fetchall())
    zname[None] = "(sin zona)"

    # Primera ruta activa por PDV (mismo criterio que build_map).
    cur.execute(
        """
        SELECT rp.PdvId, r.RouteId, r.Name, r.ZoneId
        FROM RoutePdv rp JOIN Route r ON r.RouteId = rp.RouteId
        WHERE r.IsActive = 1
        ORDER BY rp.PdvId, r.RouteId
        """
    )
    route_of: dict[int, tuple[int, str, int | None]] = {}
    for pid, rid, rname, rzone in cur.fetchall():
        route_of.setdefault(pid, (rid, rname, rzone))

    cur.execute(
        "SELECT PdvId, Name, ZoneId, Lat, Lon FROM PDV WHERE IsActive = 1"
    )
    pdvs = [
        (pid, name, zid, float(lat) if lat is not None else None,
         float(lon) if lon is not None else None)
        for pid, name, zid, lat, lon in cur.fetchall()
    ]

    # --- Paso 1: proponer zona para rutas con ZoneId NULL (mayoría geográfica)
    geo_by_route: dict[int, Counter] = defaultdict(Counter)
    for pid, _n, _z, lat, lon in pdvs:
        r = route_of.get(pid)
        if r and r[2] is None and lat is not None:
            g = classify(lat, lon)
            if g is not None:
                geo_by_route[r[0]][g] += 1

    route_fix: dict[int, int] = {}
    print("== Rutas sin zona → zona propuesta ==")
    for rid, counts in sorted(geo_by_route.items()):
        zid, votes = counts.most_common(1)[0]
        total = sum(counts.values())
        rname = next(r[1] for r in route_of.values() if r[0] == rid)
        flag = "" if votes / total >= 0.8 else "  ⚠️ mayoría débil, NO se toca"
        print(f"  Ruta {rid} '{rname.strip()}': {zname[zid]} ({votes}/{total}){flag}")
        if votes / total >= 0.8:
            route_fix[rid] = zid

    # Zona efectiva de la ruta después del fix.
    def route_zone(pid: int) -> int | None:
        r = route_of.get(pid)
        if not r:
            return None
        return r[2] if r[2] is not None else route_fix.get(r[0])

    # --- Paso 2: proponer zona correcta por PDV.
    # Regla: ruta y geo coinciden (o hay una sola fuente) → se aplica.
    #        Ruta y geo se contradicen → NO se toca (la membresía a la ruta o
    #        las coords están mal; se reporta para revisión manual).
    pdv_fix: list[tuple[int, str, int | None, int, str]] = []  # id, name, old, new, fuente
    sin_clasificar = []
    conflictos = []
    for pid, name, zid, lat, lon in pdvs:
        rz = route_zone(pid)
        g = classify(lat, lon) if lat is not None and lon is not None else None
        if rz is not None and g is not None and rz != g:
            if zid != rz:  # si ya está en la zona de su ruta, no molesta
                conflictos.append((pid, name, zid, rz, g, lat, lon))
            continue
        if rz is not None:
            new, fuente = rz, f"ruta '{route_of[pid][1].strip()}'"
        elif g is not None:
            new, fuente = g, f"geo ({lat:.3f},{lon:.3f})"
        elif lat is not None and zid is not None:
            sin_clasificar.append((pid, name, lat, lon))
            continue
        else:
            continue  # sin ruta y sin coords: no hay con qué clasificar
        if new != zid:
            pdv_fix.append((pid, name, zid, new, fuente))

    print(f"\n== PDVs a reasignar: {len(pdv_fix)} ==")
    resumen = Counter((zname[old], zname[new]) for _, _, old, new, _ in pdv_fix)
    for (old, new), n in resumen.most_common():
        print(f"  {old} → {new}: {n}")
    print("\nDetalle:")
    for pid, name, old, new, fuente in pdv_fix:
        print(f"  PDV {pid} '{name}': {zname[old]} → {zname[new]}  [{fuente}]")
    if sin_clasificar:
        print(f"\n== Sin clasificar (coords raras, quedan como están): {len(sin_clasificar)} ==")
        for pid, name, lat, lon in sin_clasificar:
            print(f"  PDV {pid} '{name}' ({lat},{lon})")
    if conflictos:
        print(f"\n== CONFLICTO ruta vs geo (quedan como están, revisar a mano): {len(conflictos)} ==")
        for pid, name, zid, rz, g, lat, lon in conflictos:
            print(
                f"  PDV {pid} '{name}': actual {zname[zid]} · ruta dice {zname[rz]}"
                f" · coords ({lat:.3f},{lon:.3f}) dicen {zname[g]}"
            )

    if not apply:
        print("\nDRY-RUN: no se tocó nada. Correr con --apply para aplicar.")
        return

    # --- Backup + apply
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = {
        "timestamp": ts,
        "pdvs": [{"PdvId": pid, "ZoneId": old} for pid, _, old, _, _ in pdv_fix],
        "routes": [{"RouteId": rid, "ZoneId": None} for rid in route_fix],
    }
    bpath = HERE / f"backup_pdv_zones_{ts}.json"
    bpath.write_text(json.dumps(backup, indent=2))
    print(f"\nBackup: {bpath}")

    for rid, zid in route_fix.items():
        cur.execute("UPDATE Route SET ZoneId=%s WHERE RouteId=%s AND ZoneId IS NULL", (zid, rid))
    for pid, _, _, new, _ in pdv_fix:
        cur.execute("UPDATE PDV SET ZoneId=%s, UpdatedAt=GETUTCDATE() WHERE PdvId=%s", (new, pid))
    conn.commit()
    print(f"APLICADO: {len(route_fix)} rutas zonificadas, {len(pdv_fix)} PDVs reasignados.")

    # Verificación: PDVs cuya zona sigue contradiciendo a su ruta.
    cur.execute(
        """
        SELECT COUNT(*) FROM PDV p
        JOIN RoutePdv rp ON rp.PdvId = p.PdvId
        JOIN Route r ON r.RouteId = rp.RouteId AND r.IsActive = 1
        WHERE p.IsActive = 1 AND r.ZoneId IS NOT NULL AND p.ZoneId <> r.ZoneId
        """
    )
    print(f"Verificación — PDVs que aún contradicen la zona de su ruta: {cur.fetchone()[0]}")


if __name__ == "__main__":
    main()
