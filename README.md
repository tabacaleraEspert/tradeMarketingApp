# Trade Marketing App

Aplicacion completa de trade marketing para gestion de rutas, visitas a PDV, formularios, incidentes, y reportes. Incluye sistema de roles/permisos, upload de fotos a Azure Blob Storage, y observabilidad con Sentry + App Insights.

## Stack
- **Backend:** Python 3, FastAPI, SQLAlchemy, Alembic, pymssql, Azure Blob Storage, Sentry
- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS 4, Radix UI, MUI, Recharts, Google Maps
- **DB:** SQLite (dev) / Azure SQL (prod)
- **Deploy:** Docker (backend), Azure Static Web Apps (frontend)

## Cómo correr

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python run.py
# http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

## Estructura
- `backend/`
  - `app/` — App FastAPI: routers, models, schemas, auth, storage, middleware
  - `alembic/` — Migraciones de base de datos
  - `scripts/` — Scripts de seed y utilidades
  - `tests/` — Tests
- `frontend/`
  - `src/app/` — Componentes React, rutas, context
  - `src/lib/` — Utilidades compartidas
  - `src/__tests__/` — Tests frontend
- `docs/` — Documentacion adicional
