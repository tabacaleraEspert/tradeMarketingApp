# Tablero TMR — Documento de diseño y mapeo

> **Estado:** ✅ **validado por el cliente** (03-08-2026) — todas las preguntas respondidas (§9). Fórmulas y reglas congeladas como v1; listo para fase 1.
> **Insumos:** prototipo HTML (`Tablero_TMR.html`, datos al 21/07/2026), planillas "Ejecución" y "KPIs Objetivos de TMR — Variable Mensual", apuntes de call (jul-2026).
> **Objetivo:** incorporar el tablero de seguimiento de TMRs a la app, con vistas por jerarquía (admin → territory manager → vendedor) y KPIs que impactan en la variable mensual de compensación.

---

## 1. Contexto

Hoy existen tres piezas:

| Pieza | Estado | Rol |
|---|---|---|
| **Censo** (app mobile) | En producción | Toma de datos en calle: cobertura, precios, sueltos, POP, promos |
| **Panel de administración** | En producción | ABM de usuarios, rutas, PDVs, formularios |
| **Tablero TMR** | A desarrollar (este doc) | Visualización de performance y KPIs por jerarquía |

El prototipo HTML es la **especificación funcional** de cómo el cliente quiere ver la información. No se incorpora como código: los datos están hardcodeados (snapshot al 21/07), usa Chart.js por CDN (inviable en Capacitor offline), tiene bugs (variable `rid` sin definir en `renderRutaSummary`, elementos DOM inexistentes) y encoding roto. Se reimplementa como sección React con datos de la API.

---

## 2. Decisiones de arquitectura

1. **Un solo frontend.** El tablero es una sección nueva del frontend existente (rutas lazy por pestaña), no una app aparte. Comparte auth, cliente API, jerarquía y catálogos.
2. **Toda la lógica de KPIs vive en el backend.** Un único endpoint calcula la variable mensual y sirve las tres vistas: admin (todos), TM (su equipo), vendedor (él mismo). La futura vista mobile "Mis objetivos" consume el mismo endpoint.
3. **Metas, pesos y rúbricas son configuración, no código.** El cliente ya anticipó que la lógica va a cambiar ("quieren una lógica nueva"). Cambiar una meta debe ser un dato, no un deploy.
4. **Snapshot mensual persistido.** La variable impacta compensación: al cierre de mes se persiste el resultado por vendedor y no se recalcula retroactivamente si entran datos tarde.
5. **Filtrado por jerarquía server-side, siempre.** El prototipo embebe los datos de todos los TMRs en el cliente; en la app real cada request pasa por `visible_user_ids()` ([hierarchy.py](../backend/app/hierarchy.py)). Un vendedor nunca recibe datos de otros, ni siquiera ocultos en la UI.
6. **Higiene de datos en la agregación.** Filtrar productos de prueba (`TEST_*`) y outliers de precio antes de promediar (el snapshot del prototipo tiene precios como $28.002.500 que destruyen los promedios). Regla acordada *(P8, 03-08)*: descartar del promedio los precios fuera de `[0.25×, 4×]` la mediana del producto, **y marcar esos casos**: los outliers quedan visibles (listado de "precios sospechosos" en la pestaña Precios, con PDV/vendedor/fecha) para que puedan corregirse en origen.

---

## 3. Los 5 KPIs de la variable mensual

Lógica **binaria**: cada KPI suma su peso solo si alcanza la meta. Variable = Σ pesos de KPIs logrados.

**Universo base (definido por el cliente, 03-08):** todos los KPIs se miden sobre **PDVs que pertenecen a una ruta foco** del vendedor en el mes. La cartera fuera de ruta foco no cuenta.

