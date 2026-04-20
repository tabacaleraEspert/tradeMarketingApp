#!/bin/bash
echo "=== ESPERT Trade Marketing API — Startup ==="
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. Correr migraciones de Alembic (best-effort: si falla por DB, arrancamos igual)
echo "→ Intentando aplicar migraciones de Alembic..."
if python -m alembic upgrade head; then
  echo "  ✓ Migraciones aplicadas"
else
  echo "  ⚠ Migraciones fallaron — el servidor arranca igual, las tablas pueden estar desactualizadas"
fi

# 2. Levantar el server con Gunicorn + Uvicorn workers
echo "→ Arrancando Gunicorn (2 workers)..."
exec gunicorn \
  -w 2 \
  -k uvicorn.workers.UvicornWorker \
  app.main:app \
  --bind 0.0.0.0:8000 \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
