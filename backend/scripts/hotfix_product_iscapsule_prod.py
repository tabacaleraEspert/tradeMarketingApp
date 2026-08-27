"""Hotfix prod: Product.IsCapsule (migración 0022) vía ALTER quirúrgico.

Prod no está trackeado por Alembic — replica 0022_product_iscapsule.py:
columna BIT NOT NULL DEFAULT 0 + backfill por lista de nombres. Idempotente:
salta el ALTER si la columna ya existe y el UPDATE solo toca filas en 0.
"""
import sys
from pathlib import Path

import pymssql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.intelligence import CAPSULE_PRODUCT_NAMES

SERVER = "trade-mkt-sql.database.windows.net"
DB = "trademktdb"
USER = "tmadmin"
PWD = "TradeMkt2026Azr99"


def main():
    conn = pymssql.connect(server=SERVER, user=USER, password=PWD, database=DB, login_timeout=90)
    cur = conn.cursor()

    cur.execute(
        "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('Product') AND name = 'IsCapsule'"
    )
    if cur.fetchone()[0]:
        print("Product.IsCapsule ya existe — salto el ALTER")
    else:
        cur.execute("ALTER TABLE Product ADD IsCapsule BIT NOT NULL DEFAULT 0")
        conn.commit()
        print("Columna Product.IsCapsule creada")

    placeholders = ",".join(["%s"] * len(CAPSULE_PRODUCT_NAMES))
    cur.execute(
        f"UPDATE Product SET IsCapsule = 1 WHERE IsCapsule = 0 AND Name IN ({placeholders})",
        tuple(CAPSULE_PRODUCT_NAMES),
    )
    print(f"Backfill: {cur.rowcount} productos marcados capsulados")
    conn.commit()

    cur.execute("SELECT Name, Manufacturer FROM Product WHERE IsCapsule = 1 ORDER BY Manufacturer, Name")
    for name, fab in cur.fetchall():
        print(f"  {fab or '—'}: {name}")
    conn.close()


if __name__ == "__main__":
    main()
