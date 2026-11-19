"""DDL prod 2026-11-19: cadenas y key accounts (migración 0030_chains).

Prod no está trackeado por Alembic — replica 0030_chains.py:
  1. CREATE TABLE Chain (cadena / bandera; UNIQUE (ChannelId, Name)) + índice ChannelId.
  2. ALTER TABLE PDV ADD ChainId INT NULL + FK_PDV_Chain + ix_PDV_ChainId.
  3. RouteDay: índice ÚNICO (RouteId, WorkDate, AssignedUserId) — réplica de
     0031_routeday_unique.py. Hoy "una ruta no puede tener dos veces el mismo día para
     el mismo usuario" solo lo cuida el código (routers/routes.py); dos activadores SÍ
     comparten ruta+fecha con usuarios distintos, por eso el usuario entra en la clave.
     Si RouteDay.AssignedUserId admite NULL el índice es FILTRADO (WHERE AssignedUserId
     IS NOT NULL); si es NOT NULL, índice único común.
     ANTES de crearlo busca grupos duplicados. Si hay alguno los LISTA (RouteDayId,
     ruta, fecha, usuario, estado, visitas, PDVs y PDVs con avance) y SALTEA el índice:
     nunca borra ni fusiona filas. El resto del DDL se aplica igual. Se resuelven a
     mano y se vuelve a correr el script (idempotente). El dry-run muestra el mismo
     informe. El backend NO depende de este índice (/health no lo mira).
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
Solo SQL Server (en local/SQLite el esquema sale de `alembic upgrade head`); contra
SQLite solo imprime el informe de RouteDay duplicados (lectura) y termina.
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


ROUTEDAY_UQ = "uq_RouteDay_Route_Date_User"

# Portable (SQL Server y SQLite): cada fila de cada grupo (RouteId, WorkDate, AssignedUserId) repetido.
ROUTEDAY_DUPLICATES_SQL = """
SELECT rd.RouteDayId, rd.RouteId, rd.WorkDate, rd.AssignedUserId, rd.Status,
       (SELECT COUNT(*) FROM Visit v WHERE v.RouteDayId = rd.RouteDayId) AS Visitas,
       (SELECT COUNT(*) FROM RouteDayPdv p WHERE p.RouteDayId = rd.RouteDayId) AS Pdvs,
       (SELECT COUNT(*) FROM RouteDayPdv p WHERE p.RouteDayId = rd.RouteDayId
                                             AND p.ExecutionStatus <> 'PENDING') AS PdvsConAvance
FROM RouteDay rd
JOIN (SELECT RouteId, WorkDate, AssignedUserId
      FROM RouteDay
      WHERE AssignedUserId IS NOT NULL
      GROUP BY RouteId, WorkDate, AssignedUserId
      HAVING COUNT(*) > 1) d
  ON d.RouteId = rd.RouteId AND d.WorkDate = rd.WorkDate AND d.AssignedUserId = rd.AssignedUserId
