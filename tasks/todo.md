# Rutas de campaña + fecha de fin de ruta

> Plan anterior (reporte por mail, commits a878767…1c669d7) está en el historial de git.

## Pedido (2026-09-30)
1. **Rutas temporales** para acciones puntuales (ej. verano): pueden usar PDVs que ya están en otra ruta, se asignan a cualquier trade aunque no sea el dueño del PDV, sin desarmar las rutas existentes. Las crea Rodrigo y roles similares.
2. **Fecha de fin** en cualquier ruta (en la card "Frecuencia" del editor).

## Nombre propuesto: **"Ruta de campaña"**
Alternativas: "Ruta especial", "Ruta de acción", "Ruta temporal". "Campaña" transmite temporal + objetivo puntual, y no se confunde con "Ruta Foco".

## Cómo funciona hoy (exploración)
- Exclusividad PDV↔ruta: solo app, `routes.py:792-812` (`add_route_pdv` → 409 "El PDV ya está asignado a la ruta X"). Sin constraint en DB. El editor marca "En otra ruta" vía `GET /routes/pdv-assignments`.
- "Dueño" del PDV = `PDV.AssignedUserId`: `add_route_pdv` lo pisa con el trade de la ruta (`routes.py:820`), `update_route` lo propaga al reasignar (`698-706`). Define visibilidad, cartera de Inteligencia y "trade" en KPIs.
- Visibilidad (`hierarchy.visible_pdv_ids`): PDVs cuyo dueño es visible **∪** PDVs de rutas asignadas a usuarios visibles → una ruta asignada a Jaimito ya le hace ver esos PDVs.
- `POST /visits` no valida ruta; `_resolve_route_day_id` engancha la visita al RouteDay del día si el PDV está en su plan.
- RouteDays se generan **en el front** (`RouteEditorPage.handleGenerateDays` + copia en `MyRouteEditorPage`), 8 semanas, desde `FrequencyConfig.startDate`. Backend: `POST /routes/{id}/days`; `update_route` borra días PLANNED futuros si cambia frecuencia.
- KPI/TMR/Inteligencia usan rutas **foco** y "primera ruta gana" por PDV (`kpi.py route_by_pdv`, `tmr_dashboard.load_context`, `intelligence.build_map`).
- Rodrigo (121) es **admin**. Roles: vendedor 1 · ejecutivo 2 · territory_manager 3 · regional_manager 4 · admin 5.
- Bug aparte encontrado: frecuencia **"mensual"** se ofrece pero no genera días.

## Diseño

### Datos (migración 0025 + hotfix prod)
- `Route.RouteType NVARCHAR(20) NOT NULL DEFAULT 'regular'` — `regular` | `campaign`.
- `Route.EndDate DATE NULL` — sirve para las dos (campaña: obligatoria).
- (Inicio ya existe: `FrequencyConfig.startDate`.)

### Backend
- [x] `add_route_pdv`: exclusividad **solo entre rutas regulares activas** (una campaña no bloquea ni es bloqueada). En campaña **no** se toca `PDV.AssignedUserId` (el dueño sigue siendo Carlos).
- [x] `update_route`: al reasignar una campaña no se propaga `AssignedUserId` a los PDVs.
- [x] Permisos campaña: crear/editar/asignar = roles habilitados (ver pregunta 1); pueden asignar a **cualquier** trade (sin restricción de sub-árbol) y usar **cualquier** PDV activo.
- [x] Campañas: `IsFocus = False` forzado → fuera de KPI/TMR/cartera (ver pregunta 3).
- [x] Fecha fin (todas las rutas): `POST /routes/{id}/days` rechaza fechas > `EndDate`; al acortar `EndDate` se borran días PLANNED posteriores. Validación `EndDate >= startDate`.
- [x] Vencidas (`EndDate < hoy`): no aparecen en "Mis rutas" ni dan visibilidad de PDVs (se excluyen en `visible_pdv_ids` las **campañas** vencidas); quedan en historial/admin como "Finalizada".
- [x] `GET /routes/pdv-assignments`: devolver tipo de ruta para que el editor distinga "en ruta regular de Carlos" (informativo en campaña, bloqueante en regular).
- [x] Auditoría: registrar alta/edición/asignación/borrado de rutas de campaña (hoy las rutas no se auditan). Ver pregunta 5.
- [x] Tests: exclusividad (regular↔regular 409; campaña↔regular OK), dueño intacto, visibilidad del trade de campaña (ve durante, no después), permisos, días > EndDate rechazados, recorte de días al acortar fin, KPI sin campañas.

### Frontend
- [x] Gestión de rutas: filtro/pestaña **Regulares / Campañas**; badge "Campaña · hasta dd/mm" y "Finalizada".
- [x] Editor: selector de tipo al crear (solo roles habilitados); en campaña, buscador de PDVs sin exclusividad (muestra "en ruta X de Carlos" como dato) y selector de trade con **todos** los vendedores.
- [x] Card **Frecuencia**: campo **"Fecha de fin"** (opcional en regular, obligatorio en campaña) + generación de días que corta en la fecha fin (RouteEditorPage y MyRouteEditorPage).
- [x] App del trade: la campaña aparece en Mis rutas / Hoy con badge "Campaña".

