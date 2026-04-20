# Runbook Operativo — Trade Marketing App

Este documento describe los procedimientos operativos para mantener la app en producción durante el piloto y después.

**Audiencia:** admin del piloto + dev de guardia.

---

## Tabla de contenidos

1. [Backups y restore](#backups-y-restore)
2. [Disaster Recovery (DR)](#disaster-recovery-dr)
3. [Levantar la app desde cero](#levantar-la-app-desde-cero)
4. [Diagnosticar errores en producción](#diagnosticar-errores-en-producción)
5. [Tareas programadas (cron)](#tareas-programadas-cron)
6. [Troubleshooting común](#troubleshooting-común)

---

## Backups y restore

### Local (SQLite, dev)

**Hacer un backup ahora:**
```sh
cd backend
source .venv/bin/activate
USE_SQLITE=true python scripts/backup_db.py
```

Esto crea:
- `backend/backups/trade_marketing-YYYYMMDD-HHMMSS.db` — copia atómica de la DB
- `backend/backups/uploads-YYYYMMDD-HHMMSS.tar.gz` — copia de las fotos locales

**Listar backups disponibles:**
```sh
USE_SQLITE=true python scripts/restore_db.py --list
```

**Restaurar el backup más reciente:**
```sh
USE_SQLITE=true python scripts/restore_db.py --latest
```

Antes de restaurar, el script crea automáticamente un `prerestore` de la DB actual para que puedas volver atrás si te equivocás.

**Restaurar uno específico:**
```sh
USE_SQLITE=true python scripts/restore_db.py --file backups/trade_marketing-20260420-094500.db
```

**Limpiar backups viejos (mantiene los últimos 14 días):**
```sh
USE_SQLITE=true python scripts/backup_db.py --prune-days 14
```

---

### Azure SQL (producción)

Azure SQL Database tiene **Point-In-Time Restore (PITR)** activado por default:

| Tier | Retención PITR |
|---|---|
| Basic | 7 días |
| Standard / S0+ | 7-35 días (configurable) |
| Premium | 35 días |

**Esto significa:** si la DB de prod se corrompe, podemos restaurar a cualquier punto dentro de la ventana de retención sin tener que hacer backups manuales. Pero igual recomendamos:

1. **Snapshots manuales semanales** (en formato `.bacpac`) guardados en Azure Blob Storage para retener históricos más allá de los 7 días
2. **Probar el restore** al menos una vez antes del go-live

#### Hacer un export manual a `.bacpac`

```sh
az login

az sql db export \
  --resource-group Espert-Desarrollo \
  --server trade-mkt-sql \
  --name trademktdb \
  --admin-user <ADMIN_USER> \
  --admin-password '<ADMIN_PASSWORD>' \
  --storage-key <STORAGE_KEY> \
  --storage-key-type StorageAccessKey \
  --storage-uri https://espertdatabackups.blob.core.windows.net/backups/trademktdb-$(date +%Y%m%d).bacpac
```

#### Restaurar desde un punto en el tiempo (PITR)

```sh
az sql db restore \
  --resource-group Espert-Desarrollo \
  --server trade-mkt-sql \
  --name trademktdb \
  --dest-name trademktdb-restored \
  --time '2026-04-15T14:30:00'
```

Esto crea una **DB nueva** (`trademktdb-restored`) con los datos al timestamp indicado. Después, hay que:
1. Validar que los datos estén bien (conectarse con Azure Data Studio o similar)
2. Renombrar la DB original (`trademktdb` → `trademktdb-broken`) para conservarla por si acaso
3. Renombrar la restaurada (`trademktdb-restored` → `trademktdb`)
4. Reiniciar el backend

#### Importar un `.bacpac`

```sh
az sql db import \
  --resource-group Espert-Desarrollo \
  --server trade-mkt-sql \
  --name trademktdb-imported \
  --admin-user <ADMIN_USER> \
  --admin-password '<ADMIN_PASSWORD>' \
  --storage-key <STORAGE_KEY> \
  --storage-key-type StorageAccessKey \
  --storage-uri https://espertdatabackups.blob.core.windows.net/backups/trademktdb-20260420.bacpac
```

---

## Disaster Recovery (DR)

**Escenario A: corrupción de datos por bug en deploy**
1. Identificar timestamp aproximado del problema (mirar Sentry/logs)
2. PITR a un timestamp 5 minutos antes
3. Validar la DB restaurada
4. Renombrar y reiniciar
5. **RTO objetivo:** 30 minutos

**Escenario B: borrado accidental de datos por un usuario**
1. Si fue hace menos de 7 días → PITR
2. Si fue hace más → restaurar desde el último `.bacpac` semanal en Blob
3. Si los registros borrados son aislados (un PDV, una visita), considerar restaurar a una DB temporal e importar sólo las filas faltantes con un `INSERT INTO ... SELECT FROM`

**Escenario C: pérdida total del servidor de la app (no la DB)**
1. La DB de Azure SQL no está afectada (servicio gestionado independiente)
2. Hacer redeploy del backend siguiendo la sección "Levantar la app desde cero"
3. Frontend (Static Web App) tampoco se ve afectado, redeploy desde el repo
4. **RTO objetivo:** 1 hora

**Escenario D: pérdida de las fotos en Azure Blob**
1. Azure Blob Storage tiene **soft delete habilitable** (90 días). Verificar que esté activo.
2. Si está activo, restaurar via Azure Portal en el container `visit-photos`.
3. Si NO está activo, las fotos se pierden definitivamente. En ese caso, los registros de `VisitPhoto` en la DB quedan apuntando a blobs inexistentes — el frontend muestra placeholder roto.

---

## Levantar la app desde cero

### Backend

```sh
git clone https://github.com/<owner>/trade-marketing-app.git
cd trade-marketing-app/backend

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configurar variables de entorno
cp .env.example .env
# Editar .env con las credenciales reales

# Aplicar migraciones
alembic upgrade head

# Crear el primer usuario admin (interactivo)
python scripts/seed_demo.py   # o un script propio para seed mínimo

# Levantar
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Frontend

```sh
cd frontend
npm install
npm run build

# Servir el dist/ con cualquier static host (Static Web App, nginx, etc)
```

### Variables de entorno críticas (prod)

```env
# Backend
DATABASE_USER=<azure-sql-user>
DATABASE_PASSWORD=<azure-sql-password>
DATABASE_SERVER=trade-mkt-sql.database.windows.net
DATABASE_NAME=trademktdb
JWT_SECRET_KEY=<random-256-bit-secret>     # NUNCA usar el default
AZURE_STORAGE_CONNECTION_STRING=<...>
AZURE_STORAGE_CONTAINER=visit-photos
PUBLIC_BASE_URL=https://api.espert-app.com

# Frontend (build time)
VITE_API_URL=https://api.espert-app.com
VITE_GOOGLE_MAPS_API_KEY=<...>
```

---

## Diagnosticar errores en producción

Cuando un usuario reporta un problema, pedile el **request_id** que aparece en el toast (ej "cod: a1b2c3d4"). Después:

```sh
# En el server donde corre el backend
ssh <server>
grep "rid=a1b2c3d4" /var/log/espert-backend.log
```

Vas a ver el stack trace completo de la excepción que generó el error. Cada request entrante recibe un ID único que se loggea en cada línea de log y también se devuelve en el header `X-Request-ID`.

---

## Tareas programadas (cron)

### Backup diario a las 03:00

```cron
0 3 * * * cd /opt/espert/backend && /opt/espert/backend/.venv/bin/python scripts/backup_db.py --prune-days 14 >> /var/log/espert-backup.log 2>&1
```

### Snapshot semanal a Azure Blob (domingos a las 04:00)

```cron
0 4 * * 0 /opt/espert/scripts/azure-bacpac-export.sh >> /var/log/espert-bacpac.log 2>&1
```

(El script `azure-bacpac-export.sh` debería tener el comando `az sql db export` parametrizado con vars de entorno.)

---

## Troubleshooting común

### Backend no arranca: "ImportError: No module named X"

```sh
cd backend
source .venv/bin/activate
pip install -r requirements.txt
```

### Backend arranca pero todas las rutas devuelven 401

→ El JWT_SECRET_KEY cambió entre reinicios. Los tokens viejos quedaron inválidos. Los users tienen que re-loguearse. Es normal después de un deploy.

### Backend devuelve 500 al hacer login

→ Tipico cuando la migración de schema no se aplicó. Verificar:
```sh
alembic current  # debe mostrar la última revisión, no "None"
alembic upgrade head
```

### Las fotos no aparecen en el frontend

1. Si es prod (Azure Blob): verificar que las URLs del response tengan el SAS token. Si no lo tienen, falta `AZURE_STORAGE_CONNECTION_STRING` o tiene mal formato.
2. Si es local (filesystem fallback): verificar que `./uploads/` existe y que el server tiene permisos de escritura.

### Un user dice "tengo que cambiar la contraseña pero el modal no aparece"

→ Verificar que el flag `MustChangePassword` esté en `true` para ese user. Si está en `false`, el modal nunca se abre.
```sql
UPDATE [User] SET MustChangePassword = 1 WHERE Email = 'usuario@espert.com';
```

### Olvidé la contraseña de un usuario

```python
# Desde el shell de Python con el venv activo
from app.database import SessionLocal
from app.models import User
import bcrypt

db = SessionLocal()
u = db.query(User).filter(User.Email == "usuario@espert.com").first()
u.PasswordHash = bcrypt.hashpw(b"NuevaPassword123!", bcrypt.gensalt()).decode()
u.MustChangePassword = True   # forzar cambio en el próximo login
db.commit()
```

---

## Histórico de incidentes

Mantener acá una lista de incidentes resueltos (fecha, qué pasó, cómo se resolvió, lección):

| Fecha | Incidente | Resolución | Lección |
|---|---|---|---|
| _ej. 2026-05-03_ | _Backend down 20 min_ | _Reinició uvicorn_ | _Revisar memory leak_ |
| | | | |
