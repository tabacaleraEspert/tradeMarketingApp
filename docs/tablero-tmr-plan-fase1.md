# Tablero TMR — Plan de implementación Fase 1 (backend)

> **Base:** [tablero-tmr-diseno.md](tablero-tmr-diseno.md) (v1 validada por el cliente el 03-08-2026).
> **Alcance de esta fase:** tablas de configuración + motor de cálculo de KPIs + endpoints `/tmr-variable`, `/pdv-scoring`, `/route-summary` + CRUD de configuración + fix de jerarquía en endpoints existentes + snapshot de cierre. **No incluye** frontend (fases 2–3) ni la vista Mis objetivos (fase 5).

---

## 0. Decisiones previas (resueltas acá, no requieren cliente)

| Tema | Hallazgo | Decisión |
|---|---|---|
| **"Ruta foco" no existe en el modelo** | `Route` no tiene flag que distinga foco ([route.py:7-30](../backend/app/models/route.py)); el cliente definió el universo KPI como "PDVs de ruta foco" | Nueva columna `Route.IsFocus` (bool, **default `true`**: hoy todas las rutas activas asignadas se consideran foco, comportamiento actual intacto). Editable desde el panel admin de rutas (checkbox, tarea chica de fase 2) |
| **Vínculo visita ↔ plan** | `Visit.RouteDayId` (FK nullable, [visit.py:17](../backend/app/models/visit.py)) — no hace falta matchear por fecha | KPI 2 usa `Visit.RouteDayId`: visita del día planificado = visita cuyo `RouteDay` incluye al PDV en `RouteDayPdv`. Visita con `RouteDayId NULL` = fuera de plan → no cuenta |
| **Foto de POP** | `VisitPhoto.PhotoType` existe; además `VisitAction.PhotoTaken` (bool) | Requisito de foto del KPI 4 = `VisitAction(ActionType='pop', Status='DONE', PhotoTaken=true)` **o** `VisitPhoto` con `PhotoType='pop'`. Confirmar en el código del router de visitas cuál escribe la app mobile y usar esa como fuente primaria (verificación incluida en tarea T2) |
| **Acciones válidas** | `VisitAction.Status`: PENDING/DONE/BACKLOG | Solo cuentan acciones `Status='DONE'` |
| **Numeración Alembic** | Última revisión: `0020_sso_used_jti` | La migración de esta fase es `0021_kpi_config` |

---

## 1. Tareas

### T1 — Migración `0021_kpi_config` + seed (tamaño: M)

Tablas nuevas (nombres de columna en PascalCase como el resto del esquema):

- **`KpiDefinition`**: `KpiDefinitionId`, `KpiKey` (unique: `cobertura_skus`, `efectividad_visitas`, `penetracion_sueltos`, `pop_colocado`, `activaciones_promo`), `Name`, `Description`, `IsActive`.
- **`KpiConfig`**: `KpiConfigId`, `KpiDefinitionId` FK, `Weight` (int, %), `Target` (numeric, %), `ScopeType` (`global`/`zone`/`user`), `ScopeId` (nullable), `ValidFrom` (date), `ValidTo` (date, nullable), `CreatedByUserId`, `CreatedAt`. Índice `(ScopeType, ScopeId, ValidFrom)`.
- **`ScoringCoverageRule`**: `RuleId`, `Brand` (string), `ProductGroupJson` (ProductIds del catálogo que componen la marca, nullable), `Level` (`excelente`/`muy_bueno`/`bueno`/`regular`/`no_cuenta`), `MinSkus` (int), + columnas de scope/vigencia/auditoría iguales a `KpiConfig`.
- **`ScoringCommunicationRule`**: `RuleId`, `MaterialType`, `Level`, `Required` (bool) o `MinElements` (int para las filas de total), + scope/vigencia/auditoría.
- **`KpiMonthlySnapshot`**: `SnapshotId`, `UserId`, `Year`, `Month`, `KpiDefinitionId`, `Actual`, `Target`, `Weight`, `ScopeApplied`, `Achieved` (bool), `Numerator`, `Denominator`, `FrozenAt`. Unique `(UserId, Year, Month, KpiDefinitionId)`.
- **Alter**: `Route.IsFocus` (bool, not null, server_default true).

Seed (en la migración o script aparte `seed_kpi_config.py`): los 5 KPIs con pesos 30/10/10/30/20 y metas 80/90/50/70/40 como config `global` vigente desde el mes actual; rúbricas de la planilla "Ejecución" (§4 del diseño) como filas globales.

**Verificación:** `alembic upgrade head` sobre SQLite limpia **y** downgrade/upgrade; en Azure SQL solo upgrade (regla del repo: única vía de migrar).
⚠️ Recordar que la cadena Alembic está rota para bases nuevas (baseline 0001 vs 0002, detectado en dev) — la 0021 debe encadenar desde 0020 sin tocar ese problema; en dev se sigue usando `seed_db.py` + `create_all`, así que **los modelos nuevos deben importarse en `models/__init__.py`** para que `create_all` los cree.

