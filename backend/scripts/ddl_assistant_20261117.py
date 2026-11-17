"""DDL prod 2026-11-17: asistente IA "Puchi" (migración 0029_assistant).

Prod no está trackeado por Alembic — replica 0029_assistant.py:
  1. CREATE TABLE AssistantTurn (una fila por pregunta: tokens, costo, resultado).
  2. CREATE TABLE AssistantToolUse (una fila por herramienta; FK ON DELETE CASCADE).
  3. Índices UserId / CreatedUtc / AssistantTurnId.
No toca tablas ni datos existentes.

CORRER ANTES del deploy del backend: sin las tablas el rate limit falla cerrado y
el asistente rechaza todas las preguntas (el resto de la app no se entera).
Credenciales: DATABASE_* del entorno o backend/.env. Idempotente (chequea sys.*).
Uso (desde backend/): python scripts/ddl_assistant_20261117.py [--dry-run]
Después: cargar OPENAI_API_KEY en los app settings del App Service y reiniciar.
"""
import sys
from pathlib import Path

import pymssql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings

TABLES = [
    ("AssistantTurn", """
CREATE TABLE AssistantTurn (
    AssistantTurnId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AssistantTurn PRIMARY KEY,
    UserId INT NOT NULL CONSTRAINT FK_AssistantTurn_User REFERENCES [User](UserId),
    CreatedUtc DATETIME2 NOT NULL,
    Question NVARCHAR(MAX) NULL,
    Answer NVARCHAR(MAX) NULL,
    Model NVARCHAR(60) NOT NULL,
    Rounds INT NOT NULL CONSTRAINT DF_AssistantTurn_Rounds DEFAULT 0,
    DurationMs INT NOT NULL CONSTRAINT DF_AssistantTurn_DurationMs DEFAULT 0,
    TokensIn INT NOT NULL CONSTRAINT DF_AssistantTurn_TokensIn DEFAULT 0,
    TokensOut INT NOT NULL CONSTRAINT DF_AssistantTurn_TokensOut DEFAULT 0,
    TokensCached INT NOT NULL CONSTRAINT DF_AssistantTurn_TokensCached DEFAULT 0,
    CostUsd DECIMAL(10,6) NOT NULL CONSTRAINT DF_AssistantTurn_CostUsd DEFAULT 0,
    Ok BIT NOT NULL CONSTRAINT DF_AssistantTurn_Ok DEFAULT 0,
    Error NVARCHAR(500) NULL
)"""),
    ("AssistantToolUse", """
CREATE TABLE AssistantToolUse (
    AssistantToolUseId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AssistantToolUse PRIMARY KEY,
    AssistantTurnId INT NOT NULL CONSTRAINT FK_AssistantToolUse_Turn
        REFERENCES AssistantTurn(AssistantTurnId) ON DELETE CASCADE,
    Tool NVARCHAR(60) NOT NULL,
    ArgsJson NVARCHAR(2000) NULL,
    DurationMs INT NOT NULL CONSTRAINT DF_AssistantToolUse_DurationMs DEFAULT 0
)"""),
]

# (tabla, nombre índice, DDL)
INDEXES = [
    ("AssistantTurn", "ix_AssistantTurn_UserId",
     "CREATE INDEX ix_AssistantTurn_UserId ON AssistantTurn(UserId)"),
    ("AssistantTurn", "ix_AssistantTurn_CreatedUtc",
     "CREATE INDEX ix_AssistantTurn_CreatedUtc ON AssistantTurn(CreatedUtc)"),
    ("AssistantToolUse", "ix_AssistantToolUse_AssistantTurnId",
     "CREATE INDEX ix_AssistantToolUse_AssistantTurnId ON AssistantToolUse(AssistantTurnId)"),
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

    for table, ix, ddl in INDEXES:
        cur.execute(
            "SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID(%s) AND name = %s", (table, ix),
        )
        if cur.fetchone()[0]:
            print(f"Índice {ix} ya existe — salto")
            continue
        _run(cur, conn, ddl, dry_run, f"Índice {ix} creado")
    conn.close()


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
