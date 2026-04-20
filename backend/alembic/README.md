# Migraciones con Alembic

## Conceptos

- **Baseline** (`0001_baseline.py`): representa el schema actual (abril 2026). Para bases que ya existen (con los scripts viejos aplicados), sólo hay que marcarlas como "aplicada" con `alembic stamp 0001_baseline`. Para bases frescas, `alembic upgrade head` crea todas las tablas.
- **Migraciones nuevas**: desde acá en adelante, todo cambio de schema va como un archivo en `alembic/versions/`. Se pueden autogenerar a partir de los cambios en los modelos SQLAlchemy con `alembic revision --autogenerate -m "descripción"`.

## Flujo típico para devs

### 1. Base de datos nueva (primera vez)

```sh
cd backend
source .venv/bin/activate
alembic upgrade head         # crea todas las tablas
python seed_demo.py          # (opcional) datos de demo
```

### 2. Base de datos existente (migrada a mano con los scripts viejos)

```sh
cd backend
source .venv/bin/activate
alembic stamp 0001_baseline  # marca como "al día" sin tocar el schema
```

Después seguís normal con `alembic upgrade head` cuando haya nuevas migraciones.

### 3. Agregar una migración nueva (por ejemplo: agregar campo `Email2` a `User`)

```sh
# Editá el modelo en app/models/user.py primero
# Después:
alembic revision --autogenerate -m "add Email2 to User"
# Revisá el archivo generado en alembic/versions/ (a veces hay que corregir manualmente)
alembic upgrade head
```

### 4. Bajar una migración

```sh
alembic downgrade -1         # bajá una
alembic downgrade base       # bajá todo (¡peligroso!)
```

## Deploy a Azure

El deploy debe incluir `alembic upgrade head` como paso previo a iniciar el servidor. Sugerido:

```sh
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Troubleshooting

**Error: "Target database is not up to date"**
→ Alguien agregó tablas/columnas a mano sin pasar por Alembic. Ejecutá:
```sh
alembic stamp head
```

**Error: "Can't locate revision identified by '0001_baseline'"**
→ El `alembic_version` de la DB apunta a una revisión que no existe. Resetear:
```sh
# En psql / DB Browser
DELETE FROM alembic_version;
# Y después
alembic stamp 0001_baseline
```

**Autogenerate no detecta cambios**
→ Verificá que el modelo esté importado en `app/models/__init__.py`. Si está en un archivo nuevo, hay que importarlo ahí.
