"""KPI config tables (tablero TMR) + Route.IsFocus

Tablas de configuración del motor de KPIs (docs/tablero-tmr-plan-fase1.md, tarea T1):
KpiDefinition, KpiConfig, ScoringCoverageRule, ScoringCommunicationRule,
KpiMonthlySnapshot; y columna Route.IsFocus (universo de ruta foco).

Seed: los 5 KPIs + rúbricas de cobertura/comunicación como config `global`, tomados
de `app.kpi_defaults` (misma fuente que usa `seed_db.py` en dev).

Revision ID: 0021_kpi_config
Revises: 0020_sso_used_jti
Create Date: 2026-08-03
"""
from datetime import date

from alembic import op
import sqlalchemy as sa

revision = "0021_kpi_config"
down_revision = "0020_sso_used_jti"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "KpiDefinition",
        sa.Column("KpiDefinitionId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("KpiKey", sa.String(length=40), nullable=False, unique=True),
        sa.Column("Name", sa.String(length=120), nullable=False),
        sa.Column("Description", sa.String(length=500), nullable=True),
        sa.Column("IsActive", sa.Boolean(), nullable=False, server_default=sa.text("1")),
    )

    op.create_table(
        "KpiConfig",
        sa.Column("KpiConfigId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("KpiDefinitionId", sa.Integer(), sa.ForeignKey("KpiDefinition.KpiDefinitionId"), nullable=False),
        sa.Column("Weight", sa.Integer(), nullable=False),
        sa.Column("Target", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("ScopeType", sa.String(length=10), nullable=False),
        sa.Column("ScopeId", sa.Integer(), nullable=True),
        sa.Column("ValidFrom", sa.Date(), nullable=False),
        sa.Column("ValidTo", sa.Date(), nullable=True),
        sa.Column("CreatedByUserId", sa.Integer(), sa.ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_kpiconfig_kpidefinitionid", "KpiConfig", ["KpiDefinitionId"])
    op.create_index("ix_kpiconfig_createdbyuserid", "KpiConfig", ["CreatedByUserId"])
    op.create_index("ix_kpiconfig_scope_validfrom", "KpiConfig", ["ScopeType", "ScopeId", "ValidFrom"])

    op.create_table(
        "ScoringCoverageRule",
        sa.Column("RuleId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("Brand", sa.String(length=80), nullable=False),
        sa.Column("ProductGroupJson", sa.String(), nullable=True),
        sa.Column("Level", sa.String(length=20), nullable=False),
        sa.Column("MinSkus", sa.Integer(), nullable=False),
        sa.Column("ScopeType", sa.String(length=10), nullable=False),
        sa.Column("ScopeId", sa.Integer(), nullable=True),
        sa.Column("ValidFrom", sa.Date(), nullable=False),
        sa.Column("ValidTo", sa.Date(), nullable=True),
        sa.Column("CreatedByUserId", sa.Integer(), sa.ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_scoringcoveragerule_createdbyuserid", "ScoringCoverageRule", ["CreatedByUserId"])

    op.create_table(
        "ScoringCommunicationRule",
        sa.Column("RuleId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("MaterialType", sa.String(length=40), nullable=False),
        sa.Column("Level", sa.String(length=20), nullable=False),
        sa.Column("Required", sa.Boolean(), nullable=True),
        sa.Column("MinElements", sa.Integer(), nullable=True),
        sa.Column("ScopeType", sa.String(length=10), nullable=False),
        sa.Column("ScopeId", sa.Integer(), nullable=True),
        sa.Column("ValidFrom", sa.Date(), nullable=False),
        sa.Column("ValidTo", sa.Date(), nullable=True),
        sa.Column("CreatedByUserId", sa.Integer(), sa.ForeignKey("User.UserId", ondelete="SET NULL"), nullable=True),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_scoringcommunicationrule_createdbyuserid", "ScoringCommunicationRule", ["CreatedByUserId"])

    op.create_table(
        "KpiMonthlySnapshot",
        sa.Column("SnapshotId", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("UserId", sa.Integer(), sa.ForeignKey("User.UserId"), nullable=False),
        sa.Column("Year", sa.Integer(), nullable=False),
        sa.Column("Month", sa.Integer(), nullable=False),
        sa.Column("KpiDefinitionId", sa.Integer(), sa.ForeignKey("KpiDefinition.KpiDefinitionId"), nullable=False),
        sa.Column("Actual", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("Target", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("Weight", sa.Integer(), nullable=False),
        sa.Column("ScopeApplied", sa.String(length=10), nullable=False),
        sa.Column("Achieved", sa.Boolean(), nullable=False),
        sa.Column("Numerator", sa.Integer(), nullable=False),
        sa.Column("Denominator", sa.Integer(), nullable=False),
        sa.Column("FrozenAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("UserId", "Year", "Month", "KpiDefinitionId", name="uq_kpimonthlysnapshot_user_year_month_kpi"),
    )
    op.create_index("ix_kpimonthlysnapshot_userid", "KpiMonthlySnapshot", ["UserId"])
    op.create_index("ix_kpimonthlysnapshot_kpidefinitionid", "KpiMonthlySnapshot", ["KpiDefinitionId"])

    # Ruta foco: universo de PDVs sobre el que se miden los KPIs (default true = comportamiento
    # actual intacto). ADD COLUMN con server_default: seguro sobre Azure SQL con datos.
    with op.batch_alter_table("Route") as batch_op:
        batch_op.add_column(sa.Column("IsFocus", sa.Boolean(), nullable=False, server_default=sa.text("1")))

    # --- Seed: los 5 KPIs + rúbricas globales (mismos datos que app/kpi_defaults.py) ---
    from app.kpi_defaults import KPI_DEFINITIONS, COVERAGE_RULES, COMMUNICATION_RULES

    valid_from = date.today().replace(day=1)

    kpi_definition_table = sa.table(
        "KpiDefinition",
        sa.column("KpiKey", sa.String),
        sa.column("Name", sa.String),
        sa.column("Description", sa.String),
        sa.column("IsActive", sa.Boolean),
    )
    op.bulk_insert(kpi_definition_table, [
        {
            "KpiKey": kpi["key"],
            "Name": kpi["name"],
            "Description": kpi["description"],
            "IsActive": True,
        }
        for kpi in KPI_DEFINITIONS
    ])

    # Tabla recién creada en esta misma migración: los IDs autoincrementales siguen el
    # orden de inserción de arriba (1..N), así que podemos mapearlos sin volver a leer.
    kpi_id_by_key = {kpi["key"]: idx + 1 for idx, kpi in enumerate(KPI_DEFINITIONS)}

    kpi_config_table = sa.table(
        "KpiConfig",
        sa.column("KpiDefinitionId", sa.Integer),
        sa.column("Weight", sa.Integer),
        sa.column("Target", sa.Numeric),
        sa.column("ScopeType", sa.String),
        sa.column("ScopeId", sa.Integer),
        sa.column("ValidFrom", sa.Date),
        sa.column("ValidTo", sa.Date),
        sa.column("CreatedByUserId", sa.Integer),
    )
    op.bulk_insert(kpi_config_table, [
        {
            "KpiDefinitionId": kpi_id_by_key[kpi["key"]],
            "Weight": kpi["weight"],
            "Target": kpi["target"],
            "ScopeType": "global",
            "ScopeId": None,
            "ValidFrom": valid_from,
            "ValidTo": None,
            "CreatedByUserId": None,
        }
        for kpi in KPI_DEFINITIONS
    ])

    coverage_rule_table = sa.table(
        "ScoringCoverageRule",
        sa.column("Brand", sa.String),
        sa.column("ProductGroupJson", sa.String),
        sa.column("Level", sa.String),
        sa.column("MinSkus", sa.Integer),
        sa.column("ScopeType", sa.String),
        sa.column("ScopeId", sa.Integer),
        sa.column("ValidFrom", sa.Date),
        sa.column("ValidTo", sa.Date),
        sa.column("CreatedByUserId", sa.Integer),
    )
    op.bulk_insert(coverage_rule_table, [
        {
            "Brand": brand,
            "ProductGroupJson": None,
            "Level": level,
            "MinSkus": min_skus,
            "ScopeType": "global",
            "ScopeId": None,
            "ValidFrom": valid_from,
            "ValidTo": None,
            "CreatedByUserId": None,
        }
        for brand, level, min_skus in COVERAGE_RULES
    ])

    communication_rule_table = sa.table(
        "ScoringCommunicationRule",
        sa.column("MaterialType", sa.String),
        sa.column("Level", sa.String),
        sa.column("Required", sa.Boolean),
        sa.column("MinElements", sa.Integer),
        sa.column("ScopeType", sa.String),
        sa.column("ScopeId", sa.Integer),
        sa.column("ValidFrom", sa.Date),
        sa.column("ValidTo", sa.Date),
        sa.column("CreatedByUserId", sa.Integer),
    )
    op.bulk_insert(communication_rule_table, [
        {
            "MaterialType": material_type,
            "Level": level,
            "Required": required,
            "MinElements": min_elements,
            "ScopeType": "global",
            "ScopeId": None,
            "ValidFrom": valid_from,
            "ValidTo": None,
            "CreatedByUserId": None,
        }
        for material_type, level, required, min_elements in COMMUNICATION_RULES
    ])


def downgrade() -> None:
    with op.batch_alter_table("Route") as batch_op:
        batch_op.drop_column("IsFocus")
    op.drop_table("KpiMonthlySnapshot")
    op.drop_table("ScoringCommunicationRule")
    op.drop_table("ScoringCoverageRule")
    op.drop_table("KpiConfig")
    op.drop_table("KpiDefinition")
