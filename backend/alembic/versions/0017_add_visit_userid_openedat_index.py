"""Add index on Visit(UserId, OpenedAt) for dashboard monthly stats

Revision ID: 0017_visit_userid_openedat_ix
Revises: 0016_supplier_census
Create Date: 2026-05-26
"""
from alembic import op

revision = "0017_visit_userid_openedat_ix"
down_revision = "0016_supplier_census"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_visit_userid_openedat", "Visit", ["UserId", "OpenedAt"])


def downgrade() -> None:
    op.drop_index("ix_visit_userid_openedat", table_name="Visit")
