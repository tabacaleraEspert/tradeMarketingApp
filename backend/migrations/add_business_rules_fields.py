"""
Migración: nuevos campos para reglas de negocio.

- PDV.AssignedUserId    → Trade Marketer asignado (auto al incluir en ruta)
- Route.IsOptimized     → Flag de ruta optimizada
- Form.Frequency        → Frecuencia del formulario (always, weekly, etc.)
- Form.FrequencyConfig  → Config JSON de la frecuencia
- MandatoryActivity.FormId → Formulario opcional vinculado a la acción

Soporta SQLite y SQL Server (Azure SQL).

Ejecutar desde backend/: python migrations/add_business_rules_fields.py
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


def add_column_sqlite(conn, table, col, col_def):
    try:
        conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{col}" {col_def}'))
        conn.commit()
    except Exception as e:
        if "duplicate column" not in str(e).lower():
            print(f"{table}.{col}: {e}")


def add_column_sqlserver(conn, table, col, col_def):
    try:
        conn.execute(text(f"""
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('{table}') AND name = '{col}')
            BEGIN
                ALTER TABLE [{table}] ADD [{col}] {col_def}
            END
        """))
        conn.commit()
    except Exception as e:
        print(f"{table}.{col}: {e}")


def run():
    # (table, column, sqlite_def, sqlserver_def)
    changes = [
        ("PDV", "AssignedUserId", "INTEGER NULL", "INT NULL"),
        ("Route", "IsOptimized", "INTEGER NOT NULL DEFAULT 0", "BIT NOT NULL DEFAULT 0"),
        ("Form", "Frequency", "VARCHAR(40) NULL", "NVARCHAR(40) NULL"),
        ("Form", "FrequencyConfig", "VARCHAR(200) NULL", "NVARCHAR(200) NULL"),
        ("MandatoryActivity", "FormId", "INTEGER NULL", "INT NULL"),
        # Día 2: jerarquía organizacional + force-change-password
        ("User", "ManagerUserId", "INTEGER NULL", "INT NULL"),
        ("User", "MustChangePassword", "INTEGER NOT NULL DEFAULT 0", "BIT NOT NULL DEFAULT 0"),
    ]
    with engine.connect() as conn:
        for table, col, sqlite_def, sqlserver_def in changes:
            if is_sqlserver:
                add_column_sqlserver(conn, table, col, sqlserver_def)
            else:
                add_column_sqlite(conn, table, col, sqlite_def)
        print("Migración completada.")


if __name__ == "__main__":
    run()
