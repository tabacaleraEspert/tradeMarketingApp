"""Rutas de campaña + fecha de fin de ruta: Route.RouteType, Route.EndDate

RouteType 'regular' (default, todas las existentes) | 'campaign'. EndDate NULL
(sin fin) para todas las existentes.

Prod NO está Alembic-tracked: allá se aplica con
`backend/scripts/hotfix_route_campaign_prod_20260930.py` (mismo DDL, idempotente).

Revision ID: 0025_route_campaign
Revises: 0024_behavior_report
Create Date: 2026-09-30
"""
from alembic import op
import sqlalchemy as sa

revision = "0025_route_campaign"
down_revision = "0024_behavior_report"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("Route", sa.Column("RouteType", sa.String(20), nullable=False, server_default=sa.text("'regular'")))
    op.add_column("Route", sa.Column("EndDate", sa.Date, nullable=True))
    op.create_index("ix_Route_RouteType", "Route", ["RouteType"])


def downgrade() -> None:
    op.drop_index("ix_Route_RouteType", table_name="Route")
    op.drop_column("Route", "EndDate")
    op.drop_column("Route", "RouteType")
