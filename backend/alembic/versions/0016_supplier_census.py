"""Supplier census: lookup tables + PDV supplier records

Revision ID: 0016_supplier_census
Revises: 0015_add_supplier_types_subcategory2
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0016_supplier_census"
down_revision = "0015_add_supplier_types_subcategory2"
branch_labels = None
depends_on = None


def upgrade():
    # Lookup: tipos de proveedor
    op.create_table(
        "SupplierType",
        sa.Column("SupplierTypeId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("Name", sa.String(80), nullable=False),
        sa.Column("IsActive", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Lookup: tipos de producto de proveedor
    op.create_table(
        "SupplierProductType",
        sa.Column("SupplierProductTypeId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("Name", sa.String(80), nullable=False),
        sa.Column("IsActive", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Proveedores por PDV
    op.create_table(
        "PdvSupplier",
        sa.Column("PdvSupplierId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("PdvId", sa.Integer(), sa.ForeignKey("PDV.PdvId", ondelete="CASCADE"), nullable=False),
        sa.Column("ZoneId", sa.Integer(), sa.ForeignKey("Zone.ZoneId"), nullable=True),
        sa.Column("Name", sa.String(120), nullable=False),
        sa.Column("Phone", sa.String(40), nullable=False),
        sa.Column("SupplierTypeId", sa.Integer(), sa.ForeignKey("SupplierType.SupplierTypeId"), nullable=True),
        sa.Column("Products", sa.String(500), nullable=True),
        sa.Column("IsActive", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("UpdatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pdvsupplier_pdvid", "PdvSupplier", ["PdvId"])
    op.create_index("ix_pdvsupplier_zoneid", "PdvSupplier", ["ZoneId"])

    # Seed data
    supplier_types = sa.table("SupplierType", sa.column("Name", sa.String))
    op.bulk_insert(supplier_types, [
        {"Name": "Intermediario"},
        {"Name": "Distribuidor"},
        {"Name": "Mayorista"},
    ])

    product_types = sa.table("SupplierProductType", sa.column("Name", sa.String))
    op.bulk_insert(product_types, [
        {"Name": "Cigarrillos"},
        {"Name": "Tabacos"},
        {"Name": "Vapes"},
        {"Name": "Pouches de nicotina"},
        {"Name": "Golosinas"},
    ])


def downgrade():
    op.drop_table("PdvSupplier")
    op.drop_table("SupplierProductType")
    op.drop_table("SupplierType")
