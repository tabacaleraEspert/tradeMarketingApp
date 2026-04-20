# Deploy a Azure — Trade Marketing App

> **Target:** 28 mayo 2026
> **Infra existente:** App Service B1 + Static Web App + Azure SQL + ACR

---

## Prerequisitos

- [ ] Azure CLI instalado (`az --version`)
- [ ] Docker instalado (`docker --version`)
- [ ] Node.js 18+ (`node --version`)
- [ ] Acceso al Azure Container Registry (`espertapi.azurecr.io`)
- [ ] Acceso al Azure SQL Server (`trade-mkt-sql.database.windows.net`)

---

## Paso 1 — Generar JWT Secret (una sola vez)

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
# Copiar el output. NO commitear.
```

---

## Paso 2 — Configurar Application Settings en Azure App Service

Portal Azure → App Service (`espert-trade-api`) → Configuration → Application Settings:

| Setting | Valor |
|---|---|
| `DATABASE_SERVER` | `trade-mkt-sql.database.windows.net` |
| `DATABASE_NAME` | `trademktdb` |
| `DATABASE_USER` | `<tu_usuario>` |
| `DATABASE_PASSWORD` | `<tu_contraseña>` |
| `JWT_SECRET_KEY` | `<el hex de 32 bytes del paso 1>` |
| `JWT_ALGORITHM` | `HS256` |
| `JWT_EXPIRE_MINUTES` | `480` |
| `JWT_REFRESH_EXPIRE_MINUTES` | `10080` |
| `AZURE_STORAGE_CONNECTION_STRING` | `<connection string del Storage Account>` |
| `AZURE_STORAGE_CONTAINER` | `visit-photos` |
| `PUBLIC_BASE_URL` | `https://espert-trade-api.azurewebsites.net` |
| `SENTRY_DSN` | `<opcional — dejar vacío si no se usa>` |
| `SENTRY_ENVIRONMENT` | `production` |
| `APP_RELEASE` | `v1.0.0` |

**No setear `USE_SQLITE`** (debe usar Azure SQL en prod).

---

## Paso 3 — Azure Blob Storage (fotos)

Si todavía no tenés el container:

```bash
# Crear Storage Account (si no existe)
az storage account create \
  --name espertphotos \
  --resource-group Espert-Desarrollo \
  --location eastus \
  --sku Standard_LRS

# Crear container
az storage container create \
  --account-name espertphotos \
  --name visit-photos

# Habilitar soft-delete (90 días, para DR)
az storage blob service-properties delete-policy update \
  --account-name espertphotos \
  --enable true \
  --days-retained 90

# Obtener connection string
az storage account show-connection-string \
  --name espertphotos \
  --resource-group Espert-Desarrollo \
  --output tsv
# → Copiar al Application Setting AZURE_STORAGE_CONNECTION_STRING
```

---

## Paso 4 — Build + Push Docker (Backend)

```bash
cd backend

# Login al ACR
az acr login --name espertapi

# Build
docker build -t espertapi.azurecr.io/trade-marketing-api:latest .
docker build -t espertapi.azurecr.io/trade-marketing-api:v1.0.0 .

# Push
docker push espertapi.azurecr.io/trade-marketing-api:latest
docker push espertapi.azurecr.io/trade-marketing-api:v1.0.0

# Reiniciar el App Service para que tome la nueva imagen
az webapp restart \
  --name espert-trade-api \
  --resource-group Espert-Desarrollo
```

**El container va a:**
1. Correr `alembic upgrade head` (migraciones)
2. Levantar Gunicorn con 2 workers

**Verificar que arrancó:**
```bash
curl https://espert-trade-api.azurewebsites.net/health
# → {"status":"ok"}

curl https://espert-trade-api.azurewebsites.net/
# → {"message":"Trade Marketing API","docs":"/docs"}
```

---

## Paso 5 — Build + Deploy Frontend (Static Web App)

```bash
cd frontend

# Build de producción (usa .env.production)
npm ci
npm run build

# El output queda en dist/
# staticwebapp.config.json se incluye automáticamente
```

