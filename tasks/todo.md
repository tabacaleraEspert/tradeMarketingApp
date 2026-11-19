# Vista gerencial — tiempo de carga + orden por columna (2026-11-19) — COMMIT LOCAL, FALTA PUSH

Medido en prod (App Insights, 19/11 12:29 UTC): primera carga `universo` 46,6 s + `equipo` 52,2 s; segunda 0,2 s + 2,2 s. Causa: la base S0 quedó al 100% de CPU un minuto. La consulta de cobertura corrió 3 veces en paralelo (una por solapa y por worker; el cache era por worker) y a la vez corría el censo de Inteligencia, porque a la vista se entraba pasando por esa página. Cada consulta usa ~0,5 s de CPU; sola tarda segundos, compitiendo tarda decenas.

- [x] Back: datos por mes (`MonthData` / `load_month_data`), los builders ya no consultan la base. Cache por mes, compartido entre los 4 workers (`utils/shared_cache.py`: archivo en tmp + flock, TTL 30 min). Sumar un mes calcula solo ese mes; zona / rep / sacar un mes = 0 consultas.
- [x] Back: `GET /intelligence/gerencial/resumen` (universo + equipo en un pedido). `filters` usa la base cacheada.
- [x] Front: un solo pedido, sin espera de 300 ms en la primera carga, entrada "Vista gerencial" en el menú lateral (no pasa por Inteligencia).
- [x] Tests: back 11 nuevos (suite 779 ok) · front 271 ok + build. Prueba con 4 procesos reales: 1 solo cálculo.
- [x] Contra prod (solo lectura, `scratchpad/tools/profile_new.py`): mismos números; repetir / filtrar / otro worker / sacar un mes 0,01 s y 0 consultas; frío 37 consultas en una pasada.
- [x] Revisión independiente → corregido: pedidos ya cacheados y `filters` no esperan detrás de un cálculo en frío (camino rápido sin lock), espera del lock con tope de 45 s, memoria del cache con purga y tope, carpeta del cache verificada como propia, aviso de disco una sola vez. Aceptado: actividad del equipo ahora puede tener hasta 30 min de atraso (antes era al instante).
- [x] Orden por columna en las tres tablas (`sort.ts` + `SortTH`): vacíos siempre al final; verificado en Chrome sobre SQLite sembrada.
- [x] Modal de detalle en las 4 tarjetas de Universo (Rutas foco, TM Reps activos, PDV por ruta, PDV por TM Rep): listas `rutasDetalle` / `repsDetalle` en la respuesta de universo (del cache, sin consultas), tablas ordenables. Verificado en Chrome, escritorio y celular.
- [x] Fix: la carpeta del cache lleva la huella del código (`gerencial.cache_version`); un pickle con la forma vieja daba 500 (pasó en local).
- [ ] Medir de nuevo en App Insights cuando alguien abra la vista.
- [ ] Propuesta (DDL en prod, falta OK de Davor): índice `VisitCoverage(VisitId) INCLUDE (ProductId, Works, …)`. Hoy la consulta de cobertura escanea la tabla entera (537 mil filas, 38 MB) aunque se pida un mes.
- Firewall: regla `DavorLocal5` (181.169.19.234) agregada el 19/11; siguen `DavorLocal3` y `DavorLocal4`.

---

# Vista gerencial en Inteligencia — etapa 1 (2026-11-17) — COMMIT LOCAL, FALTA PUSH

Plan: `~/.claude/plans/precious-soaring-hammock.md`. Fuente: PDF "Inteligencia Comercial · capturas" + PPTX "Tablero TM". Sección nueva `/inteligencia/gerencial` (solo admin); la Inteligencia actual no cambia salvo el rename "PDVs activos" → "Rastrillado".

Definiciones (Davor, 17/11): embudo acumulado Rastrillado (PDVs activos) → En ruta foco → Visitados (≥1 visita cerrada en el período) → Efectivos (cobertura Regular o más + POP Regular o más en el mismo mes, sin exigir acción). Rúbrica: la configurable de la app. NO toca el variable (`kpi_engine`). Sin filtro Provincia (no hay dato).

