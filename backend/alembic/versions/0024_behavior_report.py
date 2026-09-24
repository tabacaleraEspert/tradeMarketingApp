"""Reporte de comportamiento por mail: BehaviorReportSubscription + BehaviorReport

Destinatarios (con alcance all/team/custom) y reportes enviados (snapshot +
token de la página pública /r/<token>, vence a 30 días). Índice único filtrado
(SubscriptionId, Kind, PeriodFrom) salvo Kind='test' = un envío por período.

Prod NO está Alembic-tracked: allá se aplica con
`backend/scripts/hotfix_behavior_report_prod_20260924.py` (mismo DDL, idempotente).

Revision ID: 0024_behavior_report
Revises: 0023_product_brand
Create Date: 2026-09-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0024_behavior_report"
down_revision = "0023_product_brand"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "BehaviorReportSubscription",
        sa.Column("SubscriptionId", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("Email", sa.String(256), nullable=False),
        sa.Column("Name", sa.String(120), nullable=False),
        sa.Column("Scope", sa.String(10), nullable=False),
        sa.Column("ScopeUserId", sa.Integer, sa.ForeignKey("User.UserId"), nullable=True),
        sa.Column("TradeIds", sa.Text, nullable=True),
        sa.Column("WeeklyEnabled", sa.Boolean, nullable=False),
        sa.Column("MonthlyEnabled", sa.Boolean, nullable=False),
        sa.Column("IsActive", sa.Boolean, nullable=False),
        sa.Column("AutoCreated", sa.Boolean, nullable=False),
        sa.Column("UserId", sa.Integer, sa.ForeignKey("User.UserId"), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_BehaviorReportSubscription_UserId", "BehaviorReportSubscription", ["UserId"])
    op.create_table(
        "BehaviorReport",
        sa.Column("ReportId", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("Token", sa.String(64), nullable=False, unique=True),
        sa.Column("SubscriptionId", sa.Integer, sa.ForeignKey("BehaviorReportSubscription.SubscriptionId"), nullable=True),
        sa.Column("Kind", sa.String(10), nullable=False),
        sa.Column("PeriodFrom", sa.Date, nullable=False),
        sa.Column("PeriodTo", sa.Date, nullable=False),
        sa.Column("Email", sa.String(256), nullable=False),
        sa.Column("Payload", sa.Text, nullable=False),
        sa.Column("ExpiresAt", sa.DateTime, nullable=False),
        sa.Column("SentAt", sa.DateTime, nullable=True),
        sa.Column("SendError", sa.String(1000), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_BehaviorReport_SubscriptionId", "BehaviorReport", ["SubscriptionId"])
    op.create_index(
        "ux_BehaviorReport_period", "BehaviorReport", ["SubscriptionId", "Kind", "PeriodFrom"], unique=True,
        mssql_where=sa.text("Kind <> 'test'"), sqlite_where=sa.text("Kind <> 'test'"),
    )


def downgrade() -> None:
    op.drop_table("BehaviorReport")
    op.drop_table("BehaviorReportSubscription")
