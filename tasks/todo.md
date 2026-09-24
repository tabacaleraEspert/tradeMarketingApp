# Inteligencia › TM REP › pestaña "Comportamiento" (auditoría del trade)

## Contexto (de la exploración)
- El drill Inteligencia es solo-admin; `TradePage` no tiene tabs (cards apiladas) y su `PeriodFilter` es estado local (chips mes/mes ant/3m/todo/custom → year/month + date_from/to).
- GPS existe en `VisitCheck` (Ts, Lat, Lon, AccuracyMeters, DistanceToPdvM, BatteryPct, DeviceId) pero `/audit/user-timeline` lo serializa en un string. `/kpi/weekly-activity` agrupa por día pero solo por mes y con `Visit.OpenedAt`, sin GPS. Ningún endpoint devuelve checks de un usuario por rango, ni km.
- Único haversine: privado en `routers/route_generator.py`. Patrón polyline + markers numerados: inline en `RouteFocoPage.tsx` (Google Maps, loader `google-map-script-places`).
- `ActividadDayRow` (tablero) ya tiene la fila "ON – OFF · PDVs" por día. `AuditTimeline` tiene el agrupado día → visita.
- Planificado por día: `RouteDay(WorkDate, AssignedUserId)` + `RouteDayPdv(PlannedOrder)`, con índice, sin endpoint por rango.

## Backend
- [x] `app/utils/geo.py`: `haversine_km` (mover desde route_generator, que pasa a importarlo).
- [x] `app/services/behavior.py::build_behavior(db, user_id, date_from, date_to)`:
  - Rango AR inclusive → UTC (`resolve_periodo` de tmr_dashboard). Visitas del usuario en rango + checks (join) + PDV (nombre/lat/lon) + RouteDay/RouteDayPdv del usuario en rango. 3-4 queries, sin N+1.
  - Puntos GPS: checks IN/OUT ordenados por Ts; descartar precisión > 500 m y saltos > 80 km entre puntos consecutivos (outlier); fotos con `File.Lat/Lon/TakenAt` como puntos extra tipo `photo` (densifican la traza).
  - **Por día (fecha AR)**: `on` = primer check-in (fallback: primer OpenedAt, marcado `onSource: "visit"`), `off` = último check-out (fallback último ClosedAt), `activeMin`, `visits`, `pdvs` (distintos), `planned`, `plannedVisited`, `km` (suma haversine sobre puntos válidos), `gpsPct` (visitas con IN), `outOfRange` (DistanceToPdvM > 200), `avgVisitMin`, `battery` primero/último, `points[]` cronológicos `{seq, ts, type, lat, lon, acc, distToPdv, battery, visitId, pdvId, pdvName}`, `sequence[]` visitas en orden `{seq, pdvId, pdvName, openedAt, closedAt, durMin, plannedOrder, hasGps, distToPdv, kmFromPrev}`.
  - **Resumen período**: días trabajados, ON/OFF promedio, PDVs y visitas totales, PDVs/día, km total y por día, GPS %, fuera de perímetro, duración prom visita, cumplimiento planificado (visitados/planificados), días con planificado y sin visitas.
- [x] `GET /intelligence/behavior?user_id&date_from&date_to` (admin-only como el drill; valida `user_id` visible). Cache TTL 10 min por (user_id, from, to). Tope 92 días por request.
- [x] Tests (`tests/test_behavior.py`): ON/OFF por checks vs fallback, km con outlier descartado, planificado vs visitado, fecha AR (visita 23:30 UTC-3 cae en el día correcto), rango inclusive, 403 no-admin.

## Frontend
- [x] `TradePage`: tabs (`ui/tabs`) "Gestión" (contenido actual) / "Comportamiento". El `PeriodFilter` actual queda en Gestión.
- [x] `inteligencia/comportamiento/RangeFilter.tsx`: presets **Hoy · Esta semana · Semana pasada (cerrada, lun-dom) · Este mes · Mes anterior · Últimos 30 días · Desde-hasta**. Fechas en AR (`todayAR`). Helpers puros en `range-utils.ts` + vitest.
- [x] `ComportamientoTab.tsx`:
  - Tiles resumen (días, ON/OFF prom, PDVs/día, km/día, GPS %, fuera de perímetro, dur. prom, cumplimiento plan).
  - Lista de días (fila tipo `ActividadDayRow`): fecha, ON – OFF, PDVs visitados/planificados, km, badges (sin GPS, fuera de perímetro, sin visitas con plan). Tap → expande.
  - Día expandido: timeline secuencial (nº, IN → OUT, PDV, dur, dist PDV, batería, km desde anterior) + **mapa del día** (markers numerados + polyline, PDVs planificados no visitados en gris). Toggle "Ver todo el período en el mapa" (una polyline por día, color por día).
- [x] `RoutePathMap.tsx` (componente reutilizable): markers numerados + polyline + fit bounds percentil (patrón RouteFocoPage / ZonaGoogleMap). Sustituir en RouteFocoPage NO (fuera de alcance).
- [x] `intelligenceApi.behavior(...)` + tipos.
- [x] Export CSV del período (día por fila) — chico, útil para auditoría.

## Verificación
- [x] pytest + vitest + build.
- [x] Playwright local (SQLite): trade con 2 días sembrados (checks con GPS, uno fuera de perímetro, un día sin GPS, planificado parcial) → tiles, filas, expandir, mapa renderiza (sin key de Google en local: fallback), presets cambian el rango.
- [x] Deploy: push (sin DDL).

## Decisiones (2026-09-24)
1. **Recorrido real**: Google Directions desde el navegador (misma key del mapa), 1 request por día (≤25 waypoints, chunk si hay más), `kmRuta` = suma de `legs[].distance`. Backend devuelve `kmLinea` (haversine) como respaldo; el front lo reemplaza y cachea en localStorage por (user, día, hash de puntos). Botón "Calcular km reales del período" para todos los días.
2. **Alertas de comportamiento** (resumen + por día + por visita): visitas sin GPS, fuera de perímetro (>200 m), visitas cortas (<3 min), visitas abiertas sin cerrar, días con plan y sin visitas, planificados no visitados, orden distinto al planificado, ON tarde (>10:00) / OFF temprano (<16:00), batería baja (<15%). Umbrales como constantes en el servicio.
3. **Solo admin** por ahora.
4. Perímetro **200 m**.

## Review (2026-09-24)
- Backend: `utils/geo.py`, `services/behavior.py`, `GET /intelligence/behavior` (admin, ≤92 días, cache 10 min). ON/OFF = más temprano/tardío entre GPS y visita. 25 tests (562 total).
- Frontend: TradePage con tabs; `comportamiento/` (RangeFilter 7 presets, tiles semáforo, AlertasCard, DiaRow con timeline + mapa, km reales via Google Directions con cache local, mapa del período, CSV); `RoutePathMap` reusable. 29 tests (133 total).
- E2E Playwright (SQLite local): 16/16 — drill, lazy fetch, tiles, alertas, ON gana visita sin GPS, día expandido, presets, custom > 92 bloqueado, CSV, 390px.
- Sin key de Google en local: mapas en fallback. Verificar en prod el mapa del día y "Calcular km reales" (Directions API habilitada en la key?).
