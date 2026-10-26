"""Reasignación masiva 26/10/2026: Sebastian Morales (94) → Alejandro Trica (140).

Misma lógica que PATCH /routes/{id} con AssignedUserId (routers/routes.py:update_route), en lote:
  1. Rutas regulares del origen → destino (+ AuditEvent ROUTE_UPDATE por ruta, actor = Davor).
  2. RouteDay futuros PLANNED de esas rutas → destino.
  3. Todos los PDV con AssignedUserId = origen → destino (incluye los que no están en ruta).
Una sola transacción. Backup JSON antes de escribir. Dry-run por default; --commit escribe.

    cd backend && source venv/bin/activate && python scripts/reassign_trade_20261026.py [--commit]
"""
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import pymssql

FROM_USER, TO_USER = 94, 140
ACTOR_EMAIL = "davor@tabacaleraespert.com"
COMMIT = "--commit" in sys.argv
TODAY = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date()

c = pymssql.connect(
    server=os.environ.get("DATABASE_SERVER", "trade-mkt-sql.database.windows.net"),
    user=os.environ["DATABASE_USER"], password=os.environ["DATABASE_PASSWORD"],
    database=os.environ.get("DATABASE_NAME", "trademktdb"), login_timeout=90, as_dict=True,
)
cur = c.cursor()

cur.execute("SELECT UserId, DisplayName, IsActive FROM [User] WHERE UserId IN (%s, %s)", (FROM_USER, TO_USER))
users = {u["UserId"]: u for u in cur.fetchall()}
assert set(users) == {FROM_USER, TO_USER}, users
print("origen:", users[FROM_USER], "\ndestino:", users[TO_USER])
cur.execute("SELECT UserId FROM [User] WHERE Email=%s", (ACTOR_EMAIL,))
actor_id = cur.fetchone()["UserId"]

cur.execute(
    "SELECT RouteId, Name, AssignedUserId, RouteType FROM Route WHERE AssignedUserId=%s "
    "AND (RouteType IS NULL OR RouteType <> 'campaign')", (FROM_USER,),
)
routes = cur.fetchall()
route_ids = [r["RouteId"] for r in routes]
days, pdvs = [], []
if route_ids:
    ph = ",".join(["%s"] * len(route_ids))
    cur.execute(
        f"SELECT RouteDayId, RouteId, WorkDate, AssignedUserId FROM RouteDay WHERE RouteId IN ({ph}) "
        "AND WorkDate >= %s AND Status = 'PLANNED'", (*route_ids, TODAY),
    )
    days = cur.fetchall()
cur.execute("SELECT PdvId, Name, AssignedUserId FROM PDV WHERE AssignedUserId=%s", (FROM_USER,))
pdvs = cur.fetchall()

print(f"rutas: {len(routes)} | días futuros PLANNED: {len(days)} | PDVs: {len(pdvs)}")
for r in routes:
    print("  ", r["RouteId"], r["Name"])

if not COMMIT:
    print("[dry-run] nada escrito. Correr con --commit.")
    sys.exit(0)

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = os.path.join(os.path.dirname(__file__), f"backup_reassign_{FROM_USER}_to_{TO_USER}_{stamp}.json")
with open(backup, "w") as f:
    json.dump({"routes": routes, "route_days": days, "pdvs": pdvs}, f, default=str, ensure_ascii=False, indent=1)
print("backup:", backup)

try:
    for r in routes:
        cur.execute("UPDATE Route SET AssignedUserId=%s WHERE RouteId=%s", (TO_USER, r["RouteId"]))
        cur.execute(
            "INSERT INTO AuditEvent (UserId, Entity, EntityId, Action, PayloadJson) VALUES (%s, 'Route', %s, 'ROUTE_UPDATE', %s)",
            (actor_id, r["RouteId"], json.dumps(
                {"antes": {"AssignedUserId": FROM_USER}, "despues": {"AssignedUserId": TO_USER},
                 "motivo": "reasignación masiva script 26/10"}, ensure_ascii=False)),
        )
    for d in days:
        cur.execute("UPDATE RouteDay SET AssignedUserId=%s WHERE RouteDayId=%s", (TO_USER, d["RouteDayId"]))
    cur.execute("UPDATE PDV SET AssignedUserId=%s WHERE AssignedUserId=%s", (TO_USER, FROM_USER))
    print("PDVs actualizados:", cur.rowcount)
    c.commit()
    print("COMMIT ok")
except Exception:
    c.rollback()
    raise

cur.execute("SELECT COUNT(*) n FROM Route WHERE AssignedUserId=%s", (TO_USER,))
print("rutas de destino ahora:", cur.fetchone()["n"])
cur.execute("SELECT COUNT(*) n FROM PDV WHERE AssignedUserId=%s", (FROM_USER,))
print("PDVs que quedan en origen:", cur.fetchone()["n"])
