"""Proveedor con vendedores: tablas Supplier + SupplierSeller, PdvSupplier.SupplierId/SupplierSellerId

Proveedor por zona (tipo y productos del proveedor); vendedor = nombre + teléfono
opcional. PdvSupplier pasa a ser el vínculo PDV↔proveedor (+ vendedor). Las
columnas legacy de PdvSupplier no se tocan.

Prod NO está Alembic-tracked: allá se aplica con
`backend/scripts/hotfix_supplier_sellers_prod_20261007.py` (mismo DDL, idempotente).

Revision ID: 0026_supplier_sellers
Revises: 0025_route_campaign
Create Date: 2026-10-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0026_supplier_sellers"
down_revision = "0025_route_campaign"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "Supplier",
        sa.Column("SupplierId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ZoneId", sa.Integer(), sa.ForeignKey("Zone.ZoneId"), nullable=True),
        sa.Column("Name", sa.String(120), nullable=False),
        sa.Column("SupplierTypeId", sa.Integer(), sa.ForeignKey("SupplierType.SupplierTypeId"), nullable=True),
        sa.Column("Products", sa.String(500), nullable=True),
        sa.Column("IsActive", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("CreatedByUserId", sa.Integer(), sa.ForeignKey("User.UserId"), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("UpdatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_Supplier_ZoneId", "Supplier", ["ZoneId"])

    op.create_table(
        "SupplierSeller",
        sa.Column("SupplierSellerId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("SupplierId", sa.Integer(), sa.ForeignKey("Supplier.SupplierId", ondelete="CASCADE"), nullable=False),
        sa.Column("Name", sa.String(120), nullable=False),
        sa.Column("Phone", sa.String(40), nullable=True),
        sa.Column("IsActive", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_SupplierSeller_SupplierId", "SupplierSeller", ["SupplierId"])

    # batch_alter_table: SQLite no soporta ADD CONSTRAINT (FK) con ALTER directo
    with op.batch_alter_table("PdvSupplier") as batch:
        batch.add_column(sa.Column("SupplierId", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("SupplierSellerId", sa.Integer(), nullable=True))
        batch.create_foreign_key("FK_PdvSupplier_Supplier", "Supplier", ["SupplierId"], ["SupplierId"])
        batch.create_foreign_key("FK_PdvSupplier_SupplierSeller", "SupplierSeller", ["SupplierSellerId"], ["SupplierSellerId"])
        batch.create_index("ix_PdvSupplier_SupplierId", ["SupplierId"])


def downgrade() -> None:
    with op.batch_alter_table("PdvSupplier") as batch:
        batch.drop_index("ix_PdvSupplier_SupplierId")
        batch.drop_constraint("FK_PdvSupplier_SupplierSeller", type_="foreignkey")
        batch.drop_constraint("FK_PdvSupplier_Supplier", type_="foreignkey")
        batch.drop_column("SupplierSellerId")
        batch.drop_column("SupplierId")
    op.drop_index("ix_SupplierSeller_SupplierId", table_name="SupplierSeller")
    op.drop_table("SupplierSeller")
    op.drop_index("ix_Supplier_ZoneId", table_name="Supplier")
    op.drop_table("Supplier")
