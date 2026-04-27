"""Add MonthlyVolume to PDV, widen Category column

Revision ID: 0008_pdv_volume_category
Revises: 0007_channel_description
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0008_pdv_volume_category"
down_revision = "0007_channel_description"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("PDV") as batch:
        batch.add_column(sa.Column("MonthlyVolume", sa.Integer(), nullable=True))
        batch.alter_column("Category", type_=sa.String(length=10), existing_type=sa.String(length=1))


def downgrade() -> None:
    with op.batch_alter_table("PDV") as batch:
        batch.drop_column("MonthlyVolume")
        batch.alter_column("Category", type_=sa.String(length=1), existing_type=sa.String(length=10))
