"""Parche manual 22/10/2026: ruta 330 "Zona 05 - Lateral San Carlos" planificada el viernes
23/10 para Christian (144) y Pablo (145) — salen juntos con Nahuel. Replica POST /routes/{id}/days
(RouteDay + copia de RoutePdv → RouteDayPdv). Idempotente. Dry-run por default; --commit escribe.

    cd backend && source venv/bin/activate && python scripts/patch_routeday_330_20261023.py [--commit]
"""
import os
import sys

import pyodbc

ROUTE_ID, WORK_DATE, USERS = 330, "2026-10-23", (144, 145)
COMMIT = "--commit" in sys.argv

c = pyodbc.connect(
    "DRIVER={ODBC Driver 18 for SQL Server};SERVER=trade-mkt-sql.database.windows.net;DATABASE=trademktdb;"
    f"UID={os.environ['DATABASE_USER']};PWD={os.environ['DATABASE_PASSWORD']};Encrypt=yes",
    timeout=90,
)
cur = c.cursor()
cur.execute("SELECT RouteId, Name, AssignedUserId, RouteType, EndDate, IsActive FROM Route WHERE RouteId=?", ROUTE_ID)
print("ruta:", cur.fetchone())
cur.execute("SELECT PdvId, SortOrder, Priority FROM RoutePdv WHERE RouteId=? ORDER BY SortOrder", ROUTE_ID)
rps = cur.fetchall()
print("PDVs en ruta:", len(rps))
cur.execute("SELECT UserId, Email, IsActive FROM [User] WHERE UserId IN (?, ?)", *USERS)
print("usuarios:", cur.fetchall())

for uid in USERS:
    cur.execute("SELECT RouteDayId, RouteId FROM RouteDay WHERE AssignedUserId=? AND WorkDate=?", uid, WORK_DATE)
    same_day = cur.fetchall()
    if same_day:
        print(f"  user {uid}: ya tiene días el {WORK_DATE}: {same_day}")
    if any(r.RouteId == ROUTE_ID for r in same_day):
        print(f"  user {uid}: ruta {ROUTE_ID} ya planificada → skip")
        continue
    if not COMMIT:
        print(f"  user {uid}: [dry-run] crearía RouteDay + {len(rps)} RouteDayPdv")
        continue
    cur.execute(
        "INSERT INTO RouteDay (RouteId, WorkDate, AssignedUserId, Status, CreatedAt) "
        "OUTPUT INSERTED.RouteDayId VALUES (?, ?, ?, 'PLANNED', SYSUTCDATETIME())",
        ROUTE_ID, WORK_DATE, uid,
    )
    rd_id = cur.fetchone()[0]
    cur.executemany(
        "INSERT INTO RouteDayPdv (RouteDayId, PdvId, PlannedOrder, Priority, ExecutionStatus) VALUES (?, ?, ?, ?, 'PENDING')",
        [(rd_id, r.PdvId, r.SortOrder, r.Priority) for r in rps],
    )
    print(f"  user {uid}: RouteDay {rd_id} creado con {len(rps)} PDVs")

if COMMIT:
    c.commit()
    print("COMMIT ok")
