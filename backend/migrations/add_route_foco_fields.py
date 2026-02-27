"""
Migración: Campos Ruta Foco (BejermanZone, Frecuencia, Tiempo estimado, Creador).
Soporta SQLite y SQL Server (Azure SQL).

Ejecutar desde backend/: python migrations/add_route_foco_fields.py
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
        # SQLite: omitir FK en CreatedByUserId para compatibilidad
        if col == "CreatedByUserId":
            col_def = "INTEGER"
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
    with engine.connect() as conn:
        cols = [
            ("CreatedByUserId", "INTEGER"),
            ("BejermanZone", "VARCHAR(80)"),
            ("FrequencyType", "VARCHAR(40)"),
            ("FrequencyConfig", "VARCHAR(200)"),
            ("EstimatedMinutes", "INTEGER"),
        ]
        table = "Route"
        for col, def_sqlite in cols:
            if col == "CreatedByUserId":
                def_sqlserver = "INT NULL"
            elif "VARCHAR" in def_sqlite:
                def_sqlserver = def_sqlite.replace("VARCHAR", "NVARCHAR") + " NULL"
            else:
                def_sqlserver = "INT NULL"
            if is_sqlserver:
                add_column_sqlserver(conn, table, col, def_sqlserver)
            else:
                add_column_sqlite(conn, table, col, def_sqlite.split()[0] + " NULL")
        print("Migración completada.")


if __name__ == "__main__":
    run()
