#!/usr/bin/env python3
"""
Migración: sincroniza el esquema de producción (Azure SQL) con los modelos de SQLAlchemy.
Creada automáticamente el 2026-04-28.

Crea tablas faltantes y agrega columnas faltantes. Idempotente (usa IF NOT EXISTS).

Uso:
    cd backend
    DATABASE_SERVER=trade-mkt-sql.database.windows.net DATABASE_NAME=trademktdb \
    DATABASE_USER=tmadmin DATABASE_PASSWORD='...' USE_SQLITE=false \
    .venv/bin/python migrations/sync_prod_schema_20260428.py
"""
import os
import sys

_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _root)

from sqlalchemy import create_engine, text
from app.config import settings

engine = create_engine(settings.resolved_database_url)


def _exec(conn, sql, label=""):
    try:
        conn.execute(text(sql))
        conn.commit()
        if label:
            print(f"  OK: {label}")
    except Exception as e:
        print(f"  ERROR ({label}): {e}")


def _add_col(conn, table, col, typedef):
    sql = f"""
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('{table}') AND name = '{col}')
        BEGIN
            ALTER TABLE [{table}] ADD [{col}] {typedef}
        END
    """
    _exec(conn, sql, f"{table}.{col}")


def create_missing_tables(conn):
    print("\n=== Creando tablas faltantes ===")

    # AppSetting
    _exec(conn, """
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AppSetting')
        BEGIN
            CREATE TABLE [AppSetting] (
                [Key] NVARCHAR(80) NOT NULL PRIMARY KEY,
                [Value] NVARCHAR(500) NOT NULL,
                [Description] NVARCHAR(200) NULL,
                [UpdatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
        END
    """, "AppSetting")

    # Product (must be before VisitCoverage due to FK)
    _exec(conn, """
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Product')
        BEGIN
            CREATE TABLE [Product] (
                [ProductId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [Name] NVARCHAR(120) NOT NULL,
                [Category] NVARCHAR(40) NOT NULL,
                [Manufacturer] NVARCHAR(80) NULL,
                [IsOwn] BIT NOT NULL DEFAULT 0,
                [IsActive] BIT NOT NULL DEFAULT 1,
                [SortOrder] INT NOT NULL DEFAULT 0,
                [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
            CREATE INDEX IX_Product_Category ON [Product]([Category])
        END
    """, "Product")

    # PdvProductCategory
    _exec(conn, """
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PdvProductCategory')
        BEGIN
            CREATE TABLE [PdvProductCategory] (
                [PdvProductCategoryId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [PdvId] INT NOT NULL REFERENCES [PDV]([PdvId]) ON DELETE CASCADE,
                [Category] NVARCHAR(40) NOT NULL,
                [Status] NVARCHAR(30) NOT NULL DEFAULT 'no_trabaja',
                [UpdatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
            CREATE INDEX IX_PdvProductCategory_PdvId ON [PdvProductCategory]([PdvId])
        END
    """, "PdvProductCategory")

    # VisitCoverage
    _exec(conn, """
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VisitCoverage')
        BEGIN
            CREATE TABLE [VisitCoverage] (
                [VisitCoverageId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [VisitId] INT NOT NULL REFERENCES [Visit]([VisitId]) ON DELETE CASCADE,
                [ProductId] INT NOT NULL REFERENCES [Product]([ProductId]),
                [Works] BIT NOT NULL DEFAULT 0,
                [Price] DECIMAL(10,2) NULL,
                [Availability] NVARCHAR(20) NULL,
                [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
            CREATE INDEX IX_VisitCoverage_VisitId ON [VisitCoverage]([VisitId])
        END
    """, "VisitCoverage")

    # VisitLooseSurvey
    _exec(conn, """
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VisitLooseSurvey')
        BEGIN
            CREATE TABLE [VisitLooseSurvey] (
                [VisitLooseSurveyId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [VisitId] INT NOT NULL UNIQUE REFERENCES [Visit]([VisitId]) ON DELETE CASCADE,
                [SellsLoose] BIT NOT NULL DEFAULT 0,
                [ProductsJson] NVARCHAR(MAX) NULL,
                [ExchangeJson] NVARCHAR(MAX) NULL,
                [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
        END
    """, "VisitLooseSurvey")

    # VisitPOPItem
    _exec(conn, """
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VisitPOPItem')
        BEGIN
            CREATE TABLE [VisitPOPItem] (
                [VisitPOPItemId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [VisitId] INT NOT NULL REFERENCES [Visit]([VisitId]) ON DELETE CASCADE,
                [MaterialType] NVARCHAR(20) NOT NULL,
                [MaterialName] NVARCHAR(80) NOT NULL,
                [Company] NVARCHAR(80) NULL,
                [Present] BIT NOT NULL DEFAULT 0,
                [HasPrice] BIT NULL,
                [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
            )
            CREATE INDEX IX_VisitPOPItem_VisitId ON [VisitPOPItem]([VisitId])
        END
    """, "VisitPOPItem")


