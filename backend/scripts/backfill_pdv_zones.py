"""Backfill de PDV.ZoneId para PDVs creados sin zona.

Causa: sesiones viejas del frontend no mandaban ZoneId en el alta de PDV
(el zoneId cacheado en localStorage no se refrescaba), y el backend lo
guardaba NULL. Esos PDVs no aparecen en listados filtrados por zona
(ej: "Buscar PDV" de un rep).

Fuente de la zona (en orden):
  1. Zona del usuario asignado/creador (PDV.AssignedUserId -> User.ZoneId)
  2. Zona de alguna ruta que contenga el PDV (RoutePdv -> Route.ZoneId)

Uso:
  python scripts/backfill_pdv_zones.py            # dry-run (no escribe)
  python scripts/backfill_pdv_zones.py --apply    # aplica y guarda backup JSON
  python scripts/backfill_pdv_zones.py --rollback backup_pdv_zones_YYYYmmdd_HHMMSS.json

Credenciales: DATABASE_SERVER/DATABASE_NAME/DATABASE_USER/DATABASE_PASSWORD
(las mismas env vars que el backend).
"""

import argparse
import json
import os
import sys
from datetime import datetime

import pymssql


def connect():
    return pymssql.connect(
        server=os.environ.get("DATABASE_SERVER", "trade-mkt-sql.database.windows.net"),
        database=os.environ.get("DATABASE_NAME", "trademktdb"),
        user=os.environ["DATABASE_USER"],
        password=os.environ["DATABASE_PASSWORD"],
        login_timeout=90,
    )


def plan_updates(cur):
    """Devuelve [(pdv_id, name, new_zone_id, source)] para PDVs con ZoneId NULL."""
    cur.execute(
        """
        SELECT p.PdvId, p.Name, u.ZoneId AS CreatorZone,
               (SELECT TOP 1 r.ZoneId FROM RoutePdv rp
                JOIN Route r ON r.RouteId = rp.RouteId
                WHERE rp.PdvId = p.PdvId AND r.ZoneId IS NOT NULL) AS RouteZone
        FROM PDV p
        LEFT JOIN [User] u ON u.UserId = p.AssignedUserId
        WHERE p.ZoneId IS NULL
        ORDER BY p.PdvId
        """
    )
    plan, unresolved = [], []
    for pdv_id, name, creator_zone, route_zone in cur.fetchall():
        if creator_zone is not None:
            plan.append((pdv_id, name, creator_zone, "creador"))
        elif route_zone is not None:
            plan.append((pdv_id, name, route_zone, "ruta"))
        else:
            unresolved.append((pdv_id, name))
    return plan, unresolved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Aplicar los UPDATEs (default: dry-run)")
    ap.add_argument("--rollback", metavar="BACKUP_JSON", help="Revertir usando un backup previo")
    args = ap.parse_args()

    conn = connect()
    cur = conn.cursor()

    if args.rollback:
        with open(args.rollback) as f:
            backup = json.load(f)
        for row in backup["updates"]:
            cur.execute(
                "UPDATE PDV SET ZoneId = %s WHERE PdvId = %s",
                (row["old_zone_id"], row["pdv_id"]),
            )
        conn.commit()
        print(f"Rollback aplicado: {len(backup['updates'])} PDVs restaurados a ZoneId previo.")
        return

    plan, unresolved = plan_updates(cur)
    print(f"PDVs sin zona: {len(plan) + len(unresolved)} | resolubles: {len(plan)} | sin fuente: {len(unresolved)}")
    for pdv_id, name, zone_id, source in plan:
        print(f"  PDV {pdv_id:>5} -> zona {zone_id} (via {source}): {name}")
    for pdv_id, name in unresolved:
        print(f"  PDV {pdv_id:>5} SIN RESOLVER (sin creador con zona ni ruta): {name}")

    if not args.apply:
        print("\nDry-run. Ejecutá con --apply para escribir.")
        return

    if not plan:
        print("Nada que aplicar.")
        return

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(os.path.dirname(__file__), f"backup_pdv_zones_{stamp}.json")
    with open(backup_path, "w") as f:
        json.dump(
            {
                "created_at": stamp,
                "updates": [
                    {"pdv_id": pdv_id, "old_zone_id": None, "new_zone_id": zone_id}
                    for pdv_id, _, zone_id, _ in plan
                ],
            },
            f,
            indent=2,
        )
    print(f"\nBackup guardado en {backup_path}")

    for pdv_id, _, zone_id, _ in plan:
        # Solo si sigue NULL: no pisar una zona asignada entre el plan y el apply
        cur.execute(
            "UPDATE PDV SET ZoneId = %s WHERE PdvId = %s AND ZoneId IS NULL",
            (zone_id, pdv_id),
        )
    conn.commit()

    cur.execute("SELECT COUNT(*) FROM PDV WHERE ZoneId IS NULL")
    remaining = cur.fetchone()[0]
    print(f"Aplicado: {len(plan)} PDVs actualizados. Quedan {remaining} sin zona.")


if __name__ == "__main__":
    main()
    sys.exit(0)