### T2 — Motor de cálculo: `app/services/kpi_engine.py` (tamaño: L)

Primera capa de servicios del proyecto (hoy la lógica vive en routers; un motor de compensación no puede estar inline en un endpoint — lo referencian el endpoint en vivo, el snapshot y a futuro Mis objetivos).

Funciones puras respecto de la sesión de DB:

- `resolve_config(db, user_id, year, month) -> list[ResolvedKpiConfig]` — por KPI activo, la config más específica vigente al día 1 del mes consultado o la fecha actual si es el mes en curso (`user` > `zone` del usuario > `global`). Valida suma de pesos = 100 del set resuelto; si no cierra, marca `config_warning` en la respuesta (no rompe el cálculo).
- `focus_universe(db, user_id, year, month) -> set[pdv_id]` — PDVs en `RoutePdv` de rutas `IsFocus=true, IsActive=true, AssignedUserId=user_id`.
- `pdv_coverage_scores(db, user_id, year, month) -> dict[pdv_id, level]` — por PDV del universo: última `VisitCoverage` del mes por producto (`Works=true`), agrupada por marca según `ScoringCoverageRule` vigente → nivel. Sin relevamiento en el mes = `sin_relevar`.
- `pdv_communication_scores(...)` — ídem con `VisitPOPItem.Present` y `ScoringCommunicationRule`, con el requisito de foto (decisión §0).
- `compute_kpis(db, user_id, year, month) -> KpiResult` — los 5 numeradores/denominadores según la tabla §3 del diseño, `achieved` binario, variable = Σ pesos logrados. Mes cerrado → lee `KpiMonthlySnapshot` si existe; mes en curso → calcula en vivo y marca `partial: true, day: N/M`.
- `filter_price_outliers(prices) -> (validos, descartados)` — regla `[0.25×, 4×]` mediana por producto + exclusión de productos `TEST_%` / `IsOwn` según catálogo. Los descartados se devuelven con PDV/vendedor/fecha (para el listado de "precios sospechosos", consumido en fase 3).

Detalles de cálculo (contrato con el diseño §3):

| KPI | Numerador (SQL conceptual) | Denominador |
|---|---|---|
| 1 | PDVs del universo con `coverage_score >= bueno` | universo |
| 2 | PDVs con `Visit(Status=CLOSED, RouteDayId∈días del mes)` que tenga ≥1 `VisitCoverage` **y** ≥1 `VisitPOPItem` **y** ≥1 `VisitAction(DONE)` | PDVs planificados: `RouteDayPdv` de `RouteDay` del mes de rutas foco del usuario (distinct PDV) |
| 3 | PDVs del universo con ≥1 `VisitAction(canje_sueltos, DONE)` en el mes | PDVs del universo con `Pdv.SellsLooseCigarettes=true` |
| 4 | PDVs con `communication_score >= bueno` **y** foto POP | universo |
| 5 | PDVs del universo con ≥1 `VisitAction(promo, DONE)` en el mes | universo |

**Verificación:** tests unitarios (T6) — este módulo no se considera hecho sin ellos.

### T3 — Endpoints nuevos: router `app/routers/kpi.py` (tamaño: M)

Registrado en `main.py` con el patrón existente (`include_router(..., dependencies=_auth_dep)`), prefijo `/kpi`. Todos pasan por `visible_user_ids()`:

- `GET /kpi/variable?year&month&user_id?` — sin `user_id`: array con el resultado de cada usuario visible (admin: todos; TM: equipo; vendedor: él). Con `user_id`: valida pertenencia a visibles o 403. Respuesta por usuario: `{userId, name, partial, day, kpis: [{key, name, actual, target, weight, achieved, numerator, denominator, scopeApplied}], variableTotal, configWarning}`.
- `GET /kpi/pdv-scoring?year&month&user_id&route_id?&page&page_size` — por PDV: `{pdvId, name, route, coverageScore, communicationScore, lastVisit}` + agregado `scoreDist` (para el donut del prototipo). Paginado server-side (default 50).
- `GET /kpi/route-summary?year&month&user_id?` — por ruta foco: `{routeId, name, pdvs, planned, visited, effectiveness, actions, withMaterial, sellsLoose, withExchange}` (bloque `DD.rutas` del prototipo).
- CRUD de configuración (**solo admin**, `require_role`):
  - `GET /kpi/definitions` — lista KPIs (solo lectura; alta = desarrollo).
  - `GET/POST /kpi/config` + `DELETE /kpi/config/{id}` (cierre de vigencia, no borrado físico). POST valida suma=100 del set resuelto de los usuarios afectados → 422 con detalle si no cierra.
  - `GET/POST/DELETE /kpi/scoring-rules?type=coverage|communication` — mismas reglas de vigencia.
  - TM y vendedor: `GET /kpi/config/resolved?user_id` (solo lectura, scoped).

