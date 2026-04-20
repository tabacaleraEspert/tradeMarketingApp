"""día 14: PDV.VisitDay + tabla Holiday

Revision ID: 0003_visit_day_holidays
Revises: 0002_tier1_ux_fields
Create Date: 2026-04-10

NOTA: esta migración es IDEMPOTENTE. Chequea si la columna/tabla ya existe
antes de crearla, porque Base.metadata.create_all en main.py puede haberlas
creado en dev local (SQLite).
"""
from alembic import op
import sqlalchemy as sa


revision = "0003_visit_day_holidays"
down_revision = "0002_tier1_ux_fields"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in [c["name"] for c in inspector.get_columns(table)]


def _table_exists(table: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return inspector.has_table(table)


def upgrade() -> None:
    # PDV.VisitDay
    if not _column_exists("PDV", "VisitDay"):
        with op.batch_alter_table("PDV") as batch:
            batch.add_column(sa.Column("VisitDay", sa.Integer(), nullable=True))

    # Tabla Holiday
    if not _table_exists("Holiday"):
        op.create_table(
            "Holiday",
            sa.Column("HolidayId", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("Date", sa.Date(), nullable=False, unique=True),
            sa.Column("Name", sa.String(length=120), nullable=False),
            sa.Column("Kind", sa.String(length=40), nullable=True),
            sa.Column("IsActive", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column(
                "CreatedAt",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index("ix_Holiday_Date", "Holiday", ["Date"], unique=True)


def downgrade() -> None:
    if _table_exists("Holiday"):
        try:
            op.drop_index("ix_Holiday_Date", table_name="Holiday")
        except Exception:
            pass
        op.drop_table("Holiday")
    if _column_exists("PDV", "VisitDay"):
        with op.batch_alter_table("PDV") as batch:
            batch.drop_column("VisitDay")
