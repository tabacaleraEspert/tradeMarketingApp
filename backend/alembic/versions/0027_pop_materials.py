"""Material POP real: catálogo PopMaterial, VisitPOPItem.MaterialCode, tabla VisitPOPPlacement

Catálogo sincronizado desde comercial-nuevo-mobiliza (artículos MKT de Bejerman).
El censo POP suma MaterialCode (nullable, sin FK); la colocación pasa a tener
tabla propia (artículo + cantidad + ubicación) además del texto en VisitAction.

Prod NO está Alembic-tracked: allá se aplica con
`backend/scripts/ddl_pop_materials_20261008.py` (mismo DDL, idempotente).

Revision ID: 0027_pop_materials
Revises: 0026_supplier_sellers
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0027_pop_materials"
down_revision = "0026_supplier_sellers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "PopMaterial",
        sa.Column("Code", sa.String(30), primary_key=True),
        sa.Column("Description", sa.String(200), nullable=False),
        sa.Column("Line", sa.String(80), nullable=True),
        sa.Column("Type", sa.String(120), nullable=True),
        sa.Column("Year", sa.Integer(), nullable=True),
        sa.Column("PhotoUrl", sa.String(400), nullable=True),
        sa.Column("Stock", sa.Float(), nullable=True),
        sa.Column("IsActive", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("SyncedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    with op.batch_alter_table("VisitPOPItem") as batch:
        batch.add_column(sa.Column("MaterialCode", sa.String(30), nullable=True))

    op.create_table(
        "VisitPOPPlacement",
        sa.Column("VisitPOPPlacementId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("VisitId", sa.Integer(), sa.ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False),
        sa.Column("MaterialCode", sa.String(30), nullable=True),
        sa.Column("MaterialName", sa.String(200), nullable=False),
        sa.Column("Quantity", sa.Integer(), nullable=False),
        sa.Column("Location", sa.String(200), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("Quantity >= 1", name="CK_VisitPOPPlacement_Quantity"),
    )
    op.create_index("ix_VisitPOPPlacement_VisitId", "VisitPOPPlacement", ["VisitId"])
    op.create_index("ix_VisitPOPPlacement_MaterialCode", "VisitPOPPlacement", ["MaterialCode"])


def downgrade() -> None:
    op.drop_index("ix_VisitPOPPlacement_MaterialCode", table_name="VisitPOPPlacement")
    op.drop_index("ix_VisitPOPPlacement_VisitId", table_name="VisitPOPPlacement")
    op.drop_table("VisitPOPPlacement")
    with op.batch_alter_table("VisitPOPItem") as batch:
        batch.drop_column("MaterialCode")
    op.drop_table("PopMaterial")
