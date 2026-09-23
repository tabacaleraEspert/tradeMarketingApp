"""Product.Brand + corte del censo de 3 estados (AppSetting coverage_explicit_no_since)

Censo de cobertura en 3 estados (Sí / No / Sin dato): la marca es el nivel
intermedio Categoría → Marca → Variante para cargar "No" de un tap. Backfill
por prefijo del nombre (app.services.coverage_semantics.brand_of); después es
editable en Gestión de Productos.

El corte histórico NO se setea acá: lo setea el hotfix de prod al momento del
deploy (`backend/scripts/hotfix_product_brand_prod_20260923.py`), porque es la
fecha real desde la que el form manda "No" explícitos. En dev/SQLite se puede
setear a mano vía PUT /settings/coverage_explicit_no_since.

Prod NO está Alembic-tracked: allá se aplica con el hotfix (mismo backfill,
idempotente).

Revision ID: 0023_product_brand
Revises: 0022_product_iscapsule
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0023_product_brand"
down_revision = "0022_product_iscapsule"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.services.coverage_semantics import brand_of

    op.add_column("Product", sa.Column("Brand", sa.String(60), nullable=True))
    op.create_index("ix_Product_Brand", "Product", ["Brand"])

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT ProductId, Name FROM Product")).fetchall()
    for product_id, name in rows:
        bind.execute(
            sa.text("UPDATE Product SET Brand = :brand WHERE ProductId = :pid"),
            {"brand": brand_of(name), "pid": product_id},
        )


def downgrade() -> None:
    op.drop_index("ix_Product_Brand", table_name="Product")
    op.drop_column("Product", "Brand")
