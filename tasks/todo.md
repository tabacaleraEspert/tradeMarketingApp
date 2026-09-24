# Reporte automático por mail — comportamiento de los trades

> Plan anterior (pestaña Comportamiento, commit 77af4f1) está en el historial de git.

## Contexto (de la exploración)
- `services/behavior.py::build_behavior(db, user_id, from, to)` → `{resumen, alertas[tipo, severidad, fecha, detalle], dias[]}` por UN trade (~5 queries). Tope 92 días → mes entra.
- Trades = usuarios activos con rol `vendedor` (mismo criterio que `services/intelligence.py:483`).
- `Holiday(Date, IsActive)` existe → sirve para "último día hábil".
- Backend: gunicorn con N workers → un scheduler in-process dispararía N veces (Strix lo resuelve con índice único; acá igual).
- Front: `/sso` ya es ruta top-level sin guard → `/r/:token` va igual. SWA `navigationFallback` ya cubre deep links.
- `ComportamientoTab` mezcla fetch (useBehavior + RangeFilter) con vista → hay que separar la vista para reusarla en la página pública.
- **Strix (modelo)**: `@azure/communication-email`, env `AZURE_COMMUNICATION_CONNECTION_STRING` + `AZURE_EMAIL_FROM`; cron in-process lun 07:00 AR + diario 07:30 que solo envía el último día hábil; tabla `generated_reports` (token `randomBytes(32)` hex 64, payload snapshot jsonb, `expires_at` 30 d, índice único por período excluyendo `test`); `GET /public/reports/:token` → 404 si no existe / 410 si venció, throttle 20/min; destinatarios en tabla `report_subscriptions` con ABM admin; "Resumen de prueba" = envío test repetible.
- ACS en la suscripción: `espertcommservice` + `espertemailservice` (**dominio propio tabacaleraespert.com**, rg-espert), además de acs-facturacion-prod / acs-espert-gastos-prod.

## Diseño propuesto

### Datos (1 tabla nueva, DDL por hotfix + migración 0024)
`BehaviorReport`: `ReportId`, `Token CHAR(64) UNIQUE` (`secrets.token_hex(32)`), `Kind` (weekly|monthly|test), `PeriodFrom`, `PeriodTo`, `Payload NVARCHAR(MAX)` (snapshot JSON del resumen por trade + anomalías), `Recipients NVARCHAR(1000)`, `SentAt`, `SendError`, `CreatedAt`, `ExpiresAt` (+30 d). Índice único filtrado `(Kind, PeriodFrom) WHERE Kind <> 'test'` = idempotencia (un solo envío por período aunque el cron corra 2 veces).

### Backend
- [x] `services/behavior_report.py`:
  - `build_team_report(db, from, to)`: itera trades → `build_behavior` por cada uno (N×5 queries, OK para un job; sin cache HTTP). Por trade: resumen compacto (días, visitas, PDVs/día, plan %, GPS %, fuera perímetro, ON/OFF prom, km línea, conteo de alertas por tipo, score = Σ severidad).
  - KPIs del equipo (tiles): trades activos / con actividad, visitas, PDVs/día prom, cumplimiento plan %, visitas con GPS %, fuera de perímetro, días con plan sin visitas.
  - `anomalias_destacadas`: top 5 (trade + tipo + dato), orden por severidad × cantidad; ej. "Juan Pérez · Plan sin visitas · 3 días".
  - Períodos: `last_closed_week(today)` (lun-dom anterior), `month_to_date(today)` (1° al día de hoy), `is_last_business_day(db, today)` (lun-vie, no `Holiday` activo, y ningún día hábil más en el mes).
- [x] `services/mailer.py`: `azure-communication-email` (nuevo en requirements). Env `ACS_CONNECTION_STRING`, `ACS_EMAIL_FROM`, `BEHAVIOR_REPORT_TO` (lista con coma), `PUBLIC_APP_URL` (base del link). Sin conn string → loguea el mail (modo dev, como Strix).
- [x] `services/behavior_report_mail.py`: HTML con tablas + estilos inline (compatible Outlook/Gmail), sin dependencias (f-string + `html.escape`). Asunto: "Resumen semanal de comportamiento — lunes 14 al domingo 20 de septiembre de 2026" / "Resumen mensual … — septiembre 2026" / prefijo "de prueba".
- [x] `routers/public_reports.py` (sin `get_current_user`, excepción explícita comentada en `main.py`):
  - `GET /public/reports/{token}` → `{kind, from, to, expiresAt, kpis, anomalias, trades[]}`; regex `^[a-f0-9]{64}$`; 404 inexistente / 410 vencido.
  - `GET /public/reports/{token}/trades/{user_id}` → `build_behavior` del rango del reporte, solo si `user_id` está en el snapshot (si no 404). Cache TTL 10 min.
  - Rate limit simple en memoria por IP (30 req/min) — no hay slowapi y no vale sumar dep.
- [x] `routers/behavior_reports.py`:
  - `POST /internal/behavior-reports/run` con header `X-Cron-Key` (= `CRON_SECRET`, comparación constante; vacío → 503). Decide solo: lunes → weekly; último día hábil → monthly; ambos o ninguno. Idempotente por índice único.
  - Admin: `POST /behavior-reports/test {to?, kind}` (envía "de prueba" sin idempotencia) y `GET /behavior-reports/preview?kind` (devuelve el HTML del mail para ver en el navegador).
