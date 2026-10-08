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

# PLAN: Material POP real (censo + colocación) — 2026-10-08, DEPLOYADO

**Fuente (relevada en comercial-nuevo-mobiliza)**: SDK Bejerman `TABLAS/ObtenerArticulos`, filtro código `MKT%` (185 arts, MKT-000xxx correlativos; viejos "(*)"/900+ afuera). Campos: código, descripción "MARCA - TIPO - AÑO", foto (`/imagenes/{nombre}` en espert-vm-1). Stock vía `STOCK/ObtenerStock`. Endpoint existente `/api/demo/catalogo` pide sesión vendedor → no sirve máquina a máquina.

**Decidido (usuario)**: censo Y colocación · colocación con cantidad · KPI comunicación solo Espert · competencia sigue genérica.

**Pasos**
1. **mobiliza**: `GET /api/public/material` con X-Api-Key (patrón `PatronesPublicController`) → MKT con código, descripción, línea, tipo (parseo corregido: medio unido " - "), año, foto URL, stock. Bejerman sigue en un solo lugar.
2. **trade backend**: tabla `PopMaterial` (Code PK, Description, Line, Type, Year, PhotoUrl, Stock, IsActive, SyncedAt). `POST /admin/pop-materials/sync` (admin o CRON_SECRET) + cron GH diario (patrón `behavior-report.yml`). Artículo que desaparece → IsActive=false (no borrar: histórico). `GET /pop-materials` para el front.
3. **Censo** (`VisitPOPItem`): + `MaterialCode` nullable. Sección Espert = buscador del catálogo (por línea/tipo, con foto) → agrego ítems presentes; competencia = lista genérica actual. Opción "Otro material Espert (viejo)" para piezas pre-MKT.
4. **Colocación**: tabla nueva `VisitPOPPlacement` (VisitId, MaterialCode, MaterialName, Quantity, Location, CreatedAt). Form de acción pop: N renglones artículo + cantidad; foto sigue en VisitAction. Sigue escribiendo Description (compat).
5. **KPI**: `kpi_engine` 481-510 + `tmr_dashboard` 355-364 → contar solo Company Espert.
6. **Offline**: catálogo con `fetchWithCache`; colocación por la cola (`executeOrEnqueue`).
7. **Prod DDL**: prod no está trackeado por Alembic → migración Alembic + script ALTER/CREATE quirúrgico, correr antes del deploy backend.
8. **Reporte**: colocaciones por artículo / trade / PDV / fecha (admin), export Excel.
9. Tests backend (sync, censo, colocación, KPI solo Espert) + E2E mobile local contra prod DB.

**Decisiones 08/10**: KPI solo Espert desde OCTUBRE · catálogo: todos (185) en censo y colocación · sync vía endpoint mobiliza · cruce colocado vs retirado → fase 2.

**Estado 08/10**: implementado en las 3 partes, sin commit. Tests: trade back 661 · front 212 · mobiliza 276. Review independiente: 6 fixes aplicados (nombre >80, legado Espert ausente, borrar acción encolada, sync parcial, KPI4 foto solo Espert desde oct, key timing-safe). E2E local (SQLite + mobiliza fake): censo con código, colocación 2 artículos con cantidad, reporte admin, sync OK.

**Deploy (orden)**
- [x] 1. mobiliza (c903c0f): commit+push main · secret `material-apikey` + env `Demo__MaterialApiKey` en ca-comercial-prod · probar `GET /api/public/material` con datos reales
- [x] 2. trade prod DB: `backend/scripts/ddl_pop_materials_20261008.py --dry-run` → real (ANTES del backend)
- [x] 3. trade App Service: `COMERCIAL_API_URL`, `COMERCIAL_MATERIAL_API_KEY`
- [x] 4. trade: commit (34a2f38 + fix ed31d59: AuditEvent.EntityId es INT en prod)+push main (backend + front)
- [x] 5. 185 artículos cargados 08/10 19:11 · `POST /pop-materials/sync` (botón admin o workflow) → verificar 185 artículos

---

# PLAN: Proveedor con vendedores (2026-10-07) — APROBADO, en curso