### Opción A — Deploy manual vía Azure CLI

```bash
# Instalar SWA CLI si no lo tenés
npm install -g @azure/static-web-apps-cli

# Deploy
swa deploy ./dist \
  --deployment-token <TU_DEPLOYMENT_TOKEN> \
  --env production
```

### Opción B — Deploy vía Azure Portal

1. Portal Azure → Static Web App → Deployment
2. Si está conectado a GitHub, push a `main` dispara el deploy automático
3. Si no, subir manualmente `dist/` como ZIP deployment

### Opción C — Deploy vía GitHub Actions

Si tenés el repo en GitHub:
```bash
git add -A
git commit -m "Deploy v1.0.0"
git push origin main
```
Si el Static Web App está conectado al repo, se deploya solo.

**Verificar:**
```
https://red-grass-0c483f30f.6.azurestaticapps.net
# → Debería mostrar la pantalla de login
```

---

## Paso 6 — Cargar usuarios reales

```bash
# Desde tu máquina local (con acceso a la DB de Azure)
cd backend
source venv/bin/activate

# Apuntar a Azure SQL (quitar USE_SQLITE)
export DATABASE_USER=<tu_usuario>
export DATABASE_PASSWORD=<tu_contraseña>

# Cargar usuarios
python seed_real_users.py

# Cargar feriados 2026 (opcional)
# python seed_holidays_2026.py
```

---

## Paso 7 — Smoke test post-deploy

- [ ] `curl https://espert-trade-api.azurewebsites.net/health` → `{"status":"ok"}`
- [ ] Login en el frontend como admin (`juampi@espert.com.ar`)
- [ ] Modal de cambio de contraseña aparece
- [ ] Cambiar contraseña → entra al dashboard admin
- [ ] Ver lista de usuarios (debe haber 58)
- [ ] Login como TM Rep → ver Home
- [ ] Crear una visita (check-in + survey + close)
- [ ] Subir una foto → verificar que se guarda en Azure Blob
- [ ] Ver reportes → deben mostrar datos

---

## Paso 8 — Comunicación a los usuarios

Mandar a los 6 usuarios del piloto:

```
Hola [Nombre],

Ya podés acceder a la app de Trade Marketing:

📱 https://red-grass-0c483f30f.6.azurestaticapps.net

Tu usuario: [email]
Tu contraseña temporal: Espert2026!

Al primer ingreso te va a pedir que cambies la contraseña.

Cualquier problema → avisame por [canal].
```

---

## Rollback

Si algo sale mal:

**Backend:** volver a la imagen anterior
```bash
docker pull espertapi.azurecr.io/trade-marketing-api:v-anterior
docker tag espertapi.azurecr.io/trade-marketing-api:v-anterior espertapi.azurecr.io/trade-marketing-api:latest
docker push espertapi.azurecr.io/trade-marketing-api:latest
az webapp restart --name espert-trade-api --resource-group Espert-Desarrollo
```

**DB:** Point-In-Time Restore (ver RUNBOOK.md)

**Frontend:** re-deploy el dist/ anterior (o revert en GitHub si está conectado)

---

## Post-deploy monitoring

- [ ] Verificar logs del App Service: Portal → App Service → Log stream
- [ ] Si Sentry está activo: verificar que no haya errores nuevos
- [ ] Verificar que Azure Blob Storage tiene las fotos subidas
- [ ] Verificar backup automático de Azure SQL (PITR activo)

---

## Checklist resumen

- [ ] JWT Secret generado y configurado
- [ ] Application Settings completos en App Service
- [ ] Azure Blob Storage creado y connection string configurada
- [ ] Docker image built, tagged y pushed
- [ ] App Service reiniciado y health check OK
- [ ] Frontend built con .env.production
- [ ] Static Web App deployada
- [ ] SPA routing funciona (navegar a /admin, refrescar → no 404)
- [ ] Usuarios cargados en Azure SQL
- [ ] Smoke test pasado (login + visita + foto)
- [ ] Comunicación enviada a los 6 usuarios