| # | KPI | Peso | Meta | Numerador | Denominador | Fuente de datos |
|---|---|---|---|---|---|---|
| 1 | Cobertura de SKUs prioritarios | 30% | 80% | PDVs de ruta foco con calificación de **cobertura** ≥ **Bueno** (rúbrica §4) | PDVs de ruta foco | `VisitCoverage` (Works por producto) + rúbrica cobertura |
| 2 | Efectividad de visitas | 10% | 90% | PDVs con visita **efectiva** hecha **el día planificado**: en la visita se hizo (a) cobertura de productos Espert **y** (b) relevamiento de artículos POP **y** (c) ≥1 acción ejecutada (canje de sueltos / promo / colocación de material / etc.). Visitas fuera de plan **no** cuentan | PDVs planificados del mes (ruta foco) | `VisitCoverage` + `VisitPOPItem` + acción ejecutada (ad-hoc no-backlog o DONE) + `RouteDayPdv` (match por fecha planificada) |
| 3 | Penetración venta de sueltos | 10% | 50% | PDVs con ≥1 canje ejecutado en el mes | PDVs de ruta foco con `SellsLooseCigarettes = true` (campo booleano del PDV, [pdv.py:42](../backend/app/models/pdv.py)) | `VisitAction` (canje_sueltos, ad-hoc no-backlog o DONE) / `Pdv.SellsLooseCigarettes` |
| 4 | Colocación de material POP | 30% | 70% | PDVs con calificación de **comunicación** ≥ **Bueno** (rúbrica §4), **con foto tomada desde la app** (requisito excluyente) | PDVs de ruta foco | `VisitPOPItem` (Present) + `VisitPhoto` + `VisitAction` (ActionType=pop, ad-hoc no-backlog o DONE, PhotoTaken) + rúbrica comunicación |
| 5 | Activaciones promocionales | 20% | 40% | PDVs con ≥1 promo ejecutada en el mes | PDVs de ruta foco del mes | `VisitAction` (ActionType=promo, ad-hoc no-backlog o DONE) |

**Notas:**
- KPI 2 *(P2b, 03-08)*: la definición de "efectiva" exige las **tres** condiciones (cobertura + POP + acción) y **solo cuentan las visitas del día planificado** — una visita completa fuera de plan no suma.
- KPI 4 *(P4b, 03-08)*: la **foto tomada desde la app es obligatoria** para que el PDV cuente. El prototipo mostraba este KPI "sin datos", pero la fuente existe (`VisitPOPItem` + `VisitPhoto`).
- **Corte temporal** *(P6, 03-08)*: las visitas cuentan **hasta el día de cierre del mes** (fecha de la visita); no existe concepto de "visita tardía". Al cierre se genera el snapshot (§5.2); como respaldo técnico, cualquier dato que se sincronice después del cierre no modifica el mes ya congelado.
- **Corrección 11-08 (hallazgo de producción):** "acción ejecutada" (KPIs 2/3/4/5) ya no exige `VisitAction.Status='DONE'` a secas — la app mobile crea las acciones ad-hoc del vendedor ("Acciones realizadas") sin `Status` explícito, quedaban en el default `PENDING` del modelo y nada las pasaba a `DONE` (2 filas `DONE` contra 3.731 `PENDING` en toda la historia). Criterio nuevo: `(MandatoryActivityId IS NULL AND Status != 'BACKLOG') OR Status = 'DONE'` — una acción ad-hoc (no ligada a un TODO de plantilla) cuenta salvo que esté en `BACKLOG` (pospuesta); una de plantilla solo cuenta si llegó a `DONE`. Desde esta fecha, `POST /visits/{id}/actions` además crea las acciones ad-hoc con `Status='DONE'` explícito.

---

## 4. Rúbrica de scoring de ejecución (configurable)

Del cruce **censo × objetivos de cobertura y comunicación** sale la calificación del PDV (Excelente / Muy Bueno / Bueno / Regular / No cuenta). Se modela como dos tablas de configuración con vigencia:

**`scoring_coverage_rule`** — mínimos de SKUs por marca y nivel (según planilla "Ejecución"):

| Marca | Excelente | Muy Bueno | Bueno | Regular | No cuenta |
|---|---|---|---|---|---|
| Milenio | 4 | 3 | 3 | 1 | (2 total cigs) |
| Mill | 2 | 2 | 1 | 1 | — |
| Melbourne | 1 | 1 | 1* | 1* | — |
| Bold | 1 | 1 | * | * | — |
| **Total cigs** | **8** | **7** | **5** | **3** | **2** |
| Van Kiff | 4 | 3 | 2 | 1* | 1 |
| Lebonn | 1 | 1 | 1 | * | — |
| **Total tabacos** | **5** | **4** | **3** | **1** | **1** |

\* celdas combinadas en la planilla — confirmar interpretación con cliente.

