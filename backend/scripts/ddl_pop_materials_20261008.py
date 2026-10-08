"""DDL prod 2026-10-08: material POP real (migración 0027_pop_materials).

Prod no está trackeado por Alembic — replica 0027_pop_materials.py:
  1. CREATE TABLE PopMaterial (catálogo MKT sincronizado desde mobiliza).
  2. ALTER VisitPOPItem ADD MaterialCode NVARCHAR(30) NULL (sin FK).
  3. CREATE TABLE VisitPOPPlacement (+ FK Visit ON DELETE CASCADE, CHECK Quantity>=1,
     índices VisitId / MaterialCode).
No toca columnas ni datos existentes.

CORRER ANTES del deploy del backend: el modelo nuevo de VisitPOPItem hace SELECT de
MaterialCode (sin ella, censo POP / KPIs / tablero darían 500).
Credenciales: DATABASE_* del entorno o backend/.env. Idempotente (chequea sys.*).
Uso (desde backend/): python scripts/ddl_pop_materials_20261008.py [--dry-run]
Después del deploy: POST /pop-materials/sync (admin) o disparar el workflow
"Sync catálogo material POP" para cargar el catálogo.
"""
import sys
from pathlib import Path

import pymssql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings

TABLES = [
    ("PopMaterial", """
CREATE TABLE PopMaterial (
    Code NVARCHAR(30) NOT NULL CONSTRAINT PK_PopMaterial PRIMARY KEY,
    Description NVARCHAR(200) NOT NULL,
    Line NVARCHAR(80) NULL,
    Type NVARCHAR(120) NULL,
    Year INT NULL,
    PhotoUrl NVARCHAR(400) NULL,
    Stock FLOAT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_PopMaterial_IsActive DEFAULT 1,
    SyncedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_PopMaterial_SyncedAt DEFAULT SYSDATETIMEOFFSET()
)"""),
    ("VisitPOPPlacement", """
CREATE TABLE VisitPOPPlacement (
    VisitPOPPlacementId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_VisitPOPPlacement PRIMARY KEY,
    VisitId INT NOT NULL CONSTRAINT FK_VisitPOPPlacement_Visit REFERENCES Visit(VisitId) ON DELETE CASCADE,
    MaterialCode NVARCHAR(30) NULL,
    MaterialName NVARCHAR(200) NOT NULL,
    Quantity INT NOT NULL CONSTRAINT CK_VisitPOPPlacement_Quantity CHECK (Quantity >= 1),
    Location NVARCHAR(200) NULL,
    CreatedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_VisitPOPPlacement_CreatedAt DEFAULT SYSDATETIMEOFFSET()
)"""),
]

# (tabla, columna, DDL)
COLUMNS = [
    ("VisitPOPItem", "MaterialCode", "ALTER TABLE VisitPOPItem ADD MaterialCode NVARCHAR(30) NULL"),
]

# (tabla, nombre índice, DDL)
INDEXES = [
    ("VisitPOPPlacement", "ix_VisitPOPPlacement_VisitId",
     "CREATE INDEX ix_VisitPOPPlacement_VisitId ON VisitPOPPlacement(VisitId)"),
    ("VisitPOPPlacement", "ix_VisitPOPPlacement_MaterialCode",
     "CREATE INDEX ix_VisitPOPPlacement_MaterialCode ON VisitPOPPlacement(MaterialCode)"),
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

    for table, col, ddl in COLUMNS:
        cur.execute("SELECT COL_LENGTH(%s, %s)", (table, col))
        if cur.fetchone()[0] is not None:
            print(f"{table}.{col} ya existe — salto")
            continue
        _run(cur, conn, ddl, dry_run, f"{table}.{col} creada")

    for table, ix, ddl in INDEXES:
        cur.execute(
            "SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID(%s) AND name = %s", (table, ix),
        )
        if cur.fetchone()[0]:
            print(f"Índice {ix} ya existe — salto")
            continue
        _run(cur, conn, ddl, dry_run, f"Índice {ix} creado")

    if not dry_run:
        cur.execute("SELECT COUNT(*) FROM PopMaterial")
        print(f"PopMaterial: {cur.fetchone()[0]} artículos (vacío hasta el primer sync)")
    conn.close()


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
