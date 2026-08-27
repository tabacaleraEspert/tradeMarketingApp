# Inteligencia Comercial — página viva en la app

## Contexto

El informe "Inteligencia Comercial Espert" (artifact 3b913c53, datos export 19-08) se armó a mano sobre un export de prod y un script de análisis que murió con la sesión. Se quiere como **página propia "Inteligencia" en el menú del panel admin**, calculada en vivo contra la DB, con todas las secciones: resumen, mapa, zonas, competencia, portfolio, motor de oportunidades (5 reglas), trades y alertas.

Restricciones: DB S0 (cache TTL obligatorio), prod NO Alembic-tracked (DDL quirúrgico vía script hotfix), no tocar `kpi_engine.py` (reusar sus helpers), `VisitCoverage` es el escaneo caro.

## Backend

### 1. Migración + capsulados
- [ ] Alembic `00XX_product_iscapsule`: columna `IsCapsule BIT NOT NULL DEFAULT 0` en `Product` + backfill por lista explícita de nombres (Espert: Milenio Icergy/Vid/Pink/Mint, Melbourne Mint/Aura, Mill Explosion, Bold Mint, Van Kiff Vid; competencia: Golden King Caps, Lucky LS Origen Caps, Marlboro Craft Coral/Forward/Purple, Red Point ON/Sixt).
- [ ] `backend/scripts/hotfix_product_iscapsule_prod.py` (patrón `hotfix_kpi_tables_prod_20260804.py`): ALTER + backfill idempotente para prod. **Verificar estado de `alembic_version` en prod antes** (memoria 2026-06: vacía).
- [ ] Modelo `Product`: agregar `IsCapsule`.

### 2. Servicio `backend/app/services/intelligence.py` (hermano de `tmr_dashboard.py`)
- [ ] `_load_census(db, pdv_ids)` — consolida `VisitCoverage`: última observación por `(PdvId, ProductId)` gana; sets `works` y `surveyed` por PDV; excluye `TEST_*`. Copiar patrón `_load_coverage` (`tmr_dashboard.py:295`).
- [ ] `build_overview` — tiles resumen, zonas (pdvs/censados/conEspert/cobertura/skusProm/visitas30d/trades), competencia (presencia fabricante×zona, precio prom por fabricante usando `filter_price_outliers` con baseline universo completo), portfolio (presencia SKU Espert nacional y por zona), trades 30d (visitas, %censado cartera, skusProm, %GPS de `VisitCheck`, %foto de `VisitPhoto`), alertas derivadas.
- [ ] `build_opportunities` — 5 reglas sobre censo consolidado:
  - R1 Extensión Milenio (Media): tiene Milenio Red → una oportunidad por variante capsulada faltante (Icergy/Vid/Pink).
  - R2 Categoría sin Espert (Alta): categoría ∈ {tabacos, papelillos, vapes, pouches} con ≥1 competidor trabajado y 0 Espert → sugerir Van Kiff/Blank/Dito/Fleek.
  - R3 Capsulados (Alta): trabaja capsulado competencia (`IsCapsule=1, IsOwn=0`) y ningún capsulado Espert.
  - R4 Franja descubierta (Media): franja económica ($1.500-2.100) o media ($2.200-3.400) — por mediana validada del SKU — cubierta por competencia y sin Espert. Franjas como constantes documentadas en el servicio (ABM fase 2).
  - R5 PDV sin Espert (Crítica): ≥1 producto competencia trabajado, 0 Espert → primera colocación.
  - Salida por fila: pdvId, nombre, zona, canal, trade asignado, tipo, prioridad, detalle, sugerencia. Agregados por tipo/zona/prioridad/trade.
- [ ] `build_map` — PDVs activos con Lat/Lon + status (`espert` | `censado_sin` | `sin_censo`) + zona, payload mínimo (arrays).

### 3. Router `backend/app/routers/intelligence.py` (prefix `/intelligence`, registrar en `main.py`)
- [ ] `GET /intelligence/overview`, `GET /intelligence/opportunities` (filtros zone_id/user_id/priority/tipo, paginado), `GET /intelligence/map`.
- [ ] Auth: `get_current_user` + scope por `visible_user_ids`/`visible_pdv_ids` (TM ve su sub-árbol; admin todo). Sin `require_role` (patrón kpi.py).
- [ ] Cache: `TTLCache` (`app/utils/ttl_cache.py`) TTL 1800s, **key incluye `current_user.UserId`**, MAX_ENTRIES defensivo, sumar al fixture `_clear_response_caches` de `backend/tests/conftest.py`.

