"""SsoUsedJti table: single-use jti for Command Center SSO tickets

Revision ID: 0020_sso_used_jti
Revises: 0019_add_visitcheck_battery
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_sso_used_jti"
down_revision = "0019_add_visitcheck_battery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "SsoUsedJti",
        sa.Column("Jti", sa.String(64), primary_key=True),
        sa.Column("ExpiresAt", sa.DateTime(), nullable=False),
        sa.Column("UsedAt", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("SsoUsedJti")
