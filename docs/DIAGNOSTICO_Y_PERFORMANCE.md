# Diagnóstico de performance e incidentes — Playbook + Historial

Guía para diagnosticar "la app anda lenta" / incidentes de infra, y registro histórico
de los diagnósticos hechos. Pensado para reproducir el análisis sin tener que redescubrir
dónde vive cada cosa.

## 0. Mapa de la infra (prod)

| Recurso | Valor | Notas |
|---|---|---|
| Subscription | `Espert Azure Subscription` (`15900c96-4a2d-493b-ab12-912d521b3113`) | `az account show` |
| Resource Group | `Espert-Desarrollo` | (sí, prod vive en un RG llamado "Desarrollo") |
| Backend | App Service **`espert-trade-api`** (Docker, Linux) | imagen en ACR `espertapi`, puerto 8000 |
| App Service Plan | **`tm-api-plan`** | tier/SKU define CPU/RAM y autoscale |
| Base de datos | server **`trade-mkt-sql`** / db **`trademktdb`** | ⚠️ ver historial: estuvo en Basic 5 DTU |
| Frontend | Azure SWA `red-grass-0c483f30f.6.azurestaticapps.net` | deploy por push a `main` (paths `frontend/**`) |
| Fotos | Blob storage `espertphotos` (container `visit-photos`) | |
| Observabilidad | App Insights **`espert-trade-insights`** (workspace-based) | + Sentry (DSN vacío = inactivo) |

> ⚠️ **Prod NO está trackeado por Alembic** (`alembic_version` vacía). No correr
> `alembic upgrade` en prod; aplicar cambios de schema/índices con ALTER quirúrgico.

Hay un server viejo `trademarketing`/`trademarketingdb` (serverless) que **no se usa** —
candidato a borrar para no pagarlo. Confirmar antes.

## 1. Receta rápida de diagnóstico

```bash
SUB=15900c96-4a2d-493b-ab12-912d521b3113
RG=Espert-Desarrollo
APP=espert-trade-api
SRV=trade-mkt-sql; DB=trademktdb
APPID="/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP"
DBID="/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Sql/servers/$SRV/databases/$DB"
START=$(date -u -v-24H '+%Y-%m-%dT%H:%M:%SZ')   # macOS; en Linux: date -u -d '24 hours ago' ...
```

### 1a. Tier / capacidad (lo primero que hay que mirar)
```bash
# SKU del App Service Plan (B/S/P + workers + autoscale)
az appservice plan list -g $RG --query "[].{name:name,sku:sku.name,tier:sku.tier,workers:numberOfWorkers}" -o table

# Tier de la DB (Basic/Standard Sx/vCore + DTU/cap)
az sql db show -g $RG -s $SRV -n $DB --query "{sku:currentSku.name,tier:currentSku.tier,cap:currentSku.capacity}" -o json
```

### 1b. Métricas de plataforma (24h)
```bash
# App Service: tiempo de respuesta y códigos HTTP (NOTA: en Linux NO existe CpuPercentage;
# usar CpuTime/MemoryWorkingSet). Validar nombres con: az monitor metrics list-definitions --resource $APPID
az monitor metrics list --resource "$APPID" --metric HttpResponseTime MemoryWorkingSet \
  --interval PT1H --aggregation Average Maximum --start-time $START -o table
az monitor metrics list --resource "$APPID" --metric Requests Http5xx Http4xx \
  --interval PT24H --aggregation Total --start-time $START -o table

# SQL: saturación (lo clave es dtu_consumption_percent MAX; avg engaña)
az monitor metrics list --resource "$DBID" \
  --metric dtu_consumption_percent cpu_percent sessions_percent workers_percent storage_percent \
  --interval PT1H --aggregation Average Maximum --start-time $START -o table
```
**Umbrales / lectura:**
- `HttpResponseTime` p-max > ~5s → hay endpoints lentos. `Http5xx` > 0 → además se rompe.
- `dtu_consumption_percent` **MAX 100%** = la DB se satura (throttle) aunque el avg sea bajo.
- `MemoryWorkingSet` cerca del límite del plan o `Http5xx` por OOM → subir plan / bajar workers.
- Volumen bajo (`Requests`) + lentitud → es ineficiencia de queries, no carga.

### 1c. Logs del container
```bash
az webapp log download -n $APP -g $RG --log-file applogs.zip
unzip -o applogs.zip -d applogs
# docker logs (errores de arranque, stacktraces, reinicios):
ls applogs/LogFiles/*_default_docker.log
```
(`az webapp log tail` corre indefinido; en scripts usar `log download`. `timeout` no existe en macOS por defecto.)

