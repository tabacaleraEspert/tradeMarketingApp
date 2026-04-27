"""AppSetting table for configurable parameters

Revision ID: 0012_app_settings
Revises: 0011_notification_target_user
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_app_settings"
down_revision = "0011_notification_target_user"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "AppSetting",
        sa.Column("Key", sa.String(length=80), primary_key=True),
        sa.Column("Value", sa.String(length=500), nullable=False),
        sa.Column("Description", sa.String(length=200), nullable=True),
        sa.Column("UpdatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("AppSetting")
