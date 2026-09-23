# Mi gestión TMR Mobile — drill KPI → Rutas → PDVs

## Decisiones (2026-09-23)
- Drill de 3 niveles: KPIs → rutas rankeadas por ese KPI → PDVs de la ruta ordenados por oportunidad de mejora.
- Completitud del censo **aparte** (card propia debajo de los KPIs, con el mismo drill).
- Tocar PDV → **ficha del PDV** (`/pos/:id`).
- **Reemplaza** el botón "Mi gestión TMR" del Home para vendedores. La página de escritorio (`/tablero-tmr`) queda para admin/TM.

## Datos
- Nivel 1 (KPIs oficiales del variable): `GET /kpi/variable` (ya lo usa Mis objetivos: 5 KPIs con actual/meta/peso).
- Nivel 2 y 3: `GET /kpi/tmr/routes?user_id=me&with_products=false` + `GET /kpi/tmr/pdvs?user_id=me` (ya abiertos a vendedores, cache 10 min por scope).
- Faltan por PDV (hoy solo agregados por ruta): `route_id`, `planned` (en RouteDay del mes), `canje`, `promo`, `material`, `sells_loose`. Todo ya está en `ctx` (`planned_by_route`, `actions_by_pdv`, `pdvs_with_material`, `pdv_by_id.SellsLooseCigarettes`) → cero queries nuevas.

## Ranking por KPI (misma fórmula que la ruta del tablero)
| KPI | Ruta (peor primero) | PDV (mayor oportunidad primero) |
|---|---|---|
| cobertura_skus | `buenos/relevados` | Regular con `gaps` 1 → 2 → resto no bueno → sin relevar (`score` null) |
| efectividad_visitas | `vis_plan/planned_mes` | planificado y `vis`=0 → visitado sin acción (`ha` false) |
| penetracion_sueltos | `con_canje/vende_sueltos` | `sells_loose` y sin `canje` |
| pop_colocado | `con_material/pdvs` (aprox.: el motor exige además nivel de comunicación bueno+) | sin `material` |
| activaciones_promo | `con_promo/pdvs` | sin `promo` |
| censo (aparte) | `completitud` | `comp` ascendente, muestra `sin_dato` Espert |
Cada nivel muestra "faltan N PDVs para la meta" = ceil(meta·den) − num.

## Backend (`app/services/tmr_dashboard.py` + tests)
- [x] `build_routes`: agregar `route_id`.
- [x] `build_pdvs`: agregar `route_id`, `planned`, `canje`, `promo`, `material`, `sells_loose` por PDV (bools).
- [x] Tests: banderas por PDV coherentes con los agregados de la ruta.

## Frontend
- [x] `src/app/pages/mi-gestion/`: `MiGestionPage` (`/mi-gestion`), `MiGestionRutasPage` (`/mi-gestion/:kpi`), `MiGestionPdvsPage` (`/mi-gestion/:kpi/ruta/:routeId`). Mobile-first, header con volver + breadcrumb, barra inferior de la app.
- [x] `mi-gestion-utils.ts`: definición de los 6 drills (label, fórmula ruta, orden PDV, texto "por qué" por PDV), + vitest.
- [x] Hook `useMiGestionData`: `/kpi/variable` (mes actual) + tmr routes/pdvs con `fetchWithCache` (funciona offline con lo último visto).
- [x] Nivel 1: 5 cards (actual/meta/peso, ring del variable arriba reusando `VariableRing`/`KpiCard` de tablero) + card Censo aparte. Selector de mes (actual / anterior) como en Mis objetivos.
- [x] Nivel 2: lista de rutas con barra %, num/den, "faltan N", chevron.
- [x] Nivel 3: lista de PDVs con motivo ("Regular · le falta Milenio Gold", "Planificado, sin visitar", "Vende sueltos, sin canje"), badge de estado, tap → `/pos/:id`.
- [x] `Home.tsx`: botón "Mi gestión TMR" → `/mi-gestion` para no-admin. `routes.tsx`: rutas nuevas dentro del layout con barra inferior.

## Verificación
- [x] pytest + vitest + build.
- [x] Playwright local (SQLite): drill completo con datos sembrados por KPI, orden de PDVs correcto, link a ficha, 390px sin scroll horizontal.
- [x] Deploy: push (backend + frontend; sin DDL).

## Preguntas abiertas
1. POP: usar "material colocado" (dato del tablero) aunque el KPI oficial exija además comunicación buena+. OK como aproximación?
2. Selector de mes (actual/anterior) sí o no? default: sí.

## Review (2026-09-23)
- Backend: `route_id` + banderas por PDV (planned/canje/promo/material/sells_loose) en `build_pdvs`; `route_id` en rutas. 1 test nuevo (537 total).
- Frontend: `pages/mi-gestion/` (3 páginas + utils + hook + UI), rutas en el Layout con barra inferior, Home → `/mi-gestion`. 24 tests utils (104 total). Nivel 1 usa la fila oficial del variable; cobertura por ruta = buenos/pdvs (alineado al KPI 1).
- E2E Playwright (SQLite local, 390px): 22/22 — banderas API, 3 niveles, orden por KPI (cobertura/efectividad/sueltos/censo/promo), tap → ficha, sin scroll horizontal.
- Nota: POP usa "material colocado" (aprox.); efectividad muestra planificados visitados con nota sobre el KPI oficial.