### 4. Tests `backend/tests/test_intelligence.py`
- [ ] Unit por regla (fixtures SQLite: PDV con Red sin Icergy → R1; categoría solo competencia → R2; etc.), consolidación última-visita-gana, scope jerárquico (TM no ve PDVs ajenos), cache con user en key.

## Frontend

### 5. Página `frontend/src/app/pages/inteligencia/`
- [ ] `InteligenciaPage.tsx` + secciones en archivos propios (norma ~200 líneas): `ResumenSection`, `MapaSection`, `ZonasSection`, `CompetenciaSection`, `PortfolioSection`, `OportunidadesSection`, `TradesSection`, `AlertasSection`.
- [ ] Mapa: **canvas custom** (puerto del artifact, ~6.5k puntos, filtro por zona, 3 colores: cobre=Espert, azul=censado sin, gris=sin censo). No Google Maps (6.5k markers no escala y evita costo API).
- [ ] Gráficos: tablas + barras CSS + heatmaps con celdas coloreadas (como el artifact); sin lib nueva.
- [ ] Fetch: patrón `PreciosTab.tsx` (useCallback + loading/error + Reintentar).
- [ ] Oportunidades: tabla paginada con filtros zona/trade/prioridad + export CSV client-side (reemplaza el Excel manual).

### 6. Wiring
- [ ] `routes.tsx`: ruta lazy `/inteligencia` bajo `AdminGuard`.
- [ ] `AdminLayout.tsx`: entrada de menú "Inteligencia" (icono Brain), misma visibilidad que Tablero TMR.
- [ ] `services.ts`: `intelligenceApi` + tipos.

## Verificación

- [ ] `pytest tests/ -v` backend + `npm test` + `npm run build` frontend.
- [ ] Levantar backend local contra **DB prod** (receta memoria: puerto 8011 + front 5175) y cotejar contra el artifact: cobertura nacional ~85%, censados ~2.2k, Cuyo ~48%, oportunidades ~4.4k por tipo (los datos se movieron desde el 19-08, tolerancia razonable).
- [ ] Probar como usuario TM (impersonation) → solo ve su sub-árbol.
- [ ] Medir tiempo de `/intelligence/overview` en frío contra prod (target < 10s primera vez, cache después).

## Fase 2 (no ahora)
Alertas push/bandeja, gaps del PDV al abrir la visita, tasa de conversión de oportunidades, ABM de franjas de precio, snapshot mensual de inteligencia.

## Review (2026-08-27)

Implementado completo. Backend: migración `0022_product_iscapsule` + `scripts/hotfix_product_iscapsule_prod.py` (prod no Alembic-tracked; `startup.sh` es best-effort así que la migración fallida no rompe el deploy), servicio `app/services/intelligence.py` (censo histórico consolidado + overview + 5 reglas + mapa), router `/intelligence` (3 endpoints, scope jerárquico, `TTLCache` 30 min con censo compartido entre endpoints, sumado a `_clear_response_caches`). Frontend: `pages/inteligencia/` (7 componentes, mapa canvas sin Google Maps, export CSV con BOM), entrada "Inteligencia" (icono Brain) en menú, ruta `/inteligencia` bajo AdminGuard, `intelligenceApi` + tipos en `services.ts`.

Decisiones tomadas: R5 (primera colocación) subsume R1-R4 en el mismo PDV — los totales no van a coincidir 1:1 con el informe estático (que además quedó congelado al 19-08). R1 emite una oportunidad por variante Milenio faltante, matching por nombre (`startswith`). Franjas R4 fijas en código.

Verificado: 459 tests backend (15 nuevos), 62 frontend, `npm run build` OK.

Pendiente (requiere correr contra prod — bloqueado para Claude por permisos):
1. `python backend/scripts/hotfix_product_iscapsule_prod.py` (columna IsCapsule + backfill) ANTES de deployar el backend.
2. Levantar local contra prod y cotejar números vs artifact (cobertura ~85%, Cuyo ~48%).
3. Deploy: push a main (backend Docker + SWA frontend).
