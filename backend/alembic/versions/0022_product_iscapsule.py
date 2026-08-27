"""Product.IsCapsule (motor de oportunidades de Inteligencia Comercial)

"Capsulado" no se puede inferir del nombre: Espert lo marca con el sabor
(Icergy/Vid/Pink/Mint/Aura/Explosion), la competencia con "Caps" o un color de
fantasía (Marlboro Craft Coral, Red Point ON). Columna explícita + backfill por
lista de nombres (misma fuente que usa el servicio: app.services.intelligence).

Prod NO está Alembic-tracked: allá esto se aplica con
backend/scripts/hotfix_product_iscapsule_prod.py (mismo backfill, idempotente).

Revision ID: 0022_product_iscapsule
Revises: 0021_kpi_config
Create Date: 2026-08-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0022_product_iscapsule"
down_revision = "0021_kpi_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.services.intelligence import CAPSULE_PRODUCT_NAMES

    op.add_column(
        "Product",
        sa.Column("IsCapsule", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    product = sa.table("Product", sa.column("Name", sa.String), sa.column("IsCapsule", sa.Boolean))
    op.execute(
        product.update()
        .where(product.c.Name.in_(list(CAPSULE_PRODUCT_NAMES)))
        .values(IsCapsule=True)
    )


def downgrade() -> None:
    op.drop_column("Product", "IsCapsule")
