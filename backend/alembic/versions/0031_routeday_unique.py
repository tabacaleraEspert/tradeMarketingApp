"""RouteDay: índice único (RouteId, WorkDate, AssignedUserId).

"Una ruta no puede tener dos veces el mismo día para el mismo usuario" hoy solo lo
cuida el código (app/routers/routes.py). Los activadores comparten ruta + fecha con
usuarios DISTINTOS: por eso el usuario forma parte de la clave. Índice parcial
(AssignedUserId IS NOT NULL): en prod la columna puede admitir NULL.

Si ya hay duplicados NO se crea (y la migración no falla): se listan y se resuelven a
mano; nunca se borran ni se fusionan filas automáticamente. Volver a correr después
con `alembic downgrade 0030_chains && alembic upgrade head`, o crear el índice a mano.

No se agrega UniqueConstraint al modelo (app/models/route.py): el índice vive solo en
la base. Prod no está trackeado por Alembic: ahí se aplica con
scripts/ddl_chains_20261119.py (mismo índice, mismo chequeo).

Revision ID: 0031_routeday_unique
Revises: 0030_chains
"""
import sqlalchemy as sa
from alembic import op

revision = "0031_routeday_unique"
down_revision = "0030_chains"
branch_labels = None
depends_on = None

INDEX = "uq_RouteDay_Route_Date_User"

DUPLICATES_SQL = """
SELECT RouteId, WorkDate, AssignedUserId, COUNT(*) AS n, MIN(RouteDayId) AS primero, MAX(RouteDayId) AS ultimo
FROM RouteDay
WHERE AssignedUserId IS NOT NULL
GROUP BY RouteId, WorkDate, AssignedUserId
HAVING COUNT(*) > 1
"""


def _has_index(bind) -> bool:
    insp = sa.inspect(bind)
    return insp.has_table("RouteDay") and any(i["name"] == INDEX for i in insp.get_indexes("RouteDay"))


def upgrade():
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("RouteDay") or _has_index(bind):
        return
    dups = bind.execute(sa.text(DUPLICATES_SQL)).fetchall()
    if dups:
        print(f"[0031_routeday_unique] {len(dups)} grupos duplicados en RouteDay: NO se crea {INDEX}. "
              "Resolver a mano y volver a correr:")
        for d in dups[:50]:
            print(f"   ruta {d[0]} · {str(d[1])[:10]} · usuario {d[2]} · {d[3]} filas (RouteDayId {d[4]}…{d[5]})")
        return
    where = sa.text("AssignedUserId IS NOT NULL")
    op.create_index(INDEX, "RouteDay", ["RouteId", "WorkDate", "AssignedUserId"], unique=True,
                    sqlite_where=where, mssql_where=where)


def downgrade():
    if _has_index(op.get_bind()):
        op.drop_index(INDEX, table_name="RouteDay")