### 1d. App Insights — es **workspace-based** (importante)
Los queries clásicos `az monitor app-insights query --app <appId>` **devuelven vacío**.
Hay que ir al Log Analytics workspace:
```bash
WS=$(az monitor app-insights component show --app espert-trade-insights -g $RG --query workspaceResourceId -o tsv)
CWID=$(az monitor log-analytics workspace show --ids "$WS" --query customerId -o tsv)

# Endpoints más lentos (si AppRequests está instrumentado):
az monitor log-analytics query -w "$CWID" --analytics-query \
  'AppRequests | where TimeGenerated>ago(7d) | summarize cnt=count(), p95=round(percentile(DurationMs,95),0), max_s=round(max(DurationMs)/1000,1) by Name | order by p95 desc | take 20' -o table

# Dependencias lentas (SQL / blob):
az monitor log-analytics query -w "$CWID" --analytics-query \
  'AppDependencies | where TimeGenerated>ago(7d) | summarize cnt=count(), p95=round(percentile(DurationMs,95),0), max_ms=round(max(DurationMs),0) by DependencyType, Target | order by p95 desc | take 15' -o table

# Qué tablas tienen datos / detectar ruido de logging:
az monitor log-analytics query -w "$CWID" --analytics-query \
  'union withsource=T * | where TimeGenerated>ago(24h) | summarize c=count() by T | order by c desc' -o table
az monitor log-analytics query -w "$CWID" --analytics-query \
  'AppTraces | where TimeGenerated>ago(24h) | summarize c=count() by msg=substring(Message,0,55) | order by c desc | take 12' -o table
```
**Señales de alarma de observabilidad:**
- `AppTraces` con cientos de miles/día dominadas por `Request URL`/`Transmission succeeded`
  → el SDK de Azure loguea en INFO y se auto-exporta (bucle). Silenciar (ver §2).
- No existe `AppRequests` → no hay instrumentación de requests; latencia por endpoint a ciegas.
- No hay dependencias SQL → SQLAlchemy/pyodbc no instrumentado.

### 1e. Código (causas raíz típicas)
- N+1: loops con `.first()`/`.scalar()`/acceso a relationships por iteración. Foco: `routers/reports.py`.
- Cargar tablas enteras y filtrar en Python (`.all()` sin `func.count`/JOIN/`group_by`).
- Índices faltantes en columnas de filtro (FKs, fechas `CreatedAt`).
- Pool en `app/database.py` (pool_size, pre_ping, recycle, connect timeout para Azure SQL).
- Frontend: polling/autosave por intervalo, refetch sin debounce, listas sin paginar.

## 2. Acciones correctivas frecuentes

```bash
# Escalar DB (online, sin downtime real). S0=10 / S1=20 / S2=50 / S3=100 DTU:
az sql db update -g $RG -s $SRV -n $DB --service-objective S2
# Bajar de nuevo si sobra capacidad: --service-objective S1 / Basic

# Escalar App Service Plan / agregar workers:
az appservice plan update -g $RG -n tm-api-plan --sku S1
az webapp config set -n $APP -g $RG --number-of-workers 2

# Forzar HTTPS:
az webapp update -n $APP -g $RG --set httpsOnly=true
```
- **Ruido de logs del SDK de Azure**: bajar a WARNING los loggers
  `azure.core.pipeline.policies.http_logging_policy`, `azure.monitor.opentelemetry.exporter`,
  `azure.identity`, `urllib3.connectionpool`. Implementado en
  `backend/app/middleware.py::_silence_azure_sdk_logs` (llamado desde `configure_logging`
  y desde `observability.init_app_insights` después de `configure_azure_monitor`).
- **Índices en prod**: ALTER quirúrgico (NO Alembic). Ej:
  `CREATE INDEX ix_pdv_createdat ON PDVs (CreatedAt);`

## 3. Historial de diagnósticos

### 2026-06-25 — "Usuarios reportan app lenta"
**Síntoma:** lentitud generalizada, sin caídas.

**Hallazgos:**
- App Service B2 Basic, 1 worker (RAM ~920MB/3.5GB ok, CPU baja). `httpsOnly=false`.
- **DB en Basic 5 DTU → pico 100% DTU** (throttle). Storage solo 64MB/2GB. ← cuello nº1.
- `HttpResponseTime` avg ~0.8s, **max 72.9s**; **0 errores 5xx**; ~2.900 req/24h (carga baja).
- **Monitoreo casi ciego y caro:** 233k AppTraces/día (~99% auto-ruido del exporter);
  no hay `AppRequests` ni SQL instrumentado; solo se ven blob uploads (max 10s). Sentry inactivo.
- **N+1 masivos en `reports.py`:** smart-alerts ~500 queries (`:952`), pdv-map ~500 (`:308`),
  territory-overview 28 (`:629`), route-analytics 50 (`:1269`); + endpoints que cargan tablas
  enteras y filtran en Python (vendor-ranking O(N²) `:132`, channel-coverage `:220`,
  perfect-store `:753`, trending `:890`). Índices faltantes: `PDV.CreatedAt`,
  `RoutePdvModel.RouteId/PdvId`, `VisitCoverage.CreatedAt`.
- **Frontend:** autosave POST cada 30s (`SurveyForm.tsx:317`), ~400 calls N+1 en cache offline
  (`Home.tsx:196`), `pdvsApi.list({})` sin paginar (`Home.tsx:107`), reloj 1s, visibilitychange sin debounce.

**Causa raíz:** reportes/dashboard disparan cientos de queries contra una DB de 5 DTU;
al saturarla (recurso compartido), todos los usuarios sienten la lentitud a la vez.

**Acciones aplicadas:**
- ✅ DB escalada **Basic 5 DTU → Standard S2 (50 DTU)** (online).
- ✅ Silenciado del ruido de logs del SDK de Azure (`_silence_azure_sdk_logs`).

**Pendiente (recomendado):**
- Índices faltantes (ALTER quirúrgico) + batch de los N+1 de `reports.py`.
- Instrumentar `AppRequests` + SQL en App Insights (dejar de estar ciegos).
- Quick wins frontend (autosave→debounce, paginar PDVs, N+1 del cache offline).
- Confirmar y borrar el server SQL viejo `trademarketing` si no se usa.
- `httpsOnly=true`.
