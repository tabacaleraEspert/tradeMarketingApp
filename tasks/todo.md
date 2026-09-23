# Censo de cobertura en 3 estados (Sí / No / Sin dato) + completitud

## Decisiones (2026-09-23)
- **A**: histórico → todo `Works=False` anterior al corte pasa a "sin dato"; sobreviven solo los "Sí".
- Carga **por marca**: "No" en la marca marca todas las variantes; "Sí" en la marca abre las variantes, que quedan "sin dato" hasta que se toquen.
- **Completitud del censo** como KPI visible para el vendedor.

## Diagnóstico (de los dos mapas)
- `VisitCoverage.Works` es booleano; el form guarda `Works=False` para TODO producto de una categoría abierta → "no pregunté" = "no tiene". Default de categoría = "No trabaja" y se persiste en `PdvProductCategory` para todas (tabla que nadie lee en analítica).
- Ausencia de fila se interpreta distinto en cada consumidor: `kpi_engine`/`tmr` la saltean (bien), `intelligence` R2-R5 la toman como "no trabaja" (mal), `reports.product_analytics` mezcla.
- No existe `Brand` en `Product`; la marca se infiere por prefijo del nombre en `kpi_engine` (`CIGS_BRANDS`, `TABACOS_BRANDS`) y `SkuName.tsx`.
- Sin tests del form. Prod NO Alembic-tracked → DDL vía script hotfix (patrón `hotfix_kpi_tables_prod_20260804.py` / IsCapsule).

## Modelo de datos (mínimo DDL)
- **"Sin dato" = no hay fila.** `VisitCoverage` no cambia. El form solo manda filas con Sí o No. Cero ALTER en esa tabla (es el escaneo caro).
- **Corte histórico** = AppSetting `coverage_explicit_no_since` (timestamp). Helper único `app/services/coverage_semantics.py::row_is_known(works, created_at, cutoff)`: fila `Works=False` con `CreatedAt < cutoff` → se ignora (sin dato). Reversible: borrar el setting vuelve al comportamiento actual. No se borra nada.
- **`Product.Brand`** (String(60), nullable): migración Alembic `0023` + `scripts/hotfix_product_brand_prod_<fecha>.py` (ALTER idempotente + backfill por prefijo del nombre: lista Espert existente + fabricantes competencia; fallback primera palabra) + setea el AppSetting del corte. Editable en Gestión de Productos.

## Backend
- [x] `coverage_semantics.py`: cutoff (cacheado), `row_is_known`, `brand_of(product)`.
- [x] `Product.Brand` + schema + `products` router (list/create/update) + migración 0023 + hotfix prod.
- [x] `intelligence.load_census`: aplica `row_is_known`; nuevo `known[pdv]` (= surveyed post-corte). `completitud[pdv] = known / catálogo activo` y agregados por zona/trade/ruta en overview + drill.
- [x] Reglas: R5 exige comp works **y** ≥1 marca Espert de cigarrillos con "No" explícito; R2 exige "No" explícito en ≥1 Espert de esa categoría; R3 idem capsulados Espert; R4 idem franja. Sin dato → no es oportunidad (aparece en "a completar").
- [x] `tmr_dashboard`: `_load_coverage` aplica `row_is_known`; `prod_cob` denominador = PDVs con dato del producto; `build_pdvs` agrega `completitud` por PDV; `build_routes` promedio por ruta; `build_team` promedio por vendedor.
- [x] `visit_coverage /diff`: `PrevWorks` = None si la fila previa no es "known"; agrega `Brand` al item.
- [x] `reports.product_analytics`: denominadores consistentes (surveyed known).
- [x] `kpi_engine`: NO se toca (ya saltea marcas sin relevar; KPI1 sobre universo es la definición del KPI).
- [x] Tests: semantics (corte), reglas con sin dato, completitud, diff, brand backfill.

