# Incidente: visitas "huérfanas" — la ruta no avanza (1/39)

**Fecha:** 2026-07-06 · **Reporta:** Davor (impersonando a Cecilia Risso)

## Síntoma
La app del TMR mostraba `1/39` ("1 hechas, 1 en curso, 37 faltan") en la ruta de
hoy, pero en Auditoría figuraban ~29 visitas hechas por Cecilia ese día, varias en
PDVs de esa misma ruta.

## Causa raíz
El contador de la ruta (`hechas / en curso / faltan`) NO se calcula desde las
visitas reales: se calcula desde `RouteDayPdv.ExecutionStatus` (estado por PDV del
día). Ese estado solo se actualiza cuando la visita se crea/cierra **con un
`RouteDayId`**:

- `POST /visits` → si `RouteDayId` presente y el `RouteDayPdv` está `PENDING` → `IN_PROGRESS`.
- cerrar visita → `RouteDayPdv` → `DONE`.

El **frontend pasaba el `RouteDayId` únicamente por el navigation state** de React
(`location.state`) en `CheckIn.tsx`. Ese estado se pierde en varios caminos
habituales: buscar PDV, "kiosco cercano", recargar la página, o al **sincronizar
visitas creadas offline**. Cuando se perdía, la visita se guardaba con
`RouteDayId = NULL` → quedaba desligada de la ruta y el progreso no avanzaba,
aunque la visita existiera (por eso aparecía en Auditoría).

## Impacto medido (prod)
Visitas con `RouteDayId NULL` cuyo PDV SÍ estaba en la ruta de ese día del usuario
("huérfanas recuperables"):

- **107 visitas** en **8 TMR**, desde **2026-05-08** hasta **2026-07-06**.
- **91 PDV** figuraban "faltan" estando efectivamente visitados.
- Cecilia (03-jul): 20 visitas huérfanas → ruta pasó de ~1/39 a **29/47**.

Top afectados: Alejandro Alzieu (24), Sergio Loyola (24), Cecilia Risso (22),
Matias Avila (13), German Jaurechi (10), Claudio Pagani (5), Sebastian Morales (4),
Maria Sol Allevato (1).

## Fix de código (evita nuevas huérfanas)
`backend/app/routers/visits.py`:

- Nueva helper `_resolve_route_day_id(user_id, pdv_id, db)`: busca la ruta de HOY
  del usuario que contenga ese PDV.
- `create_visit`: si la visita llega **sin `RouteDayId`**, lo auto-resuelve y lo
  ata antes de marcar `IN_PROGRESS`.
- `_update_route_day_pdv_status` (al cerrar): si sigue sin `RouteDayId`, lo resuelve
  para que igual cuente en el progreso.

Esto es un fix de un solo punto en el server: cubre todos los caminos frágiles del
front **y** las visitas offline (pasan por el mismo `POST /visits` al sincronizar).
Tests: `test_visits.py`, `test_visit_steps.py`, `test_routes.py` → 94 passed.

> Nota: el front sigue pasando `RouteDayId` por navigation state (optimista); el
> server es la fuente de verdad al refetch. Endurecer el front (detectar el
> routeDay en `CheckIn.tsx`) queda como mejora opcional, no imprescindible.

## Backfill de datos históricos
`backend/scripts/backfill_orphan_visit_routedays.py` — DRY-RUN por defecto,
`APPLY=1` para aplicar. Hace **backup JSON** antes (rollback).

- Ata cada visita huérfana recuperable a su `RouteDay` (MIN si hay varias ese día).
- Marca el `RouteDayPdv` como `DONE` (visita cerrada) o `IN_PROGRESS` (abierta),
  **sin degradar** un `DONE` existente.

Aplicado 2026-07-06: **107 visitas atadas, 91 RouteDayPdv → DONE**. Verificación
post: 0 huérfanas recuperables restantes.

Backup: `backend/scripts/backup_backfill_orphan_visits_YYYYMMDD_HHMMSS.json`.
Rollback: volver `Visit.RouteDayId` a NULL y `RouteDayPdv.ExecutionStatus` al valor
`routedaypdv_before` del JSON.

## Deploy (CI/CD) — cómo se publica el backend
Definido en `.github/workflows/`:

- **`deploy-backend.yml`** — trigger: `push` a `main` que toque `backend/**` (o
  `workflow_dispatch` manual). Pasos:
  1. Login a Azure (`secrets.AZURE_CREDENTIALS`).
  2. Build de la imagen Docker (`backend/Dockerfile`) y push a ACR **`espertapi`**
     (`trade-marketing-api:<sha>` y `:latest`).
  3. `az webapp config container set` sobre el App Service **`espert-trade-api`**
     (RG **`Espert-Desarrollo`**) apuntando al tag `<sha>`.
  4. Espera 30s y health-check `GET https://espert-trade-api.azurewebsites.net/health`
     (falla el job si != 200).
- **`ci.yml`** — en cada push/PR a `main`: pytest backend (SQLite) + build/test
  frontend. `deploy-backend` NO depende de `ci` (`needs: []`), corren en paralelo.
- **`deploy-frontend.yml`** — deploy del PWA a Azure Static Web Apps (separado).

**Para deployar este fix:** `git push` de los cambios de `backend/**` a `main` →
dispara `deploy-backend` automáticamente. Seguir el run en GitHub Actions y
confirmar el health-check en verde.
