"""Cadenas y key accounts: tabla Chain + PDV.ChainId

Dos ejes separados: Channel › SubChannel = formato del local; Chain = de quién es
(cadena retail o bandera de estación de servicio). Key account = atributo de la
cadena. Ver `app/models/chain.py` y `app/services/chains.py`.

Prod NO está Alembic-tracked: allá se aplica con
`backend/scripts/ddl_chains_20261119.py` (mismo DDL, idempotente), ANTES del
deploy del backend (el modelo nuevo hace SELECT de PDV.ChainId).

Revision ID: 0030_chains
Revises: 0029_assistant
Create Date: 2026-11-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0030_chains"
down_revision = "0029_assistant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "Chain",
        sa.Column("ChainId", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("Name", sa.String(80), nullable=False),
        sa.Column("ChannelId", sa.Integer, sa.ForeignKey("Channel.ChannelId"), nullable=False),
        sa.Column("Kind", sa.String(20), nullable=False, server_default="cadena"),
        sa.Column("IsKeyAccount", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("AccountManagerUserId", sa.Integer, sa.ForeignKey("User.UserId"), nullable=True),
        sa.Column("StoreCount", sa.Integer, nullable=True),
        sa.Column("Aliases", sa.String(500), nullable=True),
        sa.Column("IsActive", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("CreatedAt", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("ChannelId", "Name", name="uq_Chain_ChannelId_Name"),
    )
    op.create_index("ix_Chain_ChainId", "Chain", ["ChainId"])
    op.create_index("ix_Chain_ChannelId", "Chain", ["ChannelId"])

    with op.batch_alter_table("PDV") as batch:
        batch.add_column(sa.Column("ChainId", sa.Integer, nullable=True))
        batch.create_foreign_key("FK_PDV_Chain", "Chain", ["ChainId"], ["ChainId"])
        batch.create_index("ix_PDV_ChainId", ["ChainId"])


def downgrade() -> None:
    with op.batch_alter_table("PDV") as batch:
        batch.drop_index("ix_PDV_ChainId")
        batch.drop_constraint("FK_PDV_Chain", type_="foreignkey")
        batch.drop_column("ChainId")
    op.drop_index("ix_Chain_ChannelId", table_name="Chain")
    op.drop_index("ix_Chain_ChainId", table_name="Chain")
    op.drop_table("Chain")