def add_missing_columns(conn):
    print("\n=== Agregando columnas faltantes ===")

    # AuditEvent
    _add_col(conn, "AuditEvent", "DeviceId", "INT NULL")
    _add_col(conn, "AuditEvent", "Entity", "NVARCHAR(60) NULL")
    _add_col(conn, "AuditEvent", "PayloadJson", "NVARCHAR(MAX) NULL")
    _add_col(conn, "AuditEvent", "Ts", "DATETIME2 NULL DEFAULT GETDATE()")

    # Device
    _add_col(conn, "Device", "CreatedAt", "DATETIME2 NOT NULL DEFAULT GETDATE()")
    _add_col(conn, "Device", "DeviceKey", "NVARCHAR(120) NULL")

    # DeviceState
    _add_col(conn, "DeviceState", "LastSyncAt", "DATETIME2 NULL")
    _add_col(conn, "DeviceState", "PendingForms", "INT NOT NULL DEFAULT 0")
    _add_col(conn, "DeviceState", "PendingPhotos", "INT NOT NULL DEFAULT 0")

    # File
    _add_col(conn, "File", "BlobKey", "NVARCHAR(300) NULL")
    _add_col(conn, "File", "ContentType", "NVARCHAR(80) NULL")
    _add_col(conn, "File", "HashSha256", "NVARCHAR(64) NULL")
    _add_col(conn, "File", "Lat", "DECIMAL(9,6) NULL")
    _add_col(conn, "File", "Lon", "DECIMAL(9,6) NULL")
    _add_col(conn, "File", "TakenAt", "DATETIME2 NULL")
    _add_col(conn, "File", "Url", "NVARCHAR(600) NULL")

    # Form
    _add_col(conn, "Form", "CreatedByUserId", "INT NULL")

    # FormQuestion
    _add_col(conn, "FormQuestion", "FormVersion", "INT NULL")
    _add_col(conn, "FormQuestion", "KeyName", "NVARCHAR(80) NULL")

    # MandatoryActivity
    _add_col(conn, "MandatoryActivity", "CreatedByUserId", "INT NULL")
    _add_col(conn, "MandatoryActivity", "ValidFrom", "DATE NULL")
    _add_col(conn, "MandatoryActivity", "ValidTo", "DATE NULL")

    # Notification
    _add_col(conn, "Notification", "CreatedBy", "INT NULL")
    _add_col(conn, "Notification", "Message", "NVARCHAR(500) NULL")
    _add_col(conn, "Notification", "Priority", "INT NOT NULL DEFAULT 2")

    # PdvKpiSnapshot
    _add_col(conn, "PdvKpiSnapshot", "AsOfDate", "DATE NULL")
    _add_col(conn, "PdvKpiSnapshot", "CompliancePct", "DECIMAL(5,2) NULL")
    _add_col(conn, "PdvKpiSnapshot", "IncidentsOpen", "INT NULL")
    _add_col(conn, "PdvKpiSnapshot", "LastVisitDate", "DATE NULL")
    _add_col(conn, "PdvKpiSnapshot", "VisitsCount", "INT NULL")

    # SyncLog
    _add_col(conn, "SyncLog", "ErrorText", "NVARCHAR(2000) NULL")
    _add_col(conn, "SyncLog", "FinishedAt", "DATETIME2 NULL")
    _add_col(conn, "SyncLog", "Result", "NVARCHAR(20) NULL DEFAULT 'OK'")
    _add_col(conn, "SyncLog", "StartedAt", "DATETIME2 NULL DEFAULT GETDATE()")

    # VisitAction
    _add_col(conn, "VisitAction", "DetailsJson", "NVARCHAR(MAX) NULL")

    # VisitFormTime
    _add_col(conn, "VisitFormTime", "UpdatedAt", "DATETIME2 NULL DEFAULT GETDATE()")

    # VisitPhoto
    _add_col(conn, "VisitPhoto", "FileId", "INT NULL")
    _add_col(conn, "VisitPhoto", "Notes", "NVARCHAR(300) NULL")
    _add_col(conn, "VisitPhoto", "PhotoType", "NVARCHAR(30) NULL DEFAULT 'general'")
    _add_col(conn, "VisitPhoto", "SortOrder", "INT NOT NULL DEFAULT 1")


def main():
    db_url = settings.resolved_database_url
    print(f"DB: {db_url.split('@')[-1] if '@' in db_url else db_url[:40]}")

    with engine.connect() as conn:
        create_missing_tables(conn)
        add_missing_columns(conn)

    print("\nMigración completada.")


if __name__ == "__main__":
    main()