**Problema**: no existe entidad proveedor. `PdvSupplier` = fila por PDV con Name+Phone; identidad = teléfono. Un proveedor real con 5 vendedores → 5 "proveedores". NOA: 87 "proveedores" ≈ 15-20 reales; teléfonos truchos (381, 3814…) para pasar campo obligatorio.

**Modelo nuevo**
- `Supplier`: SupplierId, Name, ZoneId, SupplierTypeId, Products, IsActive, CreatedBy/At.
- `SupplierSeller`: SupplierSellerId, SupplierId, Name, Phone (opcional), IsActive.
- `PdvSupplier` (vínculo PDV↔proveedor): + `SupplierId`, + `SupplierSellerId` (nullable = qué vendedor lo atiende). Name/Phone quedan por compatibilidad durante la transición.

**Backend**
- [ ] Modelos + migración alembic 0026 + script DDL prod (prod no está trackeado por alembic, lo corrés vos).
- [ ] Endpoints: buscar proveedores de zona por nombre (con vendedores); POST atómico "vincular a PDV" que crea proveedor/vendedor si no existen (evita mapa de IDs temporales offline); ABM vendedores; unificar 2 proveedores (admin/TM).
- [ ] Inteligencia (`build_suppliers`), `/reports/supplier-analytics`, detalle de visita, `export_dashboard_data.py`: agrupar por SupplierId en vez de teléfono.
- [ ] Auditoría (estándar AuditLog): alta/edición/unificación de proveedores y vendedores.

**Frontend**
- [ ] Censo (`SupplierCensusPage`): 1) buscar proveedor por nombre → 2) elegir vendedor o "+ agregar vendedor" (nombre + tel opcional) → o "+ proveedor nuevo". Teléfono deja de ser obligatorio.
- [ ] Offline: nuevo kind de cola para el POST atómico; cache de proveedores de zona con vendedores.
- [ ] Admin: pantalla Proveedores (lista por zona, vendedores, unificar duplicados).
- [ ] Inteligencia / VisitDataExplorer: mostrar proveedor → vendedor.

**Migración de datos (prod)**
- [ ] Script con backup JSON: agrupar filas actuales por nombre normalizado (sin tildes, minúsculas, k/c, typos) por zona → 1 Supplier; cada teléfono distinto → 1 SupplierSeller ("sin nombre" hasta que lo completen); teléfonos < 8 dígitos → descartar tel.
- [ ] Excel por zona para que el TM confirme agrupaciones dudosas (ej. Paoletti/Psoleti, Deiana/Deiana distribuciones) antes de aplicar.

**Verificación**: pytest + vitest + build + Playwright local (censo online/offline, unificar, Inteligencia) + dry-run de migración contra copia de datos NOA.

## Preguntas abiertas
1. Proveedor ¿por zona o global (mismo mayorista atiende 2 zonas)?
2. Vendedor: ¿teléfono obligatorio?
3. En el PDV ¿se registra el vendedor puntual que lo atiende, o solo el proveedor?
4. Tipo (mayorista/distribuidor…) y productos: ¿del proveedor o por PDV?
5. ¿Quién unifica/edita proveedores: admin, TM, ambos?
6. `Distributor` (campo distribuidor del alta PDV, sistema paralelo): ¿lo unificamos con esto o queda aparte?
7. "Espert" cargado como proveedor: ¿se permite o se excluye?

## Decisiones (2026-10-07)
1. Proveedor **por zona**. 2. Vendedor: nombre obligatorio, teléfono opcional. 3. PDV → proveedor (principal) + vendedor opcional. 4. Tipo y productos **del proveedor**. 5. Unificar/editar: **solo admin**. 6. `Distributor` **es lo mismo** → unificar (fase 2, ver abajo). 7. "Espert" permitido.

## Fase 2: absorber `Distributor`
- `PDV.DistributorId` + `PdvDistributor` (alta/edición PDV, filtros POSManagement, paso obligatorio "Proveedor de cigarrillos" en visit_indicators) → pasar a `Supplier`.
- Distributor no tiene zona → tomarla de sus PDVs.
