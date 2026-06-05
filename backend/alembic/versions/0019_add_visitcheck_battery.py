"""Add BatteryPct column to VisitCheck (device battery % at check-in/out)

Revision ID: 0019_add_visitcheck_battery
Revises: 0018_add_user_dni
Create Date: 2026-06-05

Idempotente: en prod la columna ya puede existir (se agregó con un ALTER
manual porque la base no estaba trackeada por Alembic). Por eso chequeamos
antes de agregar/borrar.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0019_add_visitcheck_battery"
down_revision = "0018_add_user_dni"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = [c["name"] for c in inspect(bind).get_columns(table)]
    return column in cols


def upgrade() -> None:
    if not _has_column("VisitCheck", "BatteryPct"):
        op.add_column("VisitCheck", sa.Column("BatteryPct", sa.Integer(), nullable=True))


def downgrade() -> None:
    if _has_column("VisitCheck", "BatteryPct"):
        op.drop_column("VisitCheck", "BatteryPct")
