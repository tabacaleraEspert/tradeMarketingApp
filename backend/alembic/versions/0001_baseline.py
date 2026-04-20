"""baseline: crea todas las tablas del schema actual

Revision ID: 0001_baseline
Revises:
Create Date: 2026-04-10

NOTAS DE MIGRACIÓN:

1. **Fresh DB (sin tablas):**
       alembic upgrade head
   Esto corre `Base.metadata.create_all()` y crea todas las tablas.

2. **DB existente (ya tiene tablas, migradas a mano con los scripts viejos):**
       alembic stamp 0001_baseline
   Esto marca la DB como "ya aplicada esta migración" sin tocar nada.
   Después podés seguir normal: `alembic upgrade head` aplicará las siguientes.

3. **Futuras migraciones:** usar `alembic revision --autogenerate -m "..."`.
   Alembic va a detectar los cambios contra `Base.metadata` y generar el código.

Esta baseline NO es idiomática (un migration "bueno" tendría op.create_table(...) para
cada tabla), pero para un piloto chico con 6 usuarios es pragmático y reversible.
El día que la jerarquía de migraciones crezca, se puede "squash" reemplazando esta
baseline por una hand-written con create_table explícitos.
"""
from alembic import op
from sqlalchemy.orm import Session

# revision identifiers, used by Alembic.
revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Import dentro de la función para evitar ciclos al importar el script
    from app.database import Base
    bind = op.get_bind()
    # create_all es idempotente: no toca tablas que ya existen.
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    # Peligroso: drop all tables. Sólo para desarrollo local.
    from app.database import Base
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
