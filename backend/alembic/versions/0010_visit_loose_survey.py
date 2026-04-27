"""VisitLooseSurvey table (paso 12 - relevamiento de sueltos)

Revision ID: 0010_visit_loose_survey
Revises: 0009_products_coverage_pop
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0010_visit_loose_survey"
down_revision = "0009_products_coverage_pop"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "VisitLooseSurvey",
        sa.Column("VisitLooseSurveyId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("VisitId", sa.Integer(), sa.ForeignKey("Visit.VisitId", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("SellsLoose", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("ProductsJson", sa.String(), nullable=True),
        sa.Column("ExchangeJson", sa.String(), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("VisitLooseSurvey")