**`scoring_communication_rule`** — materiales POP por nivel: Excelente = 4 elementos, Muy Bueno = 3, Bueno = 2, Regular = 1 (con detalle por tipo: escalerita, movie, stopper, afiche, matamosca, otro).

**Resuelto (P7, 03-08):** cada KPI usa su propia tabla — el KPI 1 califica con la rúbrica de **cobertura** y el KPI 4 con la de **comunicación**; no se combinan. Un PDV tiene entonces dos calificaciones independientes. En el tablero (pestaña PDVs) se muestran ambas; el prototipo mostraba solo la de cobertura.

---

## 5. Modelo de configuración y snapshot

Requisito del cliente: pesos, metas y **contenido de las rúbricas** configurables, con **alcance por región o por usuario**: el admin administra todo; cada territory manager administra la configuración de sus subordinados.

### 5.1 Qué es configurable y qué es código

- **Los 5 KPIs son fijos en código** (su lógica de cálculo). Un KPI nuevo = implementación nueva, no se crea desde la UI.
- **Configurable por UI, sin deploy**:
  - **Meta y peso** de cada KPI, por alcance (global/zona/usuario) y con vigencia.
  - **Rúbrica de cobertura**: alta/baja/modificación de marcas o artículos y sus mínimos de SKUs por nivel (ej. agregar una marca nueva a la tabla de "Objetivo de Cobertura").
  - **Rúbrica de comunicación**: alta/baja/modificación de materiales POP y los elementos requeridos por nivel.

Es decir: "agregar un objetivo" = agregar una fila a las rúbricas (un artículo, un material), no inventar un KPI nuevo.

### 5.2 Tablas (Alembic)

- **`kpi_definition`** — `(id, kpi_key, nombre, descripción, activo)`. Los 5 KPIs actuales, seedeados; cada fila corresponde a un cálculo implementado en el backend. Agregar un KPI = migración + código (no UI).
- **`kpi_config`** — `(kpi_definition_id, peso, meta, scope_type, scope_id, valid_from, valid_to, created_by)`.
  - `scope_type ∈ {global, zone, user}`; `scope_id` = ZoneId o UserId según corresponda.
  - **Resolución**: al calcular el mes de un usuario se toma, por objetivo, la config más específica vigente: `user` > `zone` (la zona del usuario) > `global`. Un set de configs por usuario queda determinístico y auditable.
  - Versionado por vigencia: modificar = cerrar la fila vigente (`valid_to`) y crear una nueva. Nunca se edita historia.
- **`scoring_coverage_rule`** — `(marca/artículo, nivel, min_skus, scope_type, scope_id, valid_from, valid_to, created_by)` y **`scoring_communication_rule`** — `(material, nivel, requerido/cantidad, …)`. Rúbricas §4 como filas de datos: agregar un artículo o material nuevo es un alta por UI. Mismo esquema de alcance y vigencia que `kpi_config` (el cliente podría querer exigencias distintas por región). Las marcas/artículos referencian el catálogo `Product` cuando corresponde, para que la matriz de cobertura y la rúbrica hablen el mismo idioma.
- **`kpi_monthly_snapshot`** — `(user_id, year, month, kpi_definition_id, actual, meta, peso, scope_aplicado, achieved, numerador, denominador, frozen_at)`. Guarda **la config que se usó**, no una referencia: el snapshot es autocontenido aunque la config cambie después.

### 5.2.1 Cierre mensual automático (implementado en fase 4)

El backend corre con 4 workers de Gunicorn y sin scheduler, así que un job en proceso se ejecutaría N veces. El cierre usa **lazy trigger idempotente**:

- Se dispara al inicio de `GET /kpi/variable` (el primer request al abrir el tablero) mediante `ensure_previous_month_closed()`.
- Marca de control en `AppSetting` (`kpi_last_auto_close = "YYYY-MM"`): si ya procesó el mes anterior, corta con una sola query.
- Seguro ante concurrencia (unique de snapshot + rollback en `IntegrityError`) y **nunca hace fallar el request**: cualquier error se loguea y el tablero sigue respondiendo.
- Si el mes anterior **no tiene config vigente** (caso típico del primer mes tras el deploy: el seed crea la config con `ValidFrom` = mes de instalación), no congela nada, escribe la marca igual y loguea un warning — no reintenta en cada request.
- El cierre manual (`POST /kpi/close-month`, admin) sigue disponible para cerrar meses viejos o regenerar con `force=true`.
- `GET /kpi/closed-months` lista los meses congelados (snapshots, usuarios, fecha de congelamiento) — alimenta el badge de estado y el indicador del selector de mes en el tablero.

