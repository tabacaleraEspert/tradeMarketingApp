"""Add DNI column to User table for login by DNI

Revision ID: 0018_add_user_dni
Revises: 0017_visit_userid_openedat_ix
Create Date: 2026-06-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0018_add_user_dni"
down_revision = "0017_visit_userid_openedat_ix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("User", sa.Column("DNI", sa.String(20), nullable=True))
    op.create_index("ix_User_DNI", "User", ["DNI"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_User_DNI", table_name="User")
    op.drop_column("User", "DNI")
