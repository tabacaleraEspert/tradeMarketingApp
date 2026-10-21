"""DDL prod 2026-10-19: flujo de visita por usuario (migración 0028_user_visit_flow).

Prod no está trackeado por Alembic — replica 0028_user_visit_flow.py:
  1. ALTER [User] ADD VisitFlow NVARCHAR(20) NOT NULL DEFAULT 'full'
     ("full" = visita de 7 pasos · "short" = check-in → formulario → resumen).
No toca columnas ni datos existentes (todos los usuarios quedan en "full").

CORRER ANTES del deploy del backend: el modelo nuevo de User hace SELECT de
VisitFlow (sin ella, login / usuarios / cualquier endpoint autenticado daría 500).
Credenciales: DATABASE_* del entorno o backend/.env. Idempotente (chequea sys.columns).
Uso (desde backend/): python scripts/ddl_user_visit_flow_20261019.py [--dry-run]
Después del deploy: marcar a los activadores con PATCH /users/{id} {"VisitFlow": "short"}
(o desde Admin → Usuarios → "Flujo de visita").
"""
import sys
from pathlib import Path

import pymssql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings

# (tabla, columna, DDL) — [User] va entre corchetes: es palabra reservada en SQL Server
COLUMNS = [
    ("User", "VisitFlow",
     "ALTER TABLE [User] ADD VisitFlow NVARCHAR(20) NOT NULL CONSTRAINT DF_User_VisitFlow DEFAULT 'full'"),
]


def _run(cur, conn, stmt: str, dry_run: bool, label: str):
    if dry_run:
        print(f"[dry-run] {' '.join(stmt.split())}")
        return
    cur.execute(stmt)
    conn.commit()
    print(f"{label} OK")


def main(dry_run: bool):
    if not (settings.database_user and settings.database_password):
        sys.exit("Faltan DATABASE_USER / DATABASE_PASSWORD (env o backend/.env)")
    conn = pymssql.connect(
        server=settings.database_server, user=settings.database_user,
        password=settings.database_password, database=settings.database_name, login_timeout=90,
    )
    cur = conn.cursor()

    for table, col, ddl in COLUMNS:
        cur.execute(
            "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(%s) AND name = %s",
            (f"[{table}]", col),
        )
        if cur.fetchone()[0]:
            print(f"{table}.{col} ya existe — salto")
            continue
        _run(cur, conn, ddl, dry_run, f"{table}.{col} creada")

    if not dry_run:
        cur.execute("SELECT VisitFlow, COUNT(*) FROM [User] GROUP BY VisitFlow")
        for flow, n in cur.fetchall():
            print(f"User.VisitFlow = {flow!r}: {n} usuarios")
    conn.close()


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
