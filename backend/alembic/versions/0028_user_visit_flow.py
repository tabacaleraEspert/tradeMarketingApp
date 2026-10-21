"""User.VisitFlow: flujo de visita por usuario ("full" | "short")

"full" = visita de 7 pasos (check-in → formularios → cobertura → POP → proveedores
→ acciones → novedades → resumen). "short" = check-in → formulario → resumen,
para activadores que solo relevan con el formulario de sus rutas (Activación
La Plata 2026-10).

Prod NO está Alembic-tracked: allá se aplica con
`backend/scripts/ddl_user_visit_flow_20261019.py` (mismo DDL, idempotente).

Revision ID: 0028_user_visit_flow
Revises: 0027_pop_materials
Create Date: 2026-10-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0028_user_visit_flow"
down_revision = "0027_pop_materials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("User") as batch:
        batch.add_column(
            sa.Column("VisitFlow", sa.String(20), nullable=False, server_default=sa.text("'full'"))
        )


def downgrade() -> None:
    with op.batch_alter_table("User") as batch:
        batch.drop_column("VisitFlow")
