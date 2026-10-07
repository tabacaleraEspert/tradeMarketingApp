"""Hotfix prod 2026-10-07: proveedor con vendedores (migración 0026).

Prod no está trackeado por Alembic — replica 0026_supplier_sellers.py:
  1. CREATE TABLE Supplier (+ FKs Zone/SupplierType/User, índice ZoneId).
  2. CREATE TABLE SupplierSeller (+ FK Supplier ON DELETE CASCADE, índice SupplierId).
  3. ALTER PdvSupplier ADD SupplierId / SupplierSellerId (NULL) + FKs + índice.
No toca columnas existentes de PdvSupplier.

CORRER ANTES del deploy del backend: el modelo nuevo de PdvSupplier hace SELECT de
SupplierId/SupplierSellerId (sin ellas, censo/inteligencia/reportes darían 500).
Credenciales: DATABASE_* del entorno o backend/.env. Idempotente (chequea sys.*).
Uso (desde backend/): python scripts/hotfix_supplier_sellers_prod_20261007.py [--dry-run]
Después: python scripts/migrate_suppliers_sellers.py --propose ... (migración de datos).
"""
import sys
from pathlib import Path

import pymssql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings

TABLES = [
    ("Supplier", """
CREATE TABLE Supplier (
    SupplierId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Supplier PRIMARY KEY,
    ZoneId INT NULL CONSTRAINT FK_Supplier_Zone REFERENCES Zone(ZoneId),
    Name NVARCHAR(120) NOT NULL,
    SupplierTypeId INT NULL CONSTRAINT FK_Supplier_SupplierType REFERENCES SupplierType(SupplierTypeId),
    Products NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Supplier_IsActive DEFAULT 1,
    CreatedByUserId INT NULL CONSTRAINT FK_Supplier_User REFERENCES [User](UserId),
    CreatedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_Supplier_CreatedAt DEFAULT SYSDATETIMEOFFSET(),
    UpdatedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_Supplier_UpdatedAt DEFAULT SYSDATETIMEOFFSET()
)"""),
    ("SupplierSeller", """
CREATE TABLE SupplierSeller (
    SupplierSellerId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SupplierSeller PRIMARY KEY,
    SupplierId INT NOT NULL CONSTRAINT FK_SupplierSeller_Supplier REFERENCES Supplier(SupplierId) ON DELETE CASCADE,
    Name NVARCHAR(120) NOT NULL,
    Phone NVARCHAR(40) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_SupplierSeller_IsActive DEFAULT 1,
    CreatedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_SupplierSeller_CreatedAt DEFAULT SYSDATETIMEOFFSET()
)"""),
]

# (tabla, nombre índice, DDL)
INDEXES = [
    ("Supplier", "ix_Supplier_ZoneId", "CREATE INDEX ix_Supplier_ZoneId ON Supplier(ZoneId)"),
    ("SupplierSeller", "ix_SupplierSeller_SupplierId", "CREATE INDEX ix_SupplierSeller_SupplierId ON SupplierSeller(SupplierId)"),
    ("PdvSupplier", "ix_PdvSupplier_SupplierId", "CREATE INDEX ix_PdvSupplier_SupplierId ON PdvSupplier(SupplierId)"),
]

# (columna de PdvSupplier, DDL)
COLUMNS = [
    ("SupplierId", "ALTER TABLE PdvSupplier ADD SupplierId INT NULL"),
    ("SupplierSellerId", "ALTER TABLE PdvSupplier ADD SupplierSellerId INT NULL"),
]

# (nombre FK, DDL)
FKS = [
    ("FK_PdvSupplier_Supplier",
     "ALTER TABLE PdvSupplier ADD CONSTRAINT FK_PdvSupplier_Supplier FOREIGN KEY (SupplierId) REFERENCES Supplier(SupplierId)"),
    ("FK_PdvSupplier_SupplierSeller",
     "ALTER TABLE PdvSupplier ADD CONSTRAINT FK_PdvSupplier_SupplierSeller FOREIGN KEY (SupplierSellerId) REFERENCES SupplierSeller(SupplierSellerId)"),
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

    for table, ddl in TABLES:
        cur.execute("SELECT COUNT(*) FROM sys.tables WHERE name = %s", (table,))
        if cur.fetchone()[0]:
            print(f"Tabla {table} ya existe — salto")
            continue
        _run(cur, conn, ddl, dry_run, f"Tabla {table} creada")

    for col, ddl in COLUMNS:
        cur.execute("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('PdvSupplier') AND name = %s", (col,))
        if cur.fetchone()[0]:
            print(f"PdvSupplier.{col} ya existe — salto")
            continue
        _run(cur, conn, ddl, dry_run, f"PdvSupplier.{col} creada")

    for fk, ddl in FKS:
        cur.execute("SELECT COUNT(*) FROM sys.foreign_keys WHERE name = %s", (fk,))
        if cur.fetchone()[0]:
            print(f"FK {fk} ya existe — salto")
            continue
        _run(cur, conn, ddl, dry_run, f"FK {fk} creada")

    for table, ix, ddl in INDEXES:
        cur.execute(
            "SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID(%s) AND name = %s", (table, ix),
        )
        if cur.fetchone()[0]:
            print(f"Índice {ix} ya existe — salto")
            continue
        _run(cur, conn, ddl, dry_run, f"Índice {ix} creado")

    if not dry_run:
        cur.execute("SELECT COUNT(*) FROM PdvSupplier WHERE SupplierId IS NULL")
        print(f"Filas PdvSupplier sin SupplierId (a migrar con migrate_suppliers_sellers.py): {cur.fetchone()[0]}")
    conn.close()


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
