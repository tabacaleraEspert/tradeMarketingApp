"""Product catalog, PdvProductCategory, VisitCoverage, VisitPOPItem tables

Implements steps 9, 10, 11 from the TNR paso-a-paso document.

Revision ID: 0009_products_coverage_pop
Revises: 0008_pdv_volume_category
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0009_products_coverage_pop"
down_revision = "0008_pdv_volume_category"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Product catalog (master data)
    op.create_table(
        "Product",
        sa.Column("ProductId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("Name", sa.String(length=120), nullable=False),
        sa.Column("Category", sa.String(length=40), nullable=False),
        sa.Column("Manufacturer", sa.String(length=80), nullable=True),
        sa.Column("IsOwn", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("IsActive", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("SortOrder", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_product_category", "Product", ["Category"])

    # PDV product categories (step 9)
    op.create_table(
        "PdvProductCategory",
        sa.Column("PdvProductCategoryId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("PdvId", sa.Integer(), sa.ForeignKey("PDV.PdvId", ondelete="CASCADE"), nullable=False),
        sa.Column("Category", sa.String(length=40), nullable=False),
        sa.Column("Status", sa.String(length=30), nullable=False, server_default="no_trabaja"),
        sa.Column("UpdatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pdvproductcategory_pdvid", "PdvProductCategory", ["PdvId"])

    # Visit coverage (step 10)
    op.create_table(
        "VisitCoverage",
        sa.Column("VisitCoverageId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("VisitId", sa.Integer(), sa.ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False),
        sa.Column("ProductId", sa.Integer(), sa.ForeignKey("Product.ProductId"), nullable=False),
        sa.Column("Works", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("Price", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("Availability", sa.String(length=20), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_visitcoverage_visitid", "VisitCoverage", ["VisitId"])

    # Visit POP census (step 11)
    op.create_table(
        "VisitPOPItem",
        sa.Column("VisitPOPItemId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("VisitId", sa.Integer(), sa.ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False),
        sa.Column("MaterialType", sa.String(length=20), nullable=False),
        sa.Column("MaterialName", sa.String(length=80), nullable=False),
        sa.Column("Company", sa.String(length=80), nullable=True),
        sa.Column("Present", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("HasPrice", sa.Boolean(), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_visitpopitem_visitid", "VisitPOPItem", ["VisitId"])


def downgrade() -> None:
    op.drop_table("VisitPOPItem")
    op.drop_table("VisitCoverage")
    op.drop_table("PdvProductCategory")
    op.drop_table("Product")
