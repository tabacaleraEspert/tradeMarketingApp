"""Add indexes on frequently queried FK columns

Revision ID: 0014_add_fk_indexes
Revises: 0013_add_missing_url_columns
Create Date: 2026-05-04
"""
from alembic import op

revision = "0014_add_fk_indexes"
down_revision = "0013_add_missing_url_columns"
branch_labels = None
depends_on = None

# (table, column) pairs for FK columns that lack indexes
FK_INDEXES = [
    # Critical — most queried
    ("VisitCheck", "VisitId"),
    ("VisitAnswer", "VisitId"),
    ("VisitAnswer", "QuestionId"),
    ("VisitAction", "VisitId"),
    ("VisitPOPItem", "VisitId"),
    ("VisitLooseSurvey", "VisitId"),
    ("VisitCoverage", "VisitId"),
    ("VisitCoverage", "ProductId"),
    ("VisitFormTime", "VisitId"),
    ("VisitFormTime", "FormId"),
    ("PdvNote", "PdvId"),
    ("PdvNote", "VisitId"),
    ("PdvNote", "CreatedByUserId"),
    ("Incident", "VisitId"),
    ("Incident", "CreatedBy"),
    ("MarketNews", "VisitId"),
    ("MarketNews", "CreatedBy"),
    ("Device", "UserId"),
    ("RouteDay", "RouteId"),
    ("PdvContact", "PdvId"),
    ("PdvProductCategory", "PdvId"),
    # High priority
    ("PDV", "SubChannelId"),
    ("PDV", "AssignedUserId"),
    ("Route", "ZoneId"),
    ("Route", "CreatedByUserId"),
    ("Route", "AssignedUserId"),
    ("Form", "CreatedByUserId"),
    ("FormQuestion", "FormId"),
    ("FormOption", "QuestionId"),
    ("SubChannel", "ChannelId"),
    ("Notification", "CreatedBy"),
    ("Notification", "TargetUserId"),
    ("MandatoryActivity", "ChannelId"),
    ("MandatoryActivity", "CreatedByUserId"),
    ("User", "ZoneId"),
    ("VisitAction", "MandatoryActivityId"),
    ("SyncLog", "DeviceId"),
    ("VisitCheck", "DeviceId"),
]

# Composite index for hot query: visits by user + status
COMPOSITE_INDEXES = [
    ("ix_visit_user_status", "Visit", ["UserId", "Status"]),
]


def upgrade():
    for table, col in FK_INDEXES:
        idx_name = f"ix_{table.lower()}_{col.lower()}"
        try:
            op.create_index(idx_name, table, [col])
        except Exception:
            pass  # Index may already exist in some environments

    for idx_name, table, cols in COMPOSITE_INDEXES:
        try:
            op.create_index(idx_name, table, cols)
        except Exception:
            pass


def downgrade():
    for idx_name, table, cols in COMPOSITE_INDEXES:
        try:
            op.drop_index(idx_name, table_name=table)
        except Exception:
            pass

    for table, col in FK_INDEXES:
        idx_name = f"ix_{table.lower()}_{col.lower()}"
        try:
            op.drop_index(idx_name, table_name=table)
        except Exception:
            pass
