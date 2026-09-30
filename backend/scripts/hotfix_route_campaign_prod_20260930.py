"""Hotfix prod 2026-09-30: rutas de campaña + fecha de fin (migración 0025).

Prod no está trackeado por Alembic — replica 0025_route_campaign_enddate.py:
  1. ALTER Route ADD RouteType NVARCHAR(20) NOT NULL DEFAULT 'regular' (+ índice).
  2. ALTER Route ADD EndDate DATE NULL.

CORRER ANTES del deploy del backend: el modelo nuevo hace SELECT de ambas columnas
(sin ellas, TODOS los endpoints de rutas darían 500 — incidente 2026-08-04).
Credenciales: DATABASE_* del entorno o backend/.env. Idempotente.
Uso (desde backend/): python scripts/hotfix_route_campaign_prod_20260930.py [--dry-run]
"""
import sys
from pathlib import Path

import pymssql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings

COLUMNS = [
    ("RouteType", [
        "ALTER TABLE Route ADD RouteType NVARCHAR(20) NOT NULL CONSTRAINT DF_Route_RouteType DEFAULT 'regular'",
        "CREATE INDEX ix_Route_RouteType ON Route(RouteType)",
    ]),
    ("EndDate", ["ALTER TABLE Route ADD EndDate DATE NULL"]),
]


def main(dry_run: bool):
    if not (settings.database_user and settings.database_password):
        sys.exit("Faltan DATABASE_USER / DATABASE_PASSWORD (env o backend/.env)")
    conn = pymssql.connect(
        server=settings.database_server, user=settings.database_user,
        password=settings.database_password, database=settings.database_name, login_timeout=90,
    )
    cur = conn.cursor()
    for col, stmts in COLUMNS:
        cur.execute("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('Route') AND name = %s", (col,))
        if cur.fetchone()[0]:
            print(f"Route.{col} ya existe — salto")
            continue
        for stmt in stmts:
            if dry_run:
                print(f"[dry-run] {stmt}")
            else:
                cur.execute(stmt)
        if not dry_run:
            conn.commit()
            print(f"Route.{col} creada")
    cur.execute("SELECT COUNT(*) FROM Route")
    print(f"Rutas existentes: {cur.fetchone()[0]} (quedan como 'regular', sin fecha de fin)")
    conn.close()


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
