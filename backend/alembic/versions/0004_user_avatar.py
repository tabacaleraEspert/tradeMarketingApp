"""user avatar (foto de perfil)

Revision ID: 0004_user_avatar
Revises: 0003_visit_day_holidays
Create Date: 2026-04-10

NOTA: idempotente — chequea si la columna ya existe.
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_user_avatar"
down_revision = "0003_visit_day_holidays"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in [c["name"] for c in inspector.get_columns(table)]


def upgrade() -> None:
    if not _column_exists("User", "AvatarFileId"):
        with op.batch_alter_table("User") as batch:
            batch.add_column(sa.Column("AvatarFileId", sa.Integer(), nullable=True))


def downgrade() -> None:
    if _column_exists("User", "AvatarFileId"):
        with op.batch_alter_table("User") as batch:
            batch.drop_column("AvatarFileId")
