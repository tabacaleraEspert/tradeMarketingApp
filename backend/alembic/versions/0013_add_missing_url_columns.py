"""Add missing Url columns to File and PdvPhoto tables

Revision ID: 0013_add_missing_url_columns
Revises: 0012_app_settings
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_add_missing_url_columns"
down_revision = "0012_app_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("File", sa.Column("Url", sa.String(600), nullable=True))
    op.add_column("PdvPhoto", sa.Column("Url", sa.String(600), nullable=False, server_default=""))


def downgrade():
    op.drop_column("File", "Url")
    op.drop_column("PdvPhoto", "Url")
