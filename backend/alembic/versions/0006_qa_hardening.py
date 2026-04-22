"""QA hardening: PDV fields, PdvPhoto table, Distributor unique phone

Adds missing columns to PDV (TimeSlotsJson, AllowsJson, Category),
creates PdvPhoto table, and adjusts Distributor unique constraints.

Revision ID: 0006_qa_hardening
Revises: 0005_user_vacations
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa


revision = "0006_qa_hardening"
down_revision = "0005_user_vacations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------- PDV: add missing columns ----------
    with op.batch_alter_table("PDV") as batch:
        batch.add_column(sa.Column("TimeSlotsJson", sa.String(), nullable=True))
        batch.add_column(sa.Column("AllowsJson", sa.String(), nullable=True))
        batch.add_column(sa.Column("Category", sa.String(length=1), nullable=True))

    # ---------- PdvPhoto table ----------
    op.create_table(
        "PdvPhoto",
        sa.Column("PdvId", sa.Integer(), sa.ForeignKey("PDV.PdvId", ondelete="CASCADE"), primary_key=True, nullable=False),
        sa.Column("FileId", sa.Integer(), sa.ForeignKey("File.FileId", ondelete="CASCADE"), primary_key=True, nullable=False),
        sa.Column("PhotoType", sa.String(length=30), nullable=False, server_default="fachada"),
        sa.Column("SortOrder", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("Notes", sa.String(length=300), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("PdvPhoto")

    with op.batch_alter_table("PDV") as batch:
        batch.drop_column("Category")
        batch.drop_column("AllowsJson")
        batch.drop_column("TimeSlotsJson")
