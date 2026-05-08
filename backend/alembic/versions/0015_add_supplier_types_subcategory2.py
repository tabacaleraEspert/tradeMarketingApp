"""Add SupplierTypes to PDV and SubCategory2 to SubChannel

Revision ID: 0015_add_supplier_types_subcategory2
Revises: 0014_add_fk_indexes
Create Date: 2026-05-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_add_supplier_types_subcategory2"
down_revision = "0014_add_fk_indexes"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("PDV", sa.Column("SupplierTypes", sa.String(500), nullable=True))
    op.add_column("SubChannel", sa.Column("SubCategory2", sa.String(80), nullable=True))


def downgrade():
    op.drop_column("PDV", "SupplierTypes")
    op.drop_column("SubChannel", "SubCategory2")