### 5.3 Permisos de administración

**Resuelto (P11, 03-08): la configuración la administra solo el admin.** El territory_manager no edita metas, pesos ni rúbricas — solo lectura de la configuración de su equipo.

| Acción | admin | territory_manager | vendedor |
|---|---|---|---|
| Config `global` / `zone` / `user` (metas y pesos) | ✔ | — | — |
| Editar rúbricas (agregar/quitar artículos y materiales, umbrales) | ✔ | — | — |
| Crear KPIs nuevos | — (requiere desarrollo) | — | — |
| Ver configuración aplicada | ✔ (todos) | su equipo (solo lectura) | la propia (solo lectura, en "Mis objetivos") |

Se mantiene el modelo de alcance global/zona/usuario (§5.2) — lo que cambia es que el único que escribe es el admin. Toda escritura registra `created_by` + timestamp (auditoría: con compensación de por medio, hay que poder responder "quién cambió la meta y cuándo").

### 5.4 Reglas de consistencia

- **Suma de pesos = 100%, validación bloqueante** *(P9 resuelta por P11)*: como solo el admin edita, no hay conflictos entre editores. Al guardar, el sistema valida que el set **resuelto** de cada usuario afectado por el cambio siga sumando 100% y bloquea el guardado si no cierra (mostrando qué usuario/scope rompe la suma).
- **Cambios a mitad de mes aplican inmediato** *(P10)*: el mes en curso siempre se calcula en vivo con la config vigente, así que un cambio de meta o rúbrica se refleja al instante en el tablero. Los meses ya cerrados no se recalculan: quedan en su snapshot, generado al cierre del mes *(P6: las visitas cuentan hasta el día de cierre; lo sincronizado después no modifica el mes congelado)*.

Nota: existe `AppSetting` (key-value) pero para esto conviene tablas dedicadas con alcance y vigencia, no un JSON en settings.

---

## 6. Mapeo prototipo (`DD`) → endpoints

| Bloque del prototipo | Contenido | Endpoint | Estado |
|---|---|---|---|
| `DD.res`, KPI row general | Visitas, GPS%, foto%, entregas | `/reports/summary` | **Existe** |
| `DD.trades` (tabla comparativa equipo) | Ranking por TMR: visitas, PDVs, GPS, foto | `/reports/vendor-ranking` | **Existe** — falta agregar efectividad con lógica nueva |
| `DD.kpis[tmr]` (panel variable mensual) | 5 KPIs + variable ponderada binaria | `/reports/tmr-variable?year&month&user_id?` | **Nuevo** (núcleo del proyecto) |
| `DD.rutas` (resumen por ruta foco) | PDVs, planificadas vs realizadas, efectividad, acciones, sueltos, canje | `/reports/route-summary?year&month&user_id?` | **Nuevo** (`/route-analytics` existe pero no tiene relevados/buenos/canje) |
| `DD.tmr_pdvs[].pr` + `score` (matriz PDV × producto) | Trabaja/no trabaja por SKU + calificación | `/reports/coverage-matrix?user_id&route_id&page` | **Nuevo** — paginado obligatorio (~55 productos × cientos de PDVs) |
| `DD.rutas[].score_dist` | Distribución Excelente/…/Sin relevar | Incluido en `/reports/pdv-scoring` | **Nuevo** (usa rúbrica §4) |
| `DD.precios` + `precios_ruta` | Precio avg/min/max/n por producto, zona, TMR, ruta | `/reports/product-analytics` (global, **existe**) + `/reports/price-matrix?group_by=ruta\|zona\|tmr` | **Extender** — precios completos (no "4k"), filtro de outliers |
| `DD.quick_wins` | PDVs a un paso de subir de categoría | `/reports/quick-wins?user_id?` | **Nuevo** (deriva de coverage-matrix + rúbrica) |
| `DD.actividad`, `DD.visits_semanal` | Actividad diaria/semanal, entrada/salida por PDV | `/reports/vendor-ranking` + `/reports/avg-time-by-tm-pdv` cubren parte | **Extender**: `/reports/weekly-activity?user_id&week` |
| `DD.acciones_data` | Canjes (vacíos/llenos), promos por subtipo, juegos | `/reports/product-deliveries` | **Existe** — verificar agregación por subtipo |
| `DD.cartera_data` | Cartera total vs ruta foco, días activos | `/reports/territory-overview` | **Existe** (parcial) |
| `DD.prod_cob`, `prod_cob_by_trade` | Cobertura % por producto y fabricante | `/reports/product-analytics` | **Extender** con corte por TMR/jerarquía |

