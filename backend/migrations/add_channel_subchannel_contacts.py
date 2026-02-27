"""
Migración: Canal, Subcanal, Contactos múltiples.
Soporta SQLite y SQL Server (Azure SQL).

Ejecutar desde backend/: python migrations/add_channel_subchannel_contacts.py
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
    """Migración para SQLite."""
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS "Channel" (
            "ChannelId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "Name" VARCHAR(80) NOT NULL,
            "IsActive" BOOLEAN NOT NULL DEFAULT 1,
            "CreatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
        )
    """))
    conn.commit()

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS "SubChannel" (
            "SubChannelId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "ChannelId" INTEGER NOT NULL REFERENCES "Channel"("ChannelId"),
            "Name" VARCHAR(80) NOT NULL,
            "IsActive" BOOLEAN NOT NULL DEFAULT 1,
            "CreatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
        )
    """))
    conn.commit()

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS "PdvContact" (
            "PdvContactId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "PdvId" INTEGER NOT NULL REFERENCES "PDV"("PdvId"),
            "ContactName" VARCHAR(120) NOT NULL,
            "ContactPhone" VARCHAR(40),
            "Birthday" DATE,
            "CreatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
        )
    """))
    conn.commit()

    for col, ref in [("ChannelId", "Channel"), ("SubChannelId", "SubChannel")]:
        try:
            conn.execute(text(f'ALTER TABLE "PDV" ADD COLUMN "{col}" INTEGER REFERENCES "{ref}"("{col}")'))
            conn.commit()
        except Exception as e:
            if "duplicate column" not in str(e).lower():
                print(f"{col}: {e}")


def run_sqlserver(conn):
    """Migración para SQL Server (Azure SQL)."""
    conn.execute(text("""
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Channel')
        BEGIN
            CREATE TABLE [Channel] (
                [ChannelId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [Name] NVARCHAR(80) NOT NULL,
                [IsActive] BIT NOT NULL DEFAULT 1,
                [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
        END
    """))
    conn.commit()

    conn.execute(text("""
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SubChannel')
        BEGIN
            CREATE TABLE [SubChannel] (
                [SubChannelId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [ChannelId] INT NOT NULL REFERENCES [Channel]([ChannelId]),
                [Name] NVARCHAR(80) NOT NULL,
                [IsActive] BIT NOT NULL DEFAULT 1,
                [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
        END
    """))
    conn.commit()

    conn.execute(text("""
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PdvContact')
        BEGIN
            CREATE TABLE [PdvContact] (
                [PdvContactId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [PdvId] INT NOT NULL REFERENCES [PDV]([PdvId]),
                [ContactName] NVARCHAR(120) NOT NULL,
                [ContactPhone] NVARCHAR(40),
                [Birthday] DATE,
                [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
        END
    """))
    conn.commit()

    for col in ["ChannelId", "SubChannelId"]:
        try:
            conn.execute(text(f"""
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('PDV') AND name = '{col}')
                BEGIN
                    ALTER TABLE [PDV] ADD [{col}] INT NULL
                END
            """))
            conn.commit()
        except Exception as e:
            print(f"{col}: {e}")


def run():
    with engine.connect() as conn:
        if is_sqlserver:
            print("Usando SQL Server (Azure SQL)...")
            run_sqlserver(conn)
        else:
            print("Usando SQLite...")
            run_sqlite(conn)

        # Insertar canales por defecto si la tabla está vacía
        result = conn.execute(text('SELECT COUNT(*) FROM "Channel"' if not is_sqlserver else 'SELECT COUNT(*) FROM [Channel]'))
        if result.scalar() == 0:
            if is_sqlserver:
                conn.execute(text("""
                    INSERT INTO [Channel] ([Name], [IsActive]) VALUES
                    (N'Kiosco', 1),
                    (N'Autoservicio', 1),
                    (N'Supermercado', 1),
                    (N'Mayorista', 1),
                    (N'Estación de Servicio', 1),
                    (N'Otro', 1)
                """))
            else:
                conn.execute(text("""
                    INSERT INTO "Channel" ("Name", "IsActive") VALUES
                    ('Kiosco', 1),
                    ('Autoservicio', 1),
                    ('Supermercado', 1),
                    ('Mayorista', 1),
                    ('Estación de Servicio', 1),
                    ('Otro', 1)
                """))
            conn.commit()
            print("Canales por defecto creados.")

    print("Migración completada.")


if __name__ == "__main__":
    run()
