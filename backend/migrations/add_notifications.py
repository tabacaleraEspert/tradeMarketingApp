"""
Migración: Tabla Notification (notificaciones Admin visibles para Trade).
Soporta SQLite y SQL Server (Azure SQL).

Ejecutar desde backend/: python migrations/add_notifications.py
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


def run():
    with engine.connect() as conn:
        if is_sqlserver:
            conn.execute(text("""
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Notification')
                BEGIN
                    CREATE TABLE [Notification] (
                        [NotificationId] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                        [Title] NVARCHAR(120) NOT NULL,
                        [Message] NVARCHAR(500) NOT NULL,
                        [Type] NVARCHAR(30) NOT NULL DEFAULT 'info',
                        [Priority] INT NOT NULL DEFAULT 2,
                        [IsActive] BIT NOT NULL DEFAULT 1,
                        [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE(),
                        [CreatedBy] INT NULL,
                        [ExpiresAt] DATETIME2 NULL
                    )
                END
            """))
        else:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS "Notification" (
                    "NotificationId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    "Title" VARCHAR(120) NOT NULL,
                    "Message" VARCHAR(500) NOT NULL,
                    "Type" VARCHAR(30) NOT NULL DEFAULT 'info',
                    "Priority" INTEGER NOT NULL DEFAULT 2,
                    "IsActive" BOOLEAN NOT NULL DEFAULT 1,
                    "CreatedAt" DATETIME NOT NULL DEFAULT (datetime('now')),
                    "CreatedBy" INTEGER NULL,
                    "ExpiresAt" DATETIME NULL
                )
            """))
        conn.commit()
        print("Migración completada.")


if __name__ == "__main__":
    run()
