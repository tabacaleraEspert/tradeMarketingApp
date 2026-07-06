"""
Backfill de visitas "huérfanas": visitas con RouteDayId NULL cuyo PDV SÍ está
en la ruta de ESE día del usuario. Las ata a su RouteDay y marca el RouteDayPdv
como DONE (visita cerrada) o IN_PROGRESS (abierta), sin degradar estados ya DONE.

Contexto: el front pasaba el RouteDayId solo por navigation state y se perdía
(buscar PDV, kiosco cercano, reload, sync offline) → la visita quedaba desligada
y el progreso de la ruta ("hechas/faltan") no avanzaba. El fix de código
(visits.py::_resolve_route_day_id) evita nuevas huérfanas; este script corrige
las históricas.

Hace BACKUP JSON antes de tocar nada (para rollback). Por defecto DRY-RUN;
pasar APPLY=1 para aplicar.

Uso:
    python scripts/backfill_orphan_visit_routedays.py          # dry-run
    APPLY=1 python scripts/backfill_orphan_visit_routedays.py  # aplica
"""
import json
import os
from datetime import datetime, timezone

import pymssql

SERVER = os.environ.get("DATABASE_SERVER", "trade-mkt-sql.database.windows.net")
DB = os.environ.get("DATABASE_NAME", "trademktdb")
USER = os.environ.get("DATABASE_USER", "tmadmin")
PWD = os.environ.get("DATABASE_PASSWORD", "TradeMkt2026Azr99")
APPLY = os.environ.get("APPLY") == "1"

# Visitas huérfanas recuperables + el RouteDay que les corresponde (MIN si hay
# más de una ruta ese día con el mismo PDV) + estado destino del RouteDayPdv.
SELECT_ORPHANS = """
SELECT
    v.VisitId, v.PdvId, v.UserId, v.Status, CAST(v.OpenedAt AS date) AS WorkDate,
    (SELECT MIN(rd.RouteDayId)
       FROM RouteDay rd
       JOIN RouteDayPdv rdp ON rdp.RouteDayId = rd.RouteDayId
      WHERE rd.AssignedUserId = v.UserId
        AND rd.WorkDate = CAST(v.OpenedAt AS date)
        AND rdp.PdvId = v.PdvId) AS ResolvedRouteDayId
FROM Visit v
WHERE v.RouteDayId IS NULL
  AND EXISTS (
      SELECT 1 FROM RouteDay rd
      JOIN RouteDayPdv rdp ON rdp.RouteDayId = rd.RouteDayId
      WHERE rd.AssignedUserId = v.UserId
        AND rd.WorkDate = CAST(v.OpenedAt AS date)
        AND rdp.PdvId = v.PdvId)
ORDER BY v.OpenedAt
"""

CLOSED = {"CLOSED", "COMPLETED"}


def main():
    print(f"Conectando a {SERVER}/{DB} ...  (APPLY={APPLY})")
    conn = pymssql.connect(server=SERVER, user=USER, password=PWD, database=DB, login_timeout=90)
    cur = conn.cursor()

    cur.execute(SELECT_ORPHANS)
    orphans = cur.fetchall()  # (VisitId, PdvId, UserId, Status, WorkDate, ResolvedRouteDayId)
    print(f"Visitas huérfanas recuperables: {len(orphans)}")
    if not orphans:
        conn.close()
        return

    # Estado destino por visita
    plan = []
    rdp_keys = set()
    for vid, pdvid, uid, status, wd, rdid in orphans:
        if rdid is None:
            continue
        target = "DONE" if (status or "").upper() in CLOSED else "IN_PROGRESS"
        plan.append({"VisitId": vid, "PdvId": pdvid, "UserId": uid,
                     "Status": status, "WorkDate": str(wd),
                     "RouteDayId": rdid, "TargetExec": target})
        rdp_keys.add((rdid, pdvid))

    # BACKUP: estado actual de cada RouteDayPdv afectado (para rollback)
    rdp_before = {}
    for rdid, pdvid in rdp_keys:
        cur.execute(
            "SELECT ExecutionStatus FROM RouteDayPdv WHERE RouteDayId=%d AND PdvId=%d",
            (rdid, pdvid))
        row = cur.fetchone()
        rdp_before[f"{rdid}-{pdvid}"] = row[0] if row else None

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_dir = os.path.dirname(os.path.abspath(__file__))
    backup_path = os.path.join(out_dir, f"backup_backfill_orphan_visits_{stamp}.json")
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": stamp,
            "visits_set_routedayid": [{"VisitId": p["VisitId"], "from": None,
                                        "to": p["RouteDayId"]} for p in plan],
            "routedaypdv_before": rdp_before,
        }, f, indent=2, ensure_ascii=False)
    print(f"Backup: {backup_path}")

    # Resumen
    to_done = sum(1 for p in plan if p["TargetExec"] == "DONE")
    to_inprog = sum(1 for p in plan if p["TargetExec"] == "IN_PROGRESS")
    print(f"Visitas a atar: {len(plan)}  |  RouteDayPdv únicos: {len(rdp_keys)}"
          f"  |  -> DONE: {to_done}  -> IN_PROGRESS: {to_inprog}")

    if not APPLY:
        print("\nDRY-RUN. Nada aplicado. Correr con APPLY=1 para aplicar.")
        conn.close()
        return

    # APPLY (transaccional)
    n_visits = 0
    for p in plan:
        cur.execute("UPDATE Visit SET RouteDayId=%d WHERE VisitId=%d AND RouteDayId IS NULL",
                    (p["RouteDayId"], p["VisitId"]))
        n_visits += cur.rowcount
    # RouteDayPdv: DONE tiene prioridad; no degradar un DONE existente.
    n_done = n_inprog = 0
    for rdid, pdvid in rdp_keys:
        want_done = any(p["RouteDayId"] == rdid and p["PdvId"] == pdvid and p["TargetExec"] == "DONE" for p in plan)
        if want_done:
            cur.execute("UPDATE RouteDayPdv SET ExecutionStatus='DONE' "
                        "WHERE RouteDayId=%d AND PdvId=%d AND ExecutionStatus<>'DONE'",
                        (rdid, pdvid))
            n_done += cur.rowcount
        else:
            cur.execute("UPDATE RouteDayPdv SET ExecutionStatus='IN_PROGRESS' "
                        "WHERE RouteDayId=%d AND PdvId=%d AND ExecutionStatus='PENDING'",
                        (rdid, pdvid))
            n_inprog += cur.rowcount
    conn.commit()
    print(f"APLICADO: Visitas atadas={n_visits}  RouteDayPdv->DONE={n_done}  ->IN_PROGRESS={n_inprog}")
    conn.close()


if __name__ == "__main__":
    main()
