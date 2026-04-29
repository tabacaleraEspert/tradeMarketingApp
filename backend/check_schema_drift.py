#!/usr/bin/env python3
"""
Compara el esquema esperado por SQLAlchemy (modelos) contra la DB conectada.
Detecta tablas y columnas faltantes y genera SQL para corregir el drift.

Uso:
    # Contra local (SQLite):
    cd backend && python check_schema_drift.py

    # Contra producción (Azure SQL):
    DATABASE_SERVER=... DATABASE_NAME=... DATABASE_USER=... DATABASE_PASSWORD=... USE_SQLITE=false \
        python check_schema_drift.py

    # Auto-fix (aplica los cambios directamente):
    python check_schema_drift.py --fix
"""
import sys
import os

_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _root)

from sqlalchemy import create_engine, inspect
from app.config import settings
from app.database import Base

# Force all models to be imported so Base.metadata is complete
import app.models  # noqa

DB_URL = settings.resolved_database_url
_is_sqlite = "sqlite" in DB_URL
_is_sqlserver = "mssql" in DB_URL or "sqlserver" in DB_URL


def get_expected_schema():
    """Extract expected tables and columns from SQLAlchemy models."""
    expected = {}
    for table_name, table in Base.metadata.tables.items():
        cols = {}
        for col in table.columns:
            cols[col.name] = col
        expected[table_name] = cols
    return expected


def get_actual_schema(engine):
    """Read actual tables and columns from the database."""
    actual = {}
    insp = inspect(engine)
    for table_name in insp.get_table_names():
        cols = insp.get_columns(table_name)
        actual[table_name] = {c["name"] for c in cols}
    return actual


def _sql_type(col):
    """Get a portable SQL type string for a column."""
    try:
        t = col.type.compile()
    except Exception:
        t = str(col.type)
    return t


def _default_clause(col):
    """Build DEFAULT clause for a column."""
    if col.server_default is not None:
        return f" DEFAULT {col.server_default.arg}"
    if col.default is not None and col.default.is_scalar:
        val = col.default.arg
        if isinstance(val, str):
            return f" DEFAULT '{val}'"
        return f" DEFAULT {val}"
    # nullable columns default to NULL implicitly
    if col.nullable:
        return ""
    # NOT NULL without default — provide safe fallback
    t = str(col.type).upper()
    if "INT" in t:
        return " DEFAULT 0"
    if "BOOL" in t:
        return " DEFAULT 0"
    if "VARCHAR" in t or "TEXT" in t or "STRING" in t:
        return " DEFAULT ''"
    return ""


def _col_sql(col):
    """Build column definition for ALTER TABLE ADD COLUMN."""
    parts = [_sql_type(col)]
    if not col.nullable:
        parts.append("NOT NULL")
    parts.append(_default_clause(col))
    return " ".join(parts)


def compare(expected, actual):
    missing_tables = []
    missing_columns = {}
    extra_tables = []

    for table, cols in expected.items():
        if table not in actual:
            missing_tables.append(table)
        else:
            diff = set(cols.keys()) - actual[table]
            if diff:
                missing_columns[table] = {c: cols[c] for c in diff}

    for table in actual:
        if table not in expected:
            extra_tables.append(table)

    return missing_tables, missing_columns, extra_tables


def generate_fix_sql(missing_tables, missing_columns, expected):
    """Generate SQL statements to fix drift."""
    stmts = []

    for table_name in sorted(missing_tables):
        cols = expected[table_name]
        col_defs = []
        for cname, col in cols.items():
            nullable = "" if col.nullable else " NOT NULL"
            pk = " PRIMARY KEY" if col.primary_key else ""
            default = _default_clause(col) if not col.primary_key else ""
            col_defs.append(f"    {cname} {_sql_type(col)}{nullable}{default}{pk}")
        stmts.append(f"CREATE TABLE {table_name} (\n" + ",\n".join(col_defs) + "\n);")

    for table_name in sorted(missing_columns):
        for cname, col in sorted(missing_columns[table_name].items()):
            stmts.append(
                f"ALTER TABLE {table_name} ADD COLUMN {cname} {_col_sql(col)};"
            )

    return stmts


def main():
    auto_fix = "--fix" in sys.argv

    label = DB_URL.split("@")[-1] if "@" in DB_URL else DB_URL[:60]
    db_type = "SQLite" if _is_sqlite else "SQL Server" if _is_sqlserver else "Other"
    print(f"DB: {label}")
    print(f"Engine: {db_type}")
    print()

    engine = create_engine(DB_URL)
    expected = get_expected_schema()
    actual = get_actual_schema(engine)

    missing_tables, missing_columns, extra_tables = compare(expected, actual)

    ok = True

    if missing_tables:
        ok = False
        print("TABLAS FALTANTES (existen en modelos pero no en la DB):")
        for t in sorted(missing_tables):
            cols = sorted(expected[t].keys())
            print(f"  - {t} ({len(cols)} cols: {', '.join(cols[:5])}{'...' if len(cols) > 5 else ''})")
        print()

    if missing_columns:
        ok = False
        print("COLUMNAS FALTANTES (existen en modelos pero no en la tabla):")
        for t in sorted(missing_columns):
            for c in sorted(missing_columns[t]):
                print(f"  - {t}.{c}")
        print()

    if extra_tables:
        print(f"Tablas extra en DB (no en modelos): {', '.join(sorted(extra_tables))}")
        print()

    if ok:
        print("OK: El esquema coincide con los modelos.")
        return

    print("DRIFT DETECTADO.")
    print()

    fix_sql = generate_fix_sql(missing_tables, missing_columns, expected)

    if auto_fix:
        print("Aplicando correcciones...")
        with engine.begin() as conn:
            for stmt in fix_sql:
                print(f"  > {stmt[:100]}...")
                conn.execute(__import__("sqlalchemy").text(stmt))
        print()
        print("Fix aplicado. Re-verificando...")
        print()
        # Re-check
        actual2 = get_actual_schema(engine)
        mt2, mc2, _ = compare(expected, actual2)
        if not mt2 and not mc2:
            print("OK: El esquema ahora coincide con los modelos.")
        else:
            print("ADVERTENCIA: Aún quedan diferencias después del fix.")
            sys.exit(1)
    else:
        print("SQL para corregir (copiar y ejecutar, o usar --fix):")
        print("=" * 60)
        for stmt in fix_sql:
            print(stmt)
            print()
        print("=" * 60)
        print(f"\nTotal: {len(fix_sql)} statement(s)")
        print("Tip: python check_schema_drift.py --fix")
        sys.exit(1)


if __name__ == "__main__":
    main()
