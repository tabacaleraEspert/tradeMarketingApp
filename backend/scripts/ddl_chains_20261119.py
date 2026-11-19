"""DDL prod 2026-11-19: cadenas y key accounts (migración 0030_chains).

Prod no está trackeado por Alembic — replica 0030_chains.py:
  1. CREATE TABLE Chain (cadena / bandera; UNIQUE (ChannelId, Name)) + índice ChannelId.
  2. ALTER TABLE PDV ADD ChainId INT NULL + FK_PDV_Chain + ix_PDV_ChainId.
No toca datos existentes (la columna nueva nace NULL). La migración de datos es
aparte: scripts/migrate_chains_20261119.py.

CORRER ANTES del deploy del backend: el modelo nuevo hace SELECT de PDV.ChainId
(sin la columna, TODOS los endpoints de PDV darían 500 — incidente 2026-08-04). El
backend nuevo además lo avisa: log de error al arrancar y /health en 503.

CORRER FUERA DE HORARIO: ALTER TABLE PDV / CREATE INDEX piden un lock de esquema
sobre PDV. Con SET LOCK_TIMEOUT (15 s) el script FALLA en vez de quedarse esperando
(y bloqueando a la app) si hay actividad; se vuelve a correr: es idempotente.

Base = la misma resolución que la app y que migrate_chains (ver chains_ops_20261119.py);
imprime servidor y base antes de hacer nada y corta si el entorno es ambiguo.
Solo SQL Server (en local/SQLite el esquema sale de `alembic upgrade head`).
Todo en UNA transacción (el DDL de SQL Server es transaccional): o queda todo o nada.

Uso (desde backend/):
    python scripts/ddl_chains_20261119.py              # dry-run (default): lista qué haría
    python scripts/ddl_chains_20261119.py --commit     # aplica (pide confirmación; --yes la saltea)
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import chains_ops_20261119 as ops  # noqa: E402

CREATE_CHAIN = """
CREATE TABLE Chain (
    ChainId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Chain PRIMARY KEY,
    Name NVARCHAR(80) NOT NULL,
    ChannelId INT NOT NULL CONSTRAINT FK_Chain_Channel REFERENCES Channel(ChannelId),
    Kind NVARCHAR(20) NOT NULL CONSTRAINT DF_Chain_Kind DEFAULT 'cadena',
    IsKeyAccount BIT NOT NULL CONSTRAINT DF_Chain_IsKeyAccount DEFAULT 0,
    AccountManagerUserId INT NULL CONSTRAINT FK_Chain_AccountManager REFERENCES [User](UserId),
    StoreCount INT NULL,
    Aliases NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Chain_IsActive DEFAULT 1,
    CreatedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_Chain_CreatedAt DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_Chain_ChannelId_Name UNIQUE (ChannelId, Name)
)"""

# (descripción, query que devuelve >0 si YA existe, DDL)
STEPS = [
    ("tabla Chain",
     "SELECT COUNT(*) FROM sys.tables WHERE name = 'Chain'",
     CREATE_CHAIN),
    ("índice ix_Chain_ChannelId",
     "SELECT COUNT(*) FROM sys.indexes WHERE name = 'ix_Chain_ChannelId' AND object_id = OBJECT_ID('Chain')",
     "CREATE INDEX ix_Chain_ChannelId ON Chain(ChannelId)"),
    ("columna PDV.ChainId",
     "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('PDV') AND name = 'ChainId'",
     "ALTER TABLE PDV ADD ChainId INT NULL"),
    ("FK FK_PDV_Chain",
     "SELECT COUNT(*) FROM sys.foreign_keys WHERE name = 'FK_PDV_Chain' AND parent_object_id = OBJECT_ID('PDV')",
     "ALTER TABLE PDV ADD CONSTRAINT FK_PDV_Chain FOREIGN KEY (ChainId) REFERENCES Chain(ChainId)"),
    ("índice ix_PDV_ChainId",
     "SELECT COUNT(*) FROM sys.indexes WHERE name = 'ix_PDV_ChainId' AND object_id = OBJECT_ID('PDV')",
     "CREATE INDEX ix_PDV_ChainId ON PDV(ChainId)"),
]


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--commit", action="store_true", help="Aplica el DDL (default: dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="Solo lista qué haría (default)")
    ap.add_argument("--yes", action="store_true", help="No pide la confirmación tipeada (uso no interactivo)")
    args = ap.parse_args(argv)  # argumento desconocido → error (no se ignora en silencio)
    if args.commit and args.dry_run:
        ap.error("--commit y --dry-run son excluyentes")
    return args


def run(conn, commit: bool) -> list[str]:
    """Ejecuta (o lista) los pasos pendientes sobre una conexión SQL Server. Devuelve los
    pasos que faltaban."""
    from sqlalchemy import text
    pending = []
    for label, exists_sql, ddl in STEPS:
        if conn.execute(text(exists_sql)).scalar():
            print(f"{label}: ya existe — salto")
            continue
        pending.append(label)
        if not commit:
            # En dry-run los pasos siguientes dependen de objetos que todavía no existen:
            # OBJECT_ID('Chain') da NULL y el chequeo devuelve 0 → se listan igual.
            print(f"[dry-run] {label}: {' '.join(ddl.split())}")
            continue
        conn.execute(text(ddl))
        print(f"{label}: creado")
    return pending


def main(argv=None) -> int:
    args = parse_args(argv)
    target = ops.resolve_target_or_exit("COMMIT (aplica DDL)" if args.commit else "DRY-RUN (no escribe nada)")
    if target["kind"] != "mssql":
        print("ABORTO: este script es solo para SQL Server (prod). En SQLite/local el esquema "
              "se crea con `alembic upgrade head`. No se hizo nada.")
        return 2
    if args.commit:
        ops.confirm_or_exit(target, args.yes, "aplicar el DDL de cadenas")

    from sqlalchemy import text

    from app.database import engine
    with engine.connect() as conn:
        ops.set_lock_timeout(conn)
        trans = conn.begin()
        try:
            pending = run(conn, args.commit)
            if args.commit:
                trans.commit()
            else:
                trans.rollback()
        except Exception:
            trans.rollback()
            print("ERROR: transacción revertida, el esquema quedó como estaba. "
                  "(¿Lock timeout? Reintentar fuera de horario.)")
            raise
        if not args.commit:
            print(f"\nDRY-RUN: no se escribió nada. Pasos pendientes: {len(pending)}. Aplicar con --commit.")
            return 0
        n_chain = conn.execute(text("SELECT COUNT(*) FROM Chain")).scalar()
        total, linked = conn.execute(text(
            "SELECT COUNT(*), SUM(CASE WHEN ChainId IS NULL THEN 0 ELSE 1 END) FROM PDV")).one()
        print(f"\nDDL OK ({len(pending)} pasos aplicados) · Chain: {n_chain} filas · PDV: {total} filas, {linked or 0} con ChainId")
    return 0


if __name__ == "__main__":
    sys.exit(main())
