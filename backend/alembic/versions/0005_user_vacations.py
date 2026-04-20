"""user vacations table

Revision ID: 0005_user_vacations
Revises: 0004_user_avatar
Create Date: 2026-04-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_user_vacations"
down_revision = "0004_user_avatar"
branch_labels = None
depends_on = None


def _table_exists(table: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(table)


def upgrade() -> None:
    if not _table_exists("UserVacation"):
        op.create_table(
            "UserVacation",
            sa.Column("UserVacationId", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("UserId", sa.Integer(), sa.ForeignKey("User.UserId"), nullable=False, index=True),
            sa.Column("FromDate", sa.Date(), nullable=False),
            sa.Column("ToDate", sa.Date(), nullable=False),
            sa.Column("Reason", sa.String(length=200), nullable=True),
            sa.Column("CreatedAt", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    if _table_exists("UserVacation"):
        op.drop_table("UserVacation")
