"""Hotfix prod 2026-09-23: Product.Brand (migración 0023) + corte del censo 3 estados.

Prod no está trackeado por Alembic — replica 0023_product_brand_coverage_cutoff.py:
  1. ALTER Product ADD Brand NVARCHAR(60) NULL + índice (salta si ya existe).
  2. Backfill Brand por prefijo del nombre (solo filas con Brand NULL/vacío).
  3. AppSetting `coverage_explicit_no_since` = ahora (UTC): desde este instante
     un `Works=False` es un "No" explícito; los anteriores pasan a "sin dato".
     Solo se inserta si no existe (no pisa un corte previo).

CORRER ANTES del deploy del backend: el modelo nuevo hace SELECT de Brand.
Idempotente. Uso: python scripts/hotfix_product_brand_prod_20260923.py [--dry-run]
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

import pymssql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.coverage_semantics import COVERAGE_CUTOFF_SETTING, brand_of

SERVER = "trade-mkt-sql.database.windows.net"
DB = "trademktdb"
USER = "tmadmin"
PWD = "TradeMkt2026Azr99"


def main(dry_run: bool):
    conn = pymssql.connect(server=SERVER, user=USER, password=PWD, database=DB, login_timeout=90)
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('Product') AND name = 'Brand'")
    if cur.fetchone()[0]:
        print("Product.Brand ya existe — salto el ALTER")
    elif dry_run:
        print("[dry-run] ALTER TABLE Product ADD Brand NVARCHAR(60) NULL")
    else:
        cur.execute("ALTER TABLE Product ADD Brand NVARCHAR(60) NULL")
        cur.execute("CREATE INDEX ix_Product_Brand ON Product(Brand)")
        conn.commit()
        print("Columna Product.Brand + índice creados")

    if dry_run:
        cur.execute("SELECT ProductId, Name FROM Product")
    else:
        cur.execute("SELECT ProductId, Name FROM Product WHERE Brand IS NULL OR LTRIM(RTRIM(Brand)) = ''")
    rows = cur.fetchall()
    for pid, name in rows:
        brand = brand_of(name)
        print(f"  {name!r:40} → {brand}")
        if not dry_run:
            cur.execute("UPDATE Product SET Brand = %s WHERE ProductId = %s", (brand, pid))
    if not dry_run:
        conn.commit()
    print(f"Backfill: {len(rows)} productos")

    cur.execute("SELECT Value FROM AppSetting WHERE [Key] = %s", (COVERAGE_CUTOFF_SETTING,))
    row = cur.fetchone()
    if row:
        print(f"Corte ya seteado: {row[0]} — no se pisa")
    else:
        now = datetime.now(timezone.utc).isoformat()
        if dry_run:
            print(f"[dry-run] INSERT AppSetting {COVERAGE_CUTOFF_SETTING} = {now}")
        else:
            cur.execute(
                "INSERT INTO AppSetting ([Key], Value, Description, UpdatedAt) VALUES (%s, %s, %s, SYSDATETIMEOFFSET())",
                (COVERAGE_CUTOFF_SETTING, now, "Desde cuándo un Works=False del censo es un No explícito (form 3 estados)"),
            )
            conn.commit()
            print(f"Corte seteado: {now}")
    conn.close()


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