- [x] Back: `services/gerencial.py` (filtros, universo, equipo) + `services/user_activity.py` (conteo de movimientos compartido con `/audit/active-users`) + 3 endpoints `/intelligence/gerencial/*` con cache 30 min.
- [x] Front: `pages/inteligencia/gerencial/` (filtros País/Área/TM Rep/meses, solapa Universo con embudo y tabla por área, Performance de equipo con Actividad y Ejecución en PDV, color por terciles) + ruta + botón en Inteligencia + rename.
- [x] Tests: back 29 nuevos (suite 768 ok) · front 7 nuevos (270 ok) + build.
- [x] Revisión independiente → corregido: con rep elegido la zona ya no recorta (Universo y Equipo daban distinto), PDV en rutas foco de dos reps cuenta para ambos, cache por combinación de meses (antes re-escaneaba cobertura y POP en cada cambio de filtro, dos veces), plan hasta hoy, `months` fuera de rango daba 500, zona/rep inválidos en la URL, foco visible en filas. Sin re-capturar pantallas después de estos cambios (tests + build ok).
- [x] E2E Playwright local sobre SQLite sembrada: escritorio y celular, clic en área / rep aplica filtro, preflight CORS OK, 0 errores de consola.
- [x] Verificado contra prod (solo lectura, sonda `scratchpad/tools/probe_gerencial.py`), Sep+Oct+Nov al 17/11: rastrillado 9.946 (prototipo 9.859), en ruta foco 4.224 (4.189), visitados 3.096, efectivos 1.046 (33,8%), realizadas 10.497 (10.363), planificadas 22.599 (21.966), duración 15 min. Rutas foco 152 con PDVs (el 94 del prototipo era "Ejemplo").
- [x] Performance: la cobertura se consolida en SQL en una sola pasada (antes 96 mil filas a Python, 17 s). En frío ~10 s desde la notebook por combinación de meses (cache 30 min por worker); cambiar área o rep no vuelve a la base para el embudo; Equipo ~3 s.
- [x] Firewall Azure SQL `trade-mkt-sql`: reglas `DavorLocal3` (181.0.24.137) y `DavorLocal4` (190.30.144.140) agregadas el 17/11.
- [ ] No visto en navegador con datos de prod (no tengo login real); solo con SQLite sembrada.
- [ ] Etapa 2: Performance de marcas, Producto, subsolapas Cobertura / Categorización / Variable mensual.

Preguntas abiertas: nómina (¿activadores, Riccardi, "Usuario prueba"?) · días hábiles (hoy L–V menos tabla Holiday) · acceso de managers · Vlank en Producto.

---

# Explotación de datos v2 — Asistente "Puchi" (2026-11-17) — EN PROD 17/11 (553b9a5)

Plan: `~/.claude/plans/stateless-cooking-key.md`. Patrón Bachi/RRHH portado a FastAPI+React. OpenAI gpt-5.2 (misma key que RRHH/Horeca) · FAB en todo el admin · solo admin · solo lectura.