ORDER BY rd.RouteId, rd.WorkDate, rd.AssignedUserId, rd.RouteDayId
"""


def routeday_duplicates(conn) -> list[dict]:
    """Filas de RouteDay que pertenecen a un grupo duplicado. Solo lectura."""
    from sqlalchemy import text
    return [dict(r._mapping) for r in conn.execute(text(ROUTEDAY_DUPLICATES_SQL))]


def print_routeday_duplicates(rows: list[dict]) -> int:
    """Imprime el informe; devuelve la cantidad de grupos."""
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault((r["RouteId"], str(r["WorkDate"])[:10], r["AssignedUserId"]), []).append(r)
    if not groups:
        print("RouteDay: sin duplicados de (RouteId, WorkDate, AssignedUserId).")
        return 0
    print(f"RouteDay: {len(groups)} grupos DUPLICADOS de (RouteId, WorkDate, AssignedUserId) — {len(rows)} filas:")
    for (route, day, user), items in groups.items():
        print(f"   ruta {route} · {day} · usuario {user}:")
        for r in items:
            print(f"      RouteDayId {r['RouteDayId']:>7} · {str(r['Status']):<12} · visitas {r['Visitas']} · "
                  f"PDVs {r['Pdvs']} (con avance {r['PdvsConAvance']})")
    print("   No se borra ni se fusiona nada. Resolver a mano (normalmente: conservar el que tiene visitas/avance\n"
          "   y eliminar el otro desde Rutas) y volver a correr este script.")
    return len(groups)


def routeday_unique_step(conn, commit: bool) -> str:
    """Índice único de RouteDay (solo SQL Server). Devuelve 'existe' | 'duplicados' | 'pendiente' | 'creado'."""
    from sqlalchemy import text
    exists = conn.execute(text(
        "SELECT COUNT(*) FROM sys.indexes WHERE name = :n AND object_id = OBJECT_ID('RouteDay')"),
        {"n": ROUTEDAY_UQ}).scalar()
    if exists:
        print(f"índice {ROUTEDAY_UQ}: ya existe — salto")
        return "existe"
    if print_routeday_duplicates(routeday_duplicates(conn)):
        print(f"índice {ROUTEDAY_UQ}: SALTEADO por los duplicados de arriba (el resto del DDL sigue).")
        return "duplicados"
    nullable = conn.execute(text(
        "SELECT is_nullable FROM sys.columns WHERE object_id = OBJECT_ID('RouteDay') AND name = 'AssignedUserId'")).scalar()
    ddl_sql = f"CREATE UNIQUE INDEX {ROUTEDAY_UQ} ON RouteDay(RouteId, WorkDate, AssignedUserId)"
    if nullable:
        # Índice filtrado: toda conexión que escriba en RouteDay necesita QUOTED_IDENTIFIER y ANSI_* en ON
        # (pymssql y ODBC los ponen por defecto). Si no, sus INSERT/UPDATE fallan con el error 1934.
        ddl_sql += " WHERE AssignedUserId IS NOT NULL"
    if not commit:
        print(f"[dry-run] índice {ROUTEDAY_UQ}: {ddl_sql}")
        return "pendiente"
    if nullable:
        conn.execute(text("SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; "
                          "SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF"))
    conn.execute(text(ddl_sql))
    print(f"índice {ROUTEDAY_UQ}: creado ({'filtrado, AssignedUserId admite NULL' if nullable else 'común, AssignedUserId es NOT NULL'})")
    return "creado"


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
        if target["kind"] == "sqlite":
            from app.database import engine as _engine
            with _engine.connect() as conn:   # solo lectura: sirve para ensayar el informe
                print_routeday_duplicates(routeday_duplicates(conn))
        print("ABORTO: este script es solo para SQL Server (prod). En SQLite/local el esquema "
              "se crea con `alembic upgrade head`. No se hizo nada.")
        return 2
    if args.commit:
        ops.confirm_or_exit(target, args.yes, "aplicar el DDL de cadenas")

    from sqlalchemy import text

    from app.database import engine
    with engine.connect() as conn:
        ops.set_lock_timeout(conn)
        # El SET abre una transacción implícita (autobegin de SQLAlchemy 2): hay que
        # cerrarla o `conn.begin()` falla. LOCK_TIMEOUT es de sesión, sobrevive al commit.
        conn.commit()
        # Transacción 1: cadenas (lo que el backend NECESITA para arrancar bien)
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
        # Transacción 2, aparte: índice único de RouteDay. Si se saltea o falla, lo de
        # cadenas ya quedó aplicado.
        print()
        trans = conn.begin()
        try:
            routeday = routeday_unique_step(conn, args.commit)
            if args.commit:
                trans.commit()
            else:
                trans.rollback()
        except Exception as e:
            trans.rollback()
            routeday = "error"
            print(f"ERROR creando {ROUTEDAY_UQ} (el DDL de cadenas NO se ve afectado): {e}")
        if not args.commit:
            n = len(pending) + (1 if routeday == "pendiente" else 0)
            print(f"\nDRY-RUN: no se escribió nada. Pasos pendientes: {n}"
                  + (" · índice de RouteDay BLOQUEADO por duplicados" if routeday == "duplicados" else "")
                  + ". Aplicar con --commit.")
            return 0
        n_chain = conn.execute(text("SELECT COUNT(*) FROM Chain")).scalar()
        total, linked = conn.execute(text(
            "SELECT COUNT(*), SUM(CASE WHEN ChainId IS NULL THEN 0 ELSE 1 END) FROM PDV")).one()
        print(f"\nDDL de cadenas OK ({len(pending)} pasos aplicados) · Chain: {n_chain} filas · PDV: {total} filas, "
              f"{linked or 0} con ChainId · índice RouteDay: {routeday}")
        if routeday in ("duplicados", "error"):
            print("⚠ El índice único de RouteDay quedó PENDIENTE: resolver y volver a correr este script (no afecta al deploy).")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
