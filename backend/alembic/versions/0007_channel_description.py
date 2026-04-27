"""Add Description column to Channel and SubChannel tables

Revision ID: 0007_channel_description
Revises: 0006_qa_hardening
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0007_channel_description"
down_revision = "0006_qa_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("Channel") as batch:
        batch.add_column(sa.Column("Description", sa.String(length=300), nullable=True))

    with op.batch_alter_table("SubChannel") as batch:
        batch.add_column(sa.Column("Description", sa.String(length=300), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("SubChannel") as batch:
        batch.drop_column("Description")

    with op.batch_alter_table("Channel") as batch:
        batch.drop_column("Description")
