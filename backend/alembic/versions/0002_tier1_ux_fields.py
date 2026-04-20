"""tier 1 UX fields del feedback de cliente

Agrega campos al modelo PDV (razón social, horarios, razón inactivo),
PdvContact (notas + perfil) y Distributor (teléfono, tipo, fuente).

Revision ID: 0002_tier1_ux_fields
Revises: 0001_baseline
Create Date: 2026-04-10
"""
from alembic import op
import sqlalchemy as sa


revision = "0002_tier1_ux_fields"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------- PDV ----------
    with op.batch_alter_table("PDV") as batch:
        batch.add_column(sa.Column("BusinessName", sa.String(length=200), nullable=True))
        batch.add_column(sa.Column("OpeningTime", sa.String(length=5), nullable=True))
        batch.add_column(sa.Column("ClosingTime", sa.String(length=5), nullable=True))
        batch.add_column(sa.Column("InactiveReason", sa.String(length=500), nullable=True))
        batch.add_column(sa.Column("InactiveSince", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("ReactivateOn", sa.Date(), nullable=True))

    # ---------- PdvContact ----------
    with op.batch_alter_table("PdvContact") as batch:
        batch.add_column(sa.Column("Notes", sa.String(length=1000), nullable=True))
        batch.add_column(sa.Column("ProfileNotes", sa.String(length=1000), nullable=True))

    # ---------- Distributor ----------
    with op.batch_alter_table("Distributor") as batch:
        batch.add_column(sa.Column("Phone", sa.String(length=40), nullable=True))
        batch.add_column(sa.Column("DistributorType", sa.String(length=40), nullable=True))
        batch.add_column(sa.Column("SupplierSource", sa.String(length=200), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("Distributor") as batch:
        batch.drop_column("SupplierSource")
        batch.drop_column("DistributorType")
        batch.drop_column("Phone")

    with op.batch_alter_table("PdvContact") as batch:
        batch.drop_column("ProfileNotes")
        batch.drop_column("Notes")

    with op.batch_alter_table("PDV") as batch:
        batch.drop_column("ReactivateOn")
        batch.drop_column("InactiveSince")
        batch.drop_column("InactiveReason")
        batch.drop_column("ClosingTime")
        batch.drop_column("OpeningTime")
        batch.drop_column("BusinessName")