## Frontend — form de cobertura (`CoverageFormPage.tsx`)
- [x] `CoverageRow.State: "si" | "no" | "sin_dato"` (default `sin_dato`).
- [x] Jerarquía Categoría → Marca → Variante. Control segmentado `[Sí] [No] [—]` en los 3 niveles. Marca "No" → variantes "no"; marca "Sí" → expande, variantes quedan "sin dato"; categoría "No" → todo "no" + `PdvProductCategory` `no_trabaja`; categoría "Sí" → expande marcas.
- [x] Orden dentro de la categoría: Espert primero, luego marcas "sin dato", luego el resto. Contador en header: "X de N con dato · Y Espert".
- [x] `persist`: manda solo filas `si`/`no`; sacar el auto-corrección que baja la categoría a `no_trabaja`; categorías se mandan solo las tocadas; sacar el `bulkUpsert` inmediato del switch (no offline-safe).
- [x] Prefill desde visita anterior: "Sí" y "No" conocidos (chip "visita ant."), sin dato queda sin dato.
- [x] Marca "Sí" sin ninguna variante marcada al guardar → aviso "marcá al menos una variante de {marca}" (no bloquea).
- [x] Tipos: `CoverageDiff` con `Brand`, `PrevWorks: boolean | null` ya existe; agregar `Puffs`/`PrevPuffs` (bug de tipos).

## Frontend — vistas
- [x] `VisitSummaryPage` / `History`: "N trabajan · M no · resto sin dato".
- [x] `VisitDataExplorer`: punto verde = Sí, rojo = No (ya no hay gris ambiguo); CSV "Trabaja: Sí/No".
- [x] Inteligencia `PdvPage`: censo con "sin dato" contados + completitud del PDV; `ZonaPage`/`RutaPage`: columna completitud.
- [x] Tablero estático `tablero-tmr/index.html`: card "Completitud del censo" en el panel individual (Mi gestión) + columna en tabla de PDVs + en tabla comparativa del equipo.
- [x] `ProductManagement`: campo Marca.

## Deploy (orden obligatorio)
1. Correr hotfix en prod (ALTER `Product.Brand` + backfill + AppSetting corte). **Antes** del deploy del backend: el modelo nuevo hace SELECT de `Brand`.
2. Deploy backend. 3. Deploy frontend.

## Verificación
- [x] pytest completo.
- [x] Playwright local (SQLite, receta de la memoria): form 3 estados (marca No → variantes No; marca Sí → sin dato; categoría No; guardar y reabrir; offline encolado), Mi gestión con completitud, Inteligencia sin oportunidades sobre PDVs sin dato.
- [ ] Tras deploy: comparar conteo de oportunidades antes/después en Inteligencia (esperable: baja fuerte).

## Preguntas abiertas
1. `Product.Brand` con ALTER en prod vía hotfix (mismo patrón que IsCapsule) — OK?
2. Prefill "No" desde visita anterior igual que hoy el "Sí" (chip "visita ant.")? default: sí.
3. Marca "Sí" sin variantes marcadas: no persiste nada, solo aviso. OK?
4. Completitud sobre todo el catálogo activo (Espert + competencia), mostrando Espert aparte? default: sí.

## Review (2026-09-23)
- Backend: 536 tests (semantics 11, intelligence 26, tmr 22, diff/cutoff 10 + existentes). Corte vía AppSetting; `Product.Brand`; categorías `no_trabaja` pre-corte omitidas en el list.
- Frontend: build OK, 80 tests (coverage-utils 18). Form 3 estados por marca; vistas; tablero + Inteligencia con completitud y "A completar".
- E2E Playwright (SQLite local, 390px): 33/33 — herencia Sí viejo, No pre-corte ignorado, No post-corte heredado, marca No → 4 variantes, marca Sí sin variantes → aviso y no persiste, categoría default vieja → sin dato, reabrir persiste, card censo en Mi gestión, overview/opportunities con claves nuevas.
- Deploy: PENDIENTE. Orden: (1) `python scripts/hotfix_product_brand_prod_20260923.py` en prod (lo corre Davor), (2) push → backend, (3) frontend (mismo push).
