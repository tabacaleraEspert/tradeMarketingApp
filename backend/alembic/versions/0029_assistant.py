"""Asistente IA "Puchi": tablas de auditoría AssistantTurn / AssistantToolUse

Una fila por pregunta (tokens, costo, resultado) y una por herramienta
ejecutada. Ver `app/models/assistant.py` y `app/services/assistant/`.

Prod NO está Alembic-tracked: allá se aplica con
`backend/scripts/ddl_assistant_20261117.py` (mismo DDL, idempotente), ANTES del
deploy del backend.

Revision ID: 0029_assistant
Revises: 0028_user_visit_flow
Create Date: 2026-11-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0029_assistant"
down_revision = "0028_user_visit_flow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "AssistantTurn",
        sa.Column("AssistantTurnId", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("UserId", sa.Integer, sa.ForeignKey("User.UserId"), nullable=False),
        sa.Column("CreatedUtc", sa.DateTime, nullable=False),
        sa.Column("Question", sa.String, nullable=True),
        sa.Column("Answer", sa.String, nullable=True),
        sa.Column("Model", sa.String(60), nullable=False),
        sa.Column("Rounds", sa.Integer, nullable=False, server_default="0"),
        sa.Column("DurationMs", sa.Integer, nullable=False, server_default="0"),
        sa.Column("TokensIn", sa.Integer, nullable=False, server_default="0"),
        sa.Column("TokensOut", sa.Integer, nullable=False, server_default="0"),
        sa.Column("TokensCached", sa.Integer, nullable=False, server_default="0"),
        sa.Column("CostUsd", sa.Numeric(10, 6), nullable=False, server_default="0"),
        sa.Column("Ok", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("Error", sa.String(500), nullable=True),
    )
    op.create_index("ix_AssistantTurn_UserId", "AssistantTurn", ["UserId"])
    op.create_index("ix_AssistantTurn_CreatedUtc", "AssistantTurn", ["CreatedUtc"])
    op.create_table(
        "AssistantToolUse",
        sa.Column("AssistantToolUseId", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "AssistantTurnId", sa.Integer,
            sa.ForeignKey("AssistantTurn.AssistantTurnId", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("Tool", sa.String(60), nullable=False),
        sa.Column("ArgsJson", sa.String(2000), nullable=True),
        sa.Column("DurationMs", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index("ix_AssistantToolUse_AssistantTurnId", "AssistantToolUse", ["AssistantTurnId"])


def downgrade() -> None:
    op.drop_table("AssistantToolUse")
    op.drop_table("AssistantTurn")
