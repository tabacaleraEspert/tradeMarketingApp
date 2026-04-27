"""Add TargetUserId to Notification

Revision ID: 0011_notification_target_user
Revises: 0010_visit_loose_survey
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_notification_target_user"
down_revision = "0010_visit_loose_survey"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("Notification") as batch:
        batch.add_column(sa.Column("TargetUserId", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("Notification") as batch:
        batch.drop_column("TargetUserId")