**Verificación:** Swagger manual con los 3 roles del seed + tests de permisos (T6).

### T4 — Fix de jerarquía en endpoints existentes (tamaño: S)

`/reports/product-analytics`, `/reports/supplier-analytics`, `/reports/form-times`, `/reports/avg-time-by-tm-pdv` hoy no filtran por `visible_user_ids()`. Aplicar el mismo patrón que usa `/reports/summary`. Es **corrección de seguridad previa** a exponer el tablero a vendedores.

**Riesgo de regresión:** el panel admin actual consume estos endpoints — para admin `visible_user_ids()` devuelve `None` (sin filtro), así que no cambia nada para ellos. Verificar con un smoke test logueado como vendedor (debe ver solo lo suyo).

### T5 — Snapshot de cierre (tamaño: S)

- `POST /kpi/close-month?year&month` (solo admin): calcula y persiste `KpiMonthlySnapshot` para todos los usuarios con rutas foco. **Idempotente**: si ya existe snapshot del mes, 409 (con `?force=true` lo regenera — solo mientras no se decida integrarlo a liquidación).
- Lectura: `compute_kpis` prefiere snapshot para meses cerrados (T2).
- Cierre automático (job programado) queda para fase 4; en fase 1 el cierre es manual por admin.

### T6 — Tests (tamaño: M)

`backend/tests/test_kpi_engine.py` + `test_kpi_router.py` con fixtures sintéticas (SQLite, patrón de los tests existentes). Casos mínimos:

1. Universo: ruta no-foco y ruta inactiva quedan fuera; PDV en dos rutas foco cuenta una vez.
2. KPI 1/4: PDV justo en el umbral "Bueno" (borde de rúbrica); PDV sin relevar no suma numerador pero sí denominador.
3. KPI 2: visita completa fuera de plan (`RouteDayId NULL`) no cuenta; visita planificada sin acción no cuenta; las 3 condiciones juntas sí.
4. KPI 3: denominador solo `SellsLooseCigarettes=true`; canje en PDV que no vende sueltos no suma.
5. KPI 4: sin foto no cuenta aunque el score dé Excelente.
6. Config: scope `user` pisa `zone` pisa `global`; vigencias que se pisan; suma ≠ 100 → 422 en POST y `configWarning` en cálculo.
7. Snapshot: mes cerrado devuelve snapshot aunque los datos crudos cambien; `close-month` idempotente.
8. Permisos: vendedor pide `user_id` ajeno → 403; TM ve su sub-árbol; endpoints T4 filtrados.
9. Outliers: precio 10× mediana descartado y presente en la lista de sospechosos; `TEST_*` excluido.

**Verificación global de la fase:** `pytest tests/ -v --tb=short` en verde (así corre en CI).

---

## 2. Orden y dependencias

```
T1 (migración+seed) ──> T2 (motor) ──> T3 (endpoints) ──> T6 (tests integración)
                          └──> T5 (snapshot, usa T2)
T4 (fix jerarquía) — independiente, puede ir primero (quick win de seguridad)
T6 (tests unitarios del motor) — se escriben junto con T2
```

Sugerencia de ejecución: **T4 → T1 → T2+T6a → T3 → T5 → T6b**. T4 primero porque es chico, independiente y cierra un hueco de seguridad ya presente en producción.

## 3. Riesgos y puntos de atención

- **Semántica de `RouteDayPdv.ExecutionStatus`**: solo se vio default `PENDING`; si la app mobile no lo actualiza, el KPI 2 debe apoyarse en `Visit.RouteDayId` + `Visit.Status=CLOSED` (como está planteado) y no en ese campo. Confirmar al implementar T2.
- **Convención real de foto POP**: decidir fuente primaria mirando qué escribe la app mobile (T2, decisión §0). Si escribe ambas, usar `VisitAction.PhotoTaken`.
- **Volumen**: `pdv_coverage_scores` recorre coberturas del mes de ~cientos de PDVs × ~55 productos por usuario. Para fase 1 alcanza con queries agregadas bien indexadas (índice existente en `VisitCoverage.VisitId`/`ProductId` — verificar); si el tablero agregado por admin (10 TMRs) resulta lento, cachear por (user, mes) con invalidación diaria — decisión diferida a medición real.
- **Offline-first**: nada de esta fase toca mutaciones mobile, no hay impacto en la cola offline.
- **La migración corre en prod vía `startup.sh`** (Alembic al deploy) — la 0021 debe ser segura sobre Azure SQL con datos (solo CREATE TABLE + ADD COLUMN con default, sin data-migration pesada).