### Verificación
- [x] pytest + vitest + build + Playwright local (SQLite): Rodrigo crea campaña con PDV de Carlos, la asigna a Jaimito; Jaimito ve y visita el PDV; Carlos sigue viéndolo y sigue siendo dueño; vence → Jaimito deja de verlo; ruta regular con fecha fin no genera días después.
- [x] Hotfix DDL prod (lo corrés vos con `!`) ANTES del deploy backend.

## Decisiones (2026-09-30)
1. Campañas: **solo admin**. 2. Nombre "Ruta de campaña". 3. Visitas de campaña **fuera** de KPI/TMR. 4. Carlos sigue con su ruta. 5. Auditoría en `AuditEvent` para todas las rutas (ROUTE_CREATE/UPDATE/DELETE/PDV_ADD/PDV_DEL, antes/después). 6. Mensual = mismo día del mes que el inicio (último día si el mes es más corto).
- Extra: ruta con fecha de fin vencida = inactiva en todo (`route_is_live()` reemplazó 25 filtros `IsActive == True` en KPI/TMR/Inteligencia/reportes/visibilidad).

## Resultado
- pytest 601 OK (13 nuevos `test_route_campaign.py`), vitest 150 OK (11 nuevos `routeDays.test.ts`), build OK, Playwright local 16/16.
- Generación de días unificada en `lib/routeDays.ts` (antes 3 copias; "mensual" no generaba en edición, alta no alineaba quincena).
- **Deploy**: correr `hotfix_route_campaign_prod_20260930.py` en prod ANTES del push (sin columnas → 500 en todas las rutas).

## Preguntas abiertas
1. **Quién crea campañas**: Rodrigo es **admin**. ¿Solo admin, o también regional_manager / territory_manager?
2. **Nombre**: ¿"Ruta de campaña" ok?
3. **KPIs**: las visitas de campaña, ¿cuentan para el tablero TMR / Mi gestión del trade que las hace? (propongo **no**: campaña fuera de foco; sí aparecen en Comportamiento y en el reporte por mail).
4. **Dueño original (Carlos)**: durante la campaña, ¿sigue visitando esos PDVs en su ruta normal? (propongo **sí**, no se toca su ruta).
5. **Auditoría**: el nuevo estándar pide tabla `AuditLog` (DNI, antes/después). ¿Acá solo rutas con lo que ya existe (`AuditEvent`), o el estándar completo como tarea aparte?
6. **Bug "mensual"** (no genera días): ¿lo arreglo en el mismo paquete? ¿"mensual" = mismo día del mes (ej. cada 15) o 1er lunes del mes?

---

# TODO: Material POP genérico → artículos reales de Bejerman (anotado 2026-10-07, en análisis)

**Hoy**: censo POP (`VisitPOPItem`, `POPCensusPage.tsx`) usa lista fija genérica: primario (Cigarrera aérea/espalda, Pantalla/Display, Otro), secundario (Móvil/Colgante, Stopper, Escalerita, Exhibidor, Afiche, Otro). `MaterialName` texto libre 80 chars.

**Objetivo**: que el trade elija los artículos reales de material POP que manejamos en Bejerman (código + descripción), no un genérico.

**Fuente ya resuelta en comercial-nuevo-mobiliza** (`/material` en ca-comercial-prod):
- `MaestrosBejermanService.ObtenerCatalogoAsync`: SDK Bejerman `TABLAS/ObtenerArticulos` → filtra `EsMarketing` → rubro `MKT`.
- Clave `Art_CodGenerico`, nombre `Art_DescripcionGeneral`; `ParsearDescripcionMkt()` saca **Línea** (Espert Box, King Size, Institucional…) × **TipoMaterial** (Afiche, Exhibidor, Calco, Señalética…).
- Doc: `comercial-nuevo-mobiliza/docs/bejerman/analisis-npm-marketing.md`.

**A pensar / decidir**:
- [ ] Cómo traer el catálogo: ¿consumir API de comercial (endpoint catálogo MKT) o sync propio a tabla `PopMaterial` (código, desc, línea, tipo, activo)? Propuesta: sync diario a tabla local (censo es offline-first, no depender de otra API en campo).
- [ ] Mapeo tipo Bejerman ↔ primario/secundario actual.
- [ ] Material de la competencia (Massalin/BAT/TABSA): sigue genérico (no está en Bejerman). ¿Solo Espert pasa a catálogo?
- [ ] `VisitPOPItem`: agregar `MaterialCode` (nullable) manteniendo `MaterialName` → histórico compatible; KPI/Inteligencia (`kpi_engine`, `tmr_dashboard`, `intelligence`) leen `MaterialName` — revisar.
- [ ] ¿Cantidad por material? ¿cruzar con lo retirado por el vendedor (NPM) para ver dónde terminó el material?
