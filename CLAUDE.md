# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

App de Trade Marketing para gestión de fuerza de ventas en campo: rutas, visitas a PDVs, formularios, incidencias y reportes, con acceso por roles (RBAC). Monorepo con `backend/` (Python FastAPI) y `frontend/` (React + TypeScript).

## Comandos

### Backend (`backend/`)

```bash
python -m venv venv && venv\Scripts\activate    # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # o: python run.py
pytest tests/ -v --tb=short                     # tests (así corre en CI)
pytest tests/test_x.py::test_nombre             # un solo test
python seed_db.py                               # seed mínimo dev (crea admin@test.com / Admin123!)
alembic upgrade head                            # migraciones (la única vía válida de migrar)
```

- Sin `DATABASE_USER`/`DATABASE_PASSWORD` en `.env` (o con `USE_SQLITE=true`) usa **SQLite** automáticamente; con credenciales usa **Azure SQL** (requiere ODBC Driver 18).
- Swagger en http://localhost:8000/docs.
- Existen 4 scripts de seed (`seed_db.py`, `seed_demo.py`, `seed_azure.py`, `seed_real_users.py`) — redundancia conocida (ver `docs/backend-review-security-architecture.md`). Para dev usar `seed_db.py`; para la demo, `seed_demo.py` (ver `DEMO_GUION.md`).

### Frontend (`frontend/`)

```bash
npm install
npm run dev              # Vite dev server (requiere VITE_API_URL en .env.local; sin definir, el fallback es localhost:8001 — ver src/lib/api/config.ts)
npm run build
npm test                 # vitest, una pasada
npm run test:watch
npm test -- src/ruta/al/archivo.test.ts    # un solo archivo de test
npm run build:android    # build Capacitor
```

Env: `VITE_API_URL`, `VITE_GOOGLE_MAPS_API_KEY` (ver `frontend/.env.example`).

### CI/CD

`.github/workflows/`: `ci.yml` (pytest + build/test de frontend en Node 22), `deploy-backend.yml` (Docker → arranca con `startup.sh`: Alembic + Gunicorn puerto 8000), `deploy-frontend.yml` (Azure Static Web Apps).

## Arquitectura

### Backend — FastAPI + SQLAlchemy + Alembic

- Entrypoint: `backend/app/main.py` (CORS, middleware JWT, instrumentación SQL).
- Capas: `app/routers/` (~20 routers: auth, users, roles, pdvs, routes, forms, visits, incidents, reports…) → `app/models/` (ORM) + `app/schemas/` (Pydantic). No hay capa de servicios separada; la lógica vive mayormente en los routers.
- Auth: `backend/app/auth.py` — JWT access+refresh, dependencia `get_current_user`, RBAC vía `require_role()`. Ojo: aunque el esquema permite varios roles por usuario, el código considera efectivo **uno solo** (ver `docs/backend-review-schema.md`).
- DB: `backend/app/database.py` — pool para Azure SQL (size=15, overflow=10, pre_ping, recycle 1800s). Migraciones versionadas en `backend/alembic/versions/`.
- Storage de archivos: Azure Blob (`AZURE_STORAGE_CONNECTION_STRING`), opcional.
- Observabilidad: Sentry + Application Insights con instrumentación SQL propia (repro y detalles en `docs/DIAGNOSTICO_Y_PERFORMANCE.md` — para reproducir bugs de instrumentación usar uvicorn real, no TestClient).

### Frontend — React 18 + TS + Vite + Tailwind + Radix UI

- `src/app/App.tsx` (router + observabilidad + init de sync offline) → `src/app/routes.tsx` (React Router v7).
- Capa API: `src/lib/api/` — `client.ts` (wrapper HTTP con auto-refresh de JWT en 401), `auth-storage.ts` (tokens en localStorage), `services.ts` (métodos por recurso), `hooks.ts` (helpers de query/mutation).
- Offline-first: `src/lib/offline/` — cola de mutaciones (`queue.ts`), cache optimista y sync-worker. Tener en cuenta este flujo al tocar mutaciones.
- Empaquetado móvil con Capacitor (Android).

### Documentación clave

- `README.md` — estructura general. `LOGIN_README.md` — flujo de login y credenciales de prueba.
- `docs/arquitectura-db.md` — esquema de datos. `docs/backend-review-*.md` y `docs/frontend-review-*.md` — auditorías con deuda técnica conocida (leerlas antes de refactors grandes).
- `RUNBOOK.md`, `DEPLOY.md`, `KNOWN_ISSUES.md`, `QA_CHECKLIST.md`.