- [x] Tests: períodos (semana cerrada, último hábil con feriado y fin de semana), ranking anomalías, token 404/410/formato, trade fuera del snapshot 404, cron key inválida 401, idempotencia (2 corridas = 1 envío), mailer en modo dev.

### Scheduler
- [x] `.github/workflows/behavior-report.yml`: `schedule: cron '0 10 * * 1-5'` (07:00 AR) + `workflow_dispatch` → `curl -X POST .../internal/behavior-reports/run -H "X-Cron-Key: ${{ secrets.CRON_SECRET }}"`. El backend decide qué toca; el cron es tonto. (GH puede demorar el cron minutos; irrelevante acá.)

### Frontend
- [x] Refactor: extraer de `ComportamientoTab` una vista `ComportamientoView({data, userId, …})` sin fetch ni RangeFilter; la pestaña admin la sigue usando igual (sin cambios visibles).
- [x] `pages/public-report/PublicReportPage.tsx` en `/r/:token` (top-level, sin guard, `fetch` directo sin auth ni cola offline):
  - Header con período + "vence el …"; tiles KPIs; anomalías; tabla por trade (ordenable, semáforo por columna, conteo de alertas). Click → `/r/:token/t/:userId` con `ComportamientoView` (tiles, alertas, días, mapa).
  - Estados: cargando, 404 "link inválido", 410 "este reporte venció".
  - `publicReportsApi` + tipos.
- [x] `staticwebapp.config.json`: nada (fallback ya cubre). Header `X-Robots-Tag: noindex` en la página pública (meta robots).

### Infra / deploy
- [x] `backend/scripts/hotfix_behavior_report_prod_2026MMDD.py` (idempotente, patrón `hotfix_product_brand_prod_20260923.py`) → correr en prod **antes** del deploy backend.
- [x] App settings en `espert-trade-api`: `ACS_CONNECTION_STRING`, `ACS_EMAIL_FROM`, `BEHAVIOR_REPORT_TO`, `PUBLIC_APP_URL`, `CRON_SECRET`. Secret de GH `CRON_SECRET`.
- [x] Registrar uso de ACS en `infraestructura/` (sin recurso nuevo si se reusa).

## Verificación
- [x] pytest + vitest + build.
- [x] Local SQLite: seed de 2-3 trades con alertas (reusar `scratchpad/seed_behavior.py`), `preview` del HTML (screenshot), `run` en modo dev → token → Playwright: `/r/<token>` (tiles, anomalías, tabla, click trade → detalle con mapa fallback), token inválido → 404, vencido → 410, sin sesión logueada.
- [x] Prod: después del deploy, `POST /behavior-reports/test` a tu mail → revisar en Gmail/Outlook mobile + abrir link desde el celular.
- [x] Commit + push (hotfix DDL primero).

## Decisiones (2026-09-24)
1. **Destinatarios** en tabla `BehaviorReportSubscription` con ABM admin (`/admin/mail-reports`): email, nombre, semanal/mensual on/off, activo.
2. **Qué trades recibe cada uno**: alcance `all` | `team` (sub-árbol vivo de un jefe; entra gente nueva sola) | `custom` (lista elegida). **Auto-alta**: cada usuario activo con subordinados vendedores obtiene una suscripción `team` precargada (su email) — se crea **desactivada** para no mandar mails sin revisión; se activan desde el ABM.
3. **ACS**: reuso `espertcommservice` / `espertemailservice` (dominio tabacaleraespert.com).
4. **Mensual**: el **1° del mes siguiente**, mes cerrado → sin lógica de día hábil.
5. **07:00 AR** (cron GH `0 10 * * *`: lunes → semanal, día 1 → mensual).
6. Página pública **con mapa**.
7. **Token por destinatario** (cada uno recibe trades distintos). Tabla `BehaviorReport` con `SubscriptionId`; único `(SubscriptionId, Kind, PeriodFrom)` salvo `test`.
8. **Trades sin actividad** (0 visitas y 0 planificados) se ocultan.

## Resultado (2026-09-24)
- Backend: 580 pytest OK (18 nuevos en `tests/test_behavior_report.py`). Migración 0024 aplicada sobre SQLite desde 0023.
- Frontend: vitest 133 OK + build OK. (Sin typecheck: el repo no tiene tsconfig ni @types/react.)
- E2E Playwright local (SQLite): 32/32 — ABM (auto-alta jefe, toggle, alta custom, preview, prueba, historial), cron (401/202/no duplica/solo activos), público mobile+desktop sin login (oculta trade sin actividad, sin scroll horizontal, sin links a /admin), 404/410, render del mail.
- Review de seguridad (subagente): XFF → última IP; ruta `/admin/mail-reports` bajo `AdminOnlyGuard`. Resto OK (hmac, escape HTML, IDOR del detalle, idempotencia).
- **ACS**: dominio `tabacaleraespert.com` cargado en `espertemailservice` pero SIN verificar (DNS NotStarted) → remitente = `DoNotReply@0ba433de-….azurecomm.net`, display name compartido "Portal Alta Clientes · Espert".

## Pendiente go-live (prod)
- [ ] `python scripts/hotfix_behavior_report_prod_20260924.py` (creds de prod por env).
- [ ] App settings `espert-trade-api`: `ACS_CONNECTION_STRING` (espertcommservice), `PUBLIC_APP_URL=https://red-grass-0c483f30f.6.azurestaticapps.net`, `CRON_SECRET`.
- [ ] Secret GitHub `CRON_SECRET` (mismo valor).
- [ ] Activar destinatarios en /admin/mail-reports + "Enviar prueba" a davor@.
