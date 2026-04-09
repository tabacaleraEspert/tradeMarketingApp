"""
Migración: Campos de workflow de visita completo.
- PdvContact: ContactRole, DecisionPower
- Nueva tabla: VisitAction
- Nueva tabla: MarketNews

Soporta SQLite y SQL Server (Azure SQL).
Ejecutar desde backend/: python migrations/add_visit_workflow_fields.py
"""
import os
import sys

_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _root)

from sqlalchemy import create_engine, text
from app.config import settings

_db_url = settings.resolved_database_url
engine = create_engine(_db_url)
is_sqlserver = "sqlserver" in _db_url or "mssql" in _db_url


def run_sqlite(conn):
    # PdvContact: add ContactRole, DecisionPower
    for col, coltype in [("ContactRole", "VARCHAR(40)"), ("DecisionPower", "VARCHAR(20)")]:
        try:
            conn.execute(text(f'ALTER TABLE "PdvContact" ADD COLUMN "{col}" {coltype}'))
            conn.commit()
        except Exception as e:
            if "duplicate column" not in str(e).lower():
                print(f"PdvContact.{col}: {e}")

    # VisitAction table
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS "VisitAction" (
            "VisitActionId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "VisitId" INTEGER NOT NULL REFERENCES "Visit"("VisitId"),
            "ActionType" VARCHAR(30) NOT NULL,
            "Description" VARCHAR(500),
            "DetailsJson" TEXT,
            "PhotoRequired" BOOLEAN NOT NULL DEFAULT 1,
            "PhotoTaken" BOOLEAN NOT NULL DEFAULT 0,
            "CreatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
        )
    """))
    conn.commit()

    # MarketNews table
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS "MarketNews" (
            "MarketNewsId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "VisitId" INTEGER NOT NULL REFERENCES "Visit"("VisitId"),
            "PdvId" INTEGER NOT NULL REFERENCES "PDV"("PdvId"),
            "Tags" VARCHAR(200),
            "Notes" VARCHAR(1000) NOT NULL,
            "CreatedBy" INTEGER REFERENCES "User"("UserId"),
            "CreatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
        )
    """))
    conn.commit()


def run_sqlserver(conn):
    # PdvContact: add ContactRole, DecisionPower
    for col, coltype in [("ContactRole", "NVARCHAR(40)"), ("DecisionPower", "NVARCHAR(20)")]:
        conn.execute(text(f"""
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PdvContact') AND name = '{col}')
            BEGIN
                ALTER TABLE [PdvContact] ADD [{col}] {coltype} NULL
            END
        """))
        conn.commit()

    # VisitAction table
    conn.execute(text("""
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VisitAction')
        BEGIN
            CREATE TABLE [VisitAction] (
                [VisitActionId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [VisitId] INT NOT NULL REFERENCES [Visit]([VisitId]),
                [ActionType] NVARCHAR(30) NOT NULL,
                [Description] NVARCHAR(500),
                [DetailsJson] NVARCHAR(MAX),
                [PhotoRequired] BIT NOT NULL DEFAULT 1,
                [PhotoTaken] BIT NOT NULL DEFAULT 0,
                [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
        END
    """))
    conn.commit()

    # MarketNews table
    conn.execute(text("""
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MarketNews')
        BEGIN
            CREATE TABLE [MarketNews] (
                [MarketNewsId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [VisitId] INT NOT NULL REFERENCES [Visit]([VisitId]),
                [PdvId] INT NOT NULL REFERENCES [PDV]([PdvId]),
                [Tags] NVARCHAR(200),
                [Notes] NVARCHAR(1000) NOT NULL,
                [CreatedBy] INT REFERENCES [User]([UserId]),
                [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
        END
    """))
    conn.commit()


def run():
    with engine.connect() as conn:
        if is_sqlserver:
            print("Usando SQL Server (Azure SQL)...")
            run_sqlserver(conn)
        else:
            print("Usando SQLite...")
            run_sqlite(conn)

    print("Migración de workflow completada.")


if __name__ == "__main__":
    run()