**Deuda detectada a corregir en fase 1:** `/product-analytics`, `/supplier-analytics`, `/form-times` y `/avg-time-by-tm-pdv` **no aplican jerarquía** (`visible_user_ids`). Hoy cualquier usuario autenticado ve datos globales. Corregirlo antes de exponer el tablero a vendedores.

---

## 7. Frontend — pestañas y vistas por rol

Sección nueva "Tablero" con pestañas lazy (una ruta + una query por pestaña, patrón `React.lazy` ya usado en [routes.tsx](../frontend/src/app/routes.tsx)):

| Pestaña | Contenido | Visible para |
|---|---|---|
| **Resumen** | KPI row + variable mensual (anillo + 5 tarjetas) + ranking del equipo | admin, TM |
| **Rutas** | Resumen por ruta foco (tabla expandible del prototipo) | admin, TM, vendedor (las suyas) |
| **PDVs** | Matriz cobertura por SKU + score + quick wins — paginada/virtualizada | admin, TM, vendedor |
| **Precios** | Matriz precio × producto × (ruta/zona/TMR), valores completos | admin, TM |
| **Actividad** | Semanal colapsable: día, visitas, horarios entrada/salida | admin, TM, vendedor |
| **Objetivos (admin)** | ABM de metas/pesos por alcance (global/zona/usuario) + edición de rúbricas (artículos y materiales); vista de config resuelta por usuario | admin (edición); TM (solo lectura de su equipo) |
| **Mis objetivos** | Los KPIs propios + progreso al día N — misma data de `/tmr-variable` | vendedor (fase posterior, mobile-first) |

Reglas de UI:

- Selector de TMR (chips del prototipo) visible solo para admin/TM; el backend igual valida que el `user_id` pedido esté en `visible_user_ids()`.
- **Theming**: no copiar los estilos inline del prototipo; usar el design system (Tailwind + Radix) con light/dark. Feedback de la call: "se ve todo muy parecido" → color reservado para semáforos de cumplimiento (verde/amarillo/rojo), no decorativo.
- Gráficos con **Recharts** (ya instalado), no Chart.js.
- Precios siempre en formato completo (`$4.300`, no `$4k`).

---

## 8. Plan por fases

| Fase | Contenido | Depende de |
|---|---|---|
| **0. Validación** (este doc) | ✅ Completa (03-08-2026) — todas las preguntas respondidas, fórmulas v1 congeladas | — |
| **1. Backend base** | Tablas de config + migraciones (con alcance global/zona/usuario y resolución §5.2); motor de cálculo KPI; `/tmr-variable`, `/pdv-scoring`, `/route-summary`; CRUD de configs con permisos §5.3; fix de jerarquía en los 4 endpoints sin filtro; filtro de outliers y productos test | Fase 0 |
| **2. Tablero core** | Sección frontend con pestañas Resumen + Rutas + PDVs; theming | Fase 1 |
| **3. Tablero completo** | Pestañas Precios + Actividad; quick wins; `/coverage-matrix` paginado; pestaña **Objetivos** (ABM de configs para admin/TM) | Fase 2 |
| **4. Cierre mensual** | Snapshot al cierre + job de congelamiento; vista de meses históricos | Fase 1 |
| **5. Mis objetivos** | Vista mobile del vendedor sobre `/tmr-variable` | Fases 1 y 4 |
| **Validación final** | Comparar números del tablero contra el prototipo con el mismo corte de datos (21/07) | Todas |

---

## 9. Preguntas al cliente — estado (act. 03-08-2026)

### Resueltas