- [x] Back: `app/services/assistant/` (provider, openai_provider, loop, compact, prompt + conocimiento/*.md, 13 tools, turnlog) + router `/assistant` (status, ask SSE, usage, purge) + modelos + Alembic 0029 + `scripts/ddl_assistant_20261117.py` + sonda `scripts/assistant_probe.py`.
- [x] Front: `lib/api/assistant.ts` (SSE) + `components/assistant/` (avatar SVG cigarrillo con ojos, FAB, panel, markdown con tablas, hook) + `/admin/asistente-uso` + menú "Uso de Puchi".
- [x] Tests: back 41 nuevos (suite 738 ok) · front 27 nuevos (263 ok) + build.
- [x] Verificado con uvicorn real y proveedor guionado: preflight CORS, SSE en chunks, desconexión a mitad (turno queda "cancelado", deja de gastar), E2E en Chrome front+back (etiqueta de tool → texto parcial → final, panel de uso).
- [x] Revisión independiente del backend → corregido: turno del asistente envenenaba el caché del censo de Inteligencia (fix: `db.expunge` en `load_census` + sesión de auditoría separada; test de regresión), conteos de oportunidades con tope 5000, presupuesto del cierre invertido, vuelta de más tras "SIN TIEMPO", tope 6 tools/vuelta, rango máx 92 días, volátil después del historial (caché), catch-all del stream.
- [x] Llamada real a OpenAI probada (sonda local y contra DB prod: 4 preguntas, ~US$ 0,01 c/u, caché del prompt ok).
- [x] Go-live 17/11: push (Davor) · DDL en prod · `OPENAI_API_KEY` en `espert-trade-api`.
- [ ] Davor: probar en el navegador (botón, una pregunta, panel "Uso de Puchi").
- [x] Probado en Chrome contra DB prod + OpenAI real (3 preguntas, sin errores de consola).
- [x] Censo frío (~95 s, cortaba la 1ª pregunta): `POST /assistant/warm` al abrir el panel + panel ancho para tablas — commit `3408aac`.
- [ ] Tras el deploy de `3408aac`: medir la 1ª pregunta en frío en prod.

Pendientes conocidos: la conversación se pierde al pasar entre `/admin/*` e `/inteligencia` (cada guard remonta `AdminLayout`; haría falta un store a nivel módulo) · rate limit es check-then-insert (carrera acotada, solo admin; sin presupuesto diario global) · fase 2 de tools: POP colocaciones → matriz de precios → respuestas de formularios · gobernanza: nombres de PDVs/trades/contactos viajan a OpenAI (teléfonos, mails, DNI y fotos no).

---

# Traspaso masivo de cartera entre trades (2026-11-12) — DEPLOYADO (26c76fe + b410f6c)

Pedido (audio 12/11): migrar cartera completa o parcial de un trade a otro sin armar rutas foco ni ir PDV por PDV. Solo admin.

- [x] Backend `POST /routes/transfer-portfolio` (admin): `from_user_id` = cartera completa (rutas regulares + días PLANNED futuros + PDVs) · `pdv_ids` = parcial (cambia dueño, saca de rutas regulares ajenas al destino y de sus días futuros PENDING) · `dry_run` default · campañas intactas · auditoría ROUTE_UPDATE / ROUTE_PDV_DEL + resumen PDV_TRANSFER (dueño anterior por PDV).
- [x] Backend `GET /pdvs/admin-ids` (admin): ids de todos los PDVs filtrados (tope 5000); filtros de Gestión factorizados en `AdminPdvFilters` / `_admin_pdv_query`.
- [x] Front Gestión PDV (solo admin): checkbox por PDV, "Esta página" / "Los N filtrados", "Pasar a otro trade", botón "Traspasar cartera"; `PortfolioTransferModal.tsx` con resumen previo.
- [x] Tests `tests/test_transfer_portfolio.py` (5) · suite 693 ok · front 234 ok + build · E2E Playwright local SQLite (parcial, todos los filtrados, completa) · dry-run contra DB prod (Trica 140: 807 PDVs, 11 rutas, 20 días; 2 s).
- [x] Commit + deploy (push lo hace Davor con `! git push origin main`; a Claude se lo bloquea el classifier).
- [ ] Primer traspaso real en prod (Rodri): hacerlo chico.

# Cambios 12/11 (tarde) — DEPLOYADOS
- [x] 767bb31: manager del equipo edita rutas de campaña de sus subordinados (`_assert_campaign_rules`); crear/borrar sigue solo admin. Afecta también a Nahuel (La Plata). Sin verificar en prod con usuario de Santiago.
- [x] 1fa3149: Gestión PDV › celda "Ruta" → `PdvRouteModal` → `POST /routes/move-pdv` (TM+): cambia de ruta regular, toma el trade de la ruta, re-optimiza origen y destino (`_optimize_route_order`, pisa orden manual; días ya iniciados no). Auto-optimizar NO corre en editor de rutas ni en traspaso masivo.

# Excel consolidado en Censos y Respuestas (2026-11-12, pedido Nahuel) — DEPLOYADO (e88b27a)
- [x] `GET /visits/answers-export` (mismos filtros/jerarquía que `/visits`, tope 5000 visitas, columna por FormId+KeyName, opciones valor→etiqueta).
- [x] Front: botón "Descargar Excel" en `VisitDataExplorer` → `lib/visitAnswersExport.ts`: hojas Visitas / Por vendedor / Por vendedor y día (suma numéricas, cuenta "Sí", cuenta por opción).
- [x] Tests back + front, build, lectura contra prod como Nahuel (415 visitas nov, 10 s). Sin probar el click en navegador.

# PLAN: Ruteo cadenas 24h AMBA (2026-10-30 → 2026-11-11) — CARGADO EN PROD 11/11

**Fuente**: `~/Downloads/Ruteo.xlsx` (maestro 739 PDVs / 12 cadenas, sin nombre de local) y `~/Downloads/Ruteo Davor.xlsx` (hoja `Detalle rutas`: 18 rutas, 4 semanas, 456 filas con Orden). Plan "sin Open 25" (Open 25 se está cerrando → no se importa).

**Decisiones Santiago Gallastegui 02/11** (solicitante): recorre **Martín Damián Riccardi** (todavía no está en la app, sin mail) · semana 1 = lun **16/11/2026** · canal **Convenience › subcanal "Key Accounts/Cuentas Claves"** (el script lo crea si no existe) · **sin zona nueva**: cada PDV en su zona geográfica (por coords todos caen en AMBA; usuario y rutas → AMBA) · sacar los 3 repetidos (ninguno aeropuerto) → 453 PDVs · EndDate default = vie 11/12 (fin semana 4; día 18 cae mié 9/12).

**Script** `backend/scripts/import_cadenas_api.py` (reusa `Api`/`login`/`norm` de `import_laplata_api.py` + `app.utils.geo_zones`): subcanal Key Accounts en Convenience (crea si falta) → zona mayoritaria por coords (AMBA, debe existir) → usuario (`--user email:Nombre`, vendedor, `--visit-flow full|short`, manager `--manager-email`) → 18 rutas campaña `Cadenas D01 - <Ruta>` (IsFocus=False, EndDate, ZoneId AMBA) → 453 PDVs `Code CAD-<día>-<nnn>`, Name `<Cadena> - <Dirección>`, sin ZoneId en el POST (el server zonifica por coords), `RoutePdv.SortOrder` = orden del Excel renumerado → 1 RouteDay por ruta lun-vie desde `--start` (POST /routes/{id}/days copia PDVs al día). `--check-existing` reporta PDVs de la app a <40 m (dedup vs rutas de trades). Idempotente (dry-run → `--commit` → re-run = 0 a crear).

- [x] 1. Parser + limpieza (453 únicos, 3 repetidos descartados, coord texto "\t-34,6064892" → float, "365" numérico → texto).
- [x] 2. Script import + RouteDays. E2E local 02/11 (SQLite seed + zona AMBA + uvicorn 8012), 2 corridas (v1 zona Cadenas, v2 con correcciones de Santiago): 18 rutas campaign/IsFocus=false/EndDate 11/12 zona AMBA asignadas · subcanal creado en Convenience · 453 PDVs ZoneId AMBA (zonificados por el server) canal Convenience/Key Accounts · orden 1..n sin huecos en las 18 · 18 RouteDays 16/11→9/12 PLANNED con sus PDVs copiados · usuario vendedor full zona AMBA · re-run 0 creados 0 errores · ~3 s sin throttle.
- [x] 3. Prod dry-run 02/11 (token admin pasado por Davor; esta vez prod NO estuvo bloqueado para lectura): canal Convenience (9), subcanal a crear, zona AMBA (18), 8984 PDVs con coords. **82 de las 453 ya existen** como PDVs de trades (misma cadena a <40 m) → se agregó lógica de REUSO al script (`CHAIN_PATTERNS` por cadena, nearest sin repetir; `--no-reuse` para crear todo): 371 a crear + 82 reusados. Probado local (idempotente). Log `backend/scripts/cadenas_import_prod_dry.json`.
- [ ] 4. Prod `--commit` cuando Davor confirme: reuso de los 82 · mail de Martín (provisorio `mriccardi@espert.com.ar`) · manager (provisorio davor@) → verificar por API → prueba en celu.
- [ ] 5. Decidir visita completa vs corta (+ formulario). Hoy default `--visit-flow full`, sin RouteForm.

**Comandos prod** (desde backend/, token admin del front: localStorage.getItem('espert.access_token')):
```
python scripts/import_cadenas_api.py "~/Downloads/Ruteo Davor.xlsx" --api https://espert-trade-api.azurewebsites.net --token <TOKEN> --user "<mail>:Martín Riccardi" --manager-email <supervisor> --start 2026-11-16 --check-existing --log scripts/cadenas_import_prod_dry.json
**PROD 11/11 (hecho)**: Santiago Gallastegui user 149 (territory_manager, santiagog@tabacaleraespert.com, manager Rodrigo 121) · Martín Riccardi user 150 (vendedor full, mriccardi@espert.com.ar provisorio, manager 149) · subcanal Key Accounts 62 · rutas 380-397 · 371 PDVs CAD-* creados + 82 reusados = 453 · 18 RouteDays 16/11→9/12. Run1 tuvo 7 fallas de red (API prod lenta, ~4 s/PDV); run2 completó. Log consolidado `backend/scripts/import_cadenas_prod_20261111.json`. Rollback/desacople: `backend/scripts/rollback_cadenas_api.py <log> --api … --token … [--keep-pdvs] [--keep-user] [--commit]` (solo dry-run probado). Pendiente: DNI de Martín (padrón externo), mail real, feriados 23/11 y 7-8/12.

# defaults: --channel Convenience --subchannel "Key Accounts/Cuentas Claves" (se crea si falta) --visit-flow full --end-date 2026-12-11
# si OK: mismo comando + --commit --log scripts/import_cadenas_prod_<fecha>.json
```

---

# PLAN: Activación La Plata — "Lo de Pucho" (2026-10-19) — EN CURSO

**Pedido**: 2 activadores (Christian / Pablo; hasta tener mails: `activadorU`, `activadorD`) recorren 549 PDVs del distribuidor **Lo de Pucho** en Gran La Plata hasta el **23-dic-2026**. Puntos ya mapeados (Excel con lat/lng, 18 zonas + 43 "sin zona"). Supervisa el solicitante. Quieren "formulario con ruteo", sin la visita completa de 7 pasos.

**Fuente**: `Puntos de venta por zona - La Plata_2 FINAL.xlsx` (hoja `Todos`: Zona, Punto de venta, Dirección (mapa), Dirección original, Barrio, Localidad, Observación, Estado, Zona más cercana, Lat, Lng). 549 filas, 100% con coords, 0 nombres repetidos, 1 fila basura ("ESTE NOOOO"). Activador por zona en el header de cada hoja de zona (CHRISTIAN: 01-07, 11, 19 · PABLO: 08, 10, 12, 13, 15-18, 20).

## Diseño (reusa la app de trade, sin app nueva)
- **Zona** `La Plata` (1 sola; las 18 "zonas" del Excel son **rutas**). OJO: `create_pdv` re-zonifica por coords (`geo_zones._BOXES` → "AMBA") → el script hace PATCH ZoneId después del POST.
- **Distribuidor** `Lo de Pucho` (`Distributor`) → `PDV.DistributorId`.
- **Usuarios** `activadoru@espert.com.ar` / `activadord@espert.com.ar`, rol `vendedor`, zona La Plata, manager = supervisor, pass inicial `Espert2026!` + MustChangePassword, **VisitFlow = short**.
- **19 rutas de campaña** (`RouteType=campaign`, `EndDate=2026-12-23`, `IsFocus=false`): 18 zonas asignadas a su activador + "Fuera de ruta" (43 PDVs, sin asignar: la completa el supervisor). PDVs con `Code = LP-<zona>-<nnn>`. Sin RouteDays (los planifica el supervisor desde el editor o usan "cerca mío").
- **Formulario** "Activación La Plata" vinculado a las 19 rutas (`RouteForm`), 11 preguntas (ajustado 16:24 por audio): 1 ¿Tiene productos Espert? (radio sí/no, req) · 2 ¿Qué cigarrillos Espert tiene? (checkbox showIf 1=si: catálogo `Product.IsOwn` + Cigarrillos, todas las versiones) · 3 ¿Tiene Van Kiff? (radio showIf 1=si) · 4 ¿Tiene Lebonn? (radio showIf 1=si) · 5 ¿Le pudieron vender? (radio sí/no, req) · 6 ¿Qué promo? (checkbox showIf 5=si: Promo Bold / Promo Milenio) · 7 Precio acordado (checkbox_price showIf 5=si: Bold / Milenio) · 8 Foto comunicación (photo) · 9 Nombre del encargado (text) · 10 Horario del encargado (text) · 11 Observación / ayuda memoria (textarea).
- **Visita corta** (`User.VisitFlow` = `full`|`short`): check-in → formulario → resumen. En short, el formulario muestra SOLO los forms de las rutas vigentes asignadas al usuario (`GET /routes/my-forms`), no el catálogo nacional. Resumen muestra solo "Formularios". `showIf` se evalúa en `SurveyForm` (hoy solo existe en el editor).

## Tareas
- [x] A. Backend visita corta: `User.VisitFlow` (migración 0028 + DDL prod), schemas User/UserCreate/UserUpdate, `LoginResponse` + `/auth/me` + users list, `GET /routes/my-forms`. Tests.
- [x] B. Frontend visita corta: `StoredUser.visitFlow` (persistSession + refreshUserRole), select en `UserManagement`, `SurveyForm` (forms de ruta en short, nav a `/summary`, evaluar `showIf`), `VisitSummaryPage` (solo Formularios en short). Tests.
- [x] C. `backend/scripts/import_laplata_api.py`: Excel → API (zona, distribuidor, usuarios, rutas, PDVs + PATCH zona, RoutePdv, formulario + RouteForm). Dry-run, log JSON, resumable (dedup por Code).
- [x] D. Verificación local: SQLite + seed → script contra localhost → login activadorU → visita corta en el celu/browser.
- [x] E1. Deploy 21-oct: DDL prod aplicado (45 users full) · commit a423d82 push main · CI/Deploy Backend/Deploy Frontend verdes · prod responde.
- [x] E2. Import prod 21-oct 13:07: zona La Plata (32) · distribuidor Lo de pucho (26, existía) · users 144 activadoru / 145 activadord (vendedor, short, manager Nahuel 115) · form 22 · rutas 326-344 (19 campaña, EndDate 23/12, IsFocus false) · 548 PDVs Convenience›Kiosco, 0 errores, 25 min. Log `backend/scripts/import_laplata_prod_20261021.json`. Verificado por API: activadorU 9 rutas/236 PDVs, activadorD 9/270, my-forms = solo 'Activación La Plata'.
- [ ] E3. 22-oct pedido Nahuel (audios): ruta 330 Lateral San Carlos el vie 23/10 para 144+145 → `backend/scripts/patch_routeday_330_20261023.py` (correr con --commit; prod bloqueado para Claude). Excepción activadores (VisitFlow short, encapsulada en `_is_field_campaign_runner`): POST /routes/{id}/start-today (día de hoy on-demand, idempotente), my-routes-detail suma campañas de su zona (incluye Fuera de ruta 344), alta PDV → selector con esas rutas + check-in directo. Fix general: `_resolve_route_day_id` usa fecha AR. Tests `test_activacion_field_runner.py`. Sin deployar. Nahuel 115 ejecutivo→territory_manager en prod 23/10 (`scripts/patch_nahuel_tm_20261023.py`, AuditEvent, rollback RoleId=10) para ver/corregir ubicación PDVs en Admin › Gestión PDV › Mapa; no ve 'Fuera de ruta' 344 (sin asignar); 23/10 RouteDay 4911 ruta 340 Zona 17 para 145 (`scripts/patch_routeday_today_20261023.py <nombre> <user> --commit`, parche hasta deployar start-today); calendario quincenal Nahuel cargado 26/10→23/12 (`scripts/plan_laplata_calendario_20261023.py`; 29/10 re-planificado `--from 2026-10-30 --week1 2026-10-19 --replan --commit`, 78 RouteDays: semana 26/10 = S2, vie 30/10 Pablo = Villa Elvira); pedido real no existe en la app.
- [ ] E3. Probar en celu con activadorU · mandar mensaje a Nahuel (portapapeles) · mails reales de Christian/Pablo · asignar 'Fuera de ruta' (42).

**Estado 19-oct 16:40**: A–D hechos, sin commit. pytest 672 ✓ · vitest 229 ✓ · build ✓. E2E local (SQLite limpia + Vite + Playwright/Chrome, celu 390px): import 548 PDVs / 19 rutas / form 11 preguntas en 4 s, re-ejecución idempotente (0 a crear); activadorU ve 236 PDVs, 9 rutas, solo el form "Activación La Plata"; check-in → formulario (condicionales OK: cigarrillos/Van Kiff/Lebonn al marcar Sí; promo/precio al marcar compró) → "Continuar a Resumen" → resumen solo "Formularios". Extra: barra "Visita Efectiva" oculta en short (mide los 6 pasos del flujo completo). Base dev local anterior en `backend/trade_marketing.db.bak-20261019`.

**Deploy (orden)**
1. Prod DDL (lo corrés vos con `!`, desde backend/): `python scripts/ddl_user_visit_flow_20261019.py --dry-run` → sin flag. ANTES del backend (el modelo hace SELECT de VisitFlow).
2. Commit + push main (CI deploya backend y SWA).
3. Import prod: `python scripts/import_laplata_api.py "<xlsx>" --api https://espert-trade-api.azurewebsites.net --email <admin> --password '<pass>' --users "CHRISTIAN=activadoru@espert.com.ar:Activador U,PABLO=activadord@espert.com.ar:Activador D" --manager-email <supervisor> --channel Quiosco` (dry-run) → `--commit`. Si el canal no existe, el script lista los de prod.
4. Probar con activadoru@espert.com.ar / Espert2026! (cambia clave al entrar) en un celu.

## Pendientes del solicitante
- Mails reales de Christian y Pablo (reemplazan activadorU/D).
- Confirmar lista de productos Espert del form (se toma del catálogo `Product.IsOwn` de prod).
- Quién carga los "Fuera de ruta" (hoy: sin asignar).

---

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

---

## 2026-11-19 — Propuesta A: Cadenas / Key Accounts unificado (PENDIENTE OK Davor)

Problema: la misma cadena vive en 3 lugares (Cadenas de Proximidad › <nombre cadena> como subcanal; Convenience › Key Accounts id 62 con cadena solo en el Name; Convenience › Kiosco/Maxikiosco con "(cadena)" en el nombre).

Diseño: 2 ejes separados. Canal›Subcanal = formato del local. Cadena = a quién pertenece (entidad nueva). Key account = atributo de la cadena.

- [ ] DDL quirúrgico prod (no alembic): tabla `Chain(ChainId, Name, Kind cadena|bandera, IsKeyAccount, AccountManagerUserId, StoreCount, Aliases, IsActive)` + `PDV.ChainId` nullable + índice. Migración alembic espejo para dev.
- [ ] Backend: modelo/schema/router `/chains` (CRUD TM+), `ChainId`/`ChainName`/`IsKeyAccount` en respuestas PDV, filtro `chain_id` + `key_account` en `/pdvs`, validar subcanal ∈ canal (hueco actual), AuditLog.
- [ ] Front: selector "Cadena" en alta/edición PDV (obligatorio si canal = Cadenas de Proximidad; precarga offline), pestaña "Cadenas" en admin Canales, filtro en Gestión PDV, badge en ficha.
- [ ] Migración datos prod (dry-run + backup JSON): cadenas desde subcanales del canal 22 (fusionar duplicados Tomyshop/Tommy's shop…) + las 11 de Santiago con IsKeyAccount; ChainId por subcanal (canal 22), por prefijo Name (371 `CAD-*`), por log de reuso (82); subcanal → Chica/Mediana/Grande según StoreCount; desactivar subcanales-cadena y el 62.
- [ ] Candidatos por nombre "(cadena)" / notas → Excel de revisión, NO automático.
- [ ] Consumidores: Inteligencia, Puchi (tool + conocimiento), export dashboard, reportes (corte por cadena).

## 2026-11-19 — Propuesta B: Tablero de control de rutas (PENDIENTE OK Davor)

Grilla en `/admin/routes` (pestaña por defecto): filas = TM rep, columnas = días de la semana, navegación por semana. Celda = chips de ruta del día.

- [ ] Fase 1 (ver + agregar/sacar): `GET /routes/board?from&to` (1 query, filtrada por jerarquía); grilla; panel lateral del día (PDVs, orden, sacar/agregar PDV, sacar día); "+" en celda (agregar ruta existente ese día); superposiciones en rojo. Falta `DELETE /routes/days/{id}/pdvs/{pdv}`.
- [ ] Fase 2 (mover): `PATCH /routes/days/{id}` acepta `WorkDate` y `AssignedUserId` (guarda: sin visitas, jerarquía, sin duplicado); drag & drop (react-dnd ya instalado) entre días y entre trades; al soltar: "solo este día" / "toda la ruta de acá en adelante" (cambia frecuencia / reasigna).
- [ ] Fase 3 (robustez): generación de días en servidor (`POST /routes/{id}/generate-days`, idempotente) + unique (RouteId, WorkDate); horizonte: días proyectados "fantasma" pasada la semana 8; resolver superposición con 1 clic (mover / fusionar / dejar); traspaso de cartera desde menú de la fila.
- [ ] Limpieza: modal "Editar Ruta" muerto, alta de ruta sin trade ni frecuencia, visibilidad faltante en `/all-days` `/day-detail`.