| # | Respuesta del cliente | Efecto en el diseño |
|---|---|---|
| P1 | Denominador = PDVs que pertenecen a una **ruta foco** | Universo base de todos los KPIs (§3) |
| P2 | Visita efectiva = cobertura Espert **+** relevamiento POP **+** ≥1 acción | KPI 2 (§3); queda P2b |
| P3 | Campo booleano del PDV | `Pdv.SellsLooseCigarettes` (§3, KPI 3) |
| P4 | Estándar = rúbrica de comunicación, calificación ≥ Bueno | KPI 4 (§3); queda P4b |
| P5 | Denominador = PDVs de ruta foco del mes | KPI 5 (§3) |
| P7 | (resuelta por inferencia de P4) cada KPI usa su tabla | §4 |
| P8 | Sí, y **marcar** los casos descartados | §2 (listado de precios sospechosos) |
| P9 | (resuelta por P11) solo admin edita → suma 100% bloqueante | §5.4 |
| P10 | Cambios aplican **inmediato** al mes en curso | §5.4 |
| P11 | El territory_manager **no** administra configuración | §5.3 |
| P2b | Solo cuentan las visitas hechas **el día planificado** | KPI 2 (§3) |
| P4b | La **foto desde la app es obligatoria** para contar el PDV | KPI 4 (§3) |
| P6 | Las visitas cuentan **hasta el día de cierre del mes**; no hay tardías. Snapshot al cierre; lo sincronizado después no modifica el mes | §3 (notas) y §5.4 |

### Pregunta surgida en implementación — resuelta

- **P12 (denominador 0), respondida por el cliente el 03-08:** el KPI se da por **incumplido**. Es intencional: el objetivo del vendedor incluye *generar* la estructura (ej. lograr que los PDVs empiecen a vender sueltos). La implementación ya se comporta así (comentario de referencia en `kpi_engine._pct`).

**Definición v1 congelada — no quedan preguntas pendientes.** Cualquier cambio posterior de fórmulas entra como cambio de alcance.

---

## 10. Estado de implementación — Fase 1 (04-08-2026)

**Backend completo y auditado** (ver [tablero-tmr-plan-fase1.md](tablero-tmr-plan-fase1.md)): migración `0021`, motor `app/services/kpi_engine.py`, router `/kpi` (variable, pdv-scoring, route-summary, CRUD config, close-month), fix de jerarquía en 4 endpoints de reports, 338 tests en verde. Auditoría de correctitud y permisos realizada; bloqueantes corregidos con tests de regresión.

**Fases 2 a 4 completas (07-08-2026)** — sección "Objetivos TMR" en el panel:
- Drill-down por jerarquía: General (resumen por territorio) → Territorio (ranking de vendedores) → Vendedor (variable + 5 KPIs), con breadcrumb; el TM/supervisor arranca en su territorio. Estado persistido en la URL.
- Pestañas: Resumen, Rutas, PDVs, **Objetivos** (ABM de metas/pesos por alcance con guardado en lote y suma en vivo + rúbricas + config resuelta), **Precios** (matriz por producto × ruta/vendedor con valores completos + precios sospechosos), **Actividad** (semanal con detalle diario).
- Cierre mensual automático (§5.2.1) con badge de estado del mes, indicador de meses cerrados en el selector y cierre manual para admin.
- Endpoints agregados: `price-matrix`, `suspicious-prices`, `weekly-activity`, `config/bulk`, `closed-months`. `Route.IsFocus` editable desde el ABM de rutas.
- 365 tests backend / 59 frontend en verde.

**Limitaciones conocidas v1 (deuda aceptada, documentada):**
- **Bordes de mes en UTC**: las visitas se bucketizan por `OpenedAt` UTC — una visita después de las ~21:00 ART del último día del mes cae en el mes siguiente. Es coherente con el resto del sistema de reportes; corregirlo es un cambio transversal de timezone, fuera del alcance del tablero.
- **`/kpi/pdv-scoring` y `/kpi/route-summary` calculan siempre en vivo**, incluso para meses cerrados (el snapshot congela solo los agregados de la variable, no el detalle por PDV). El número que paga (la variable) sí queda congelado.
- ~~P12~~ resuelta: denominador 0 = KPI incumplido, comportamiento intencional confirmado por el cliente (ver §9).
