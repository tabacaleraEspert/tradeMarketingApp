# Plan de desarrollo — Feedback comerciales San Bernardo

> Derivado de `feedback_comerciales_san_bernardo.md` (levantado 2026-06-03).
> Mapeo verificado contra el código real el 2026-06-04. Item 1 (batería) queda fuera de este plan por decisión.
> Item 3 (borrar foto) ya resuelto en commit `3f28ad5`.

## ⚠️ Hallazgo clave: el campo corre un APK viejo

El APK desplegado es del **2026-05-08**. Varios fixes ya están en el código (commit `09202ba`, 3-jun) pero **nunca se rebuildeó el APK**. Por lo tanto, **estos puntos NO necesitan código nuevo — necesitan un solo rebuild + redeploy**:

| Item | Estado en código | Acción real |
|------|------------------|-------------|
| 7 — Elegir foto desde galería | ✅ Ya hecho (`usePhotoCapture.ts:158`, sin `capture`) | Rebuild + APK |
| 6 — Texto explicativo en fotos | 🟡 ~80% hecho (acciones, fachada alta, POP por marca) | Cerrar gaps + rebuild |
| 11 — Foto de acciones opcional | ✅ Acciones ya opcionales; backend ya no bloquea (`visits.py:793`) | Rebuild (+ decidir fachada) |
| 10 — Duración de visita en admin | ✅ Ya shippeado (commit `987d17c`) | Verificar en prod |
| 14 — Cobertura competencia cada N | ✅ Feature existe; default = `'4'` | Cambiar a `'5'` + PUT en prod |

---

## Estado de avance

- **Fix Cámara/Galería (corrección de item 7) — ✅ código hecho (2026-06-05), build + cap sync OK.**
  - Problema real: en el WebView de Capacitor, `<input type=file accept=image/*>` **sin** `capture` abre **solo galería**; con `capture` abre **solo cámara**. El commit que "sacó el capture" dejó al campo en galería-only.
  - Solución: nuevo `frontend/src/lib/photoSource.tsx` (`PhotoSourceSheet` + `usePhotoSource`) — un selector **Cámara/Galería** que setea/quita `capture` dinámicamente. Centralizado en `usePhotoCapture` (expone `sourceSheet`) + cableado en los 7 puntos: PhotoCapture, POPCensus, MarketNews, VisitActions, NewPointOfSale, PointOfSaleDetail, SurveyForm. `Profile` (avatar) queda cámara-only a propósito.
  - `npm run build:android` + `cap sync` ejecutados → assets de Android regenerados (Jun 5), selector presente en el bundle. **⏳ Falta: empaquetar/firmar el APK y distribuir.**


- **Ola A+B — ✅ código hecho (2026-06-04), build verde.** Falta deploy (APK + 2 acciones en prod).
  - 14 ✅ default `'4'→'5'` en `app_settings.py:26` · ⏳ falta `PUT` en prod si existe fila `'4'`.
  - 16 ✅ Hills en `seed_db.py` (`IsOwn=false`, mfr `None`) · ⏳ falta `POST /products` en prod (seed no re-siembra).
  - 6 ✅ hints en `MarketNewsStepPage`, `PhotoCapture` (por categoría), aria-label POP. **SurveyForm: cableado (opción A)** — `PhotoQuestionField` (pregunta tipo foto, captura real + preview + borrar) e `ImageCheckboxField` (foto por opción marcada).
  - 10 ✅ ya estaba; agregado label "En curso" en `VisitDataExplorer`.
  - 7 ✅ ya en source → entra con el rebuild.
  - 11 ✅ `storefront`/`shelf` → `required:false`, gating removido en `PhotoCapture`.
  - 5 ✅ `VisitSummaryPage` cuenta fotos reales (no `acts.PhotoTaken`) → no reabre captura al cierre.
  - **⏳ Acción de deploy pendiente:** `cap sync` + rebuild APK + bump SW (el `dist/` ya se rebuildeó).
- **Ola C — ✅ código hecho (2026-06-04), build + tests verdes.**
  - 2 ✅ bug visita duplicada: `create_visit` idempotente para el mismo PDV (backend), `markVisitOpenLocally` (nuevo, simétrico a closed), llamada en ambas ramas de `CheckIn.handleCheckIn`, y merge en `PointOfSaleDetail.loadData` usando la cola como fuente de verdad. Tests de visitas actualizados (idempotencia + 409 cross-PDV) → 42/42 verdes.
  - 4 ✅ admin mobile: sidebar arranca cerrada en mobile (`AdminLayout`), modal de usuario `grid-cols-1 sm:grid-cols-2`, tabla de usuarios → cards apiladas en `<md`, tabla comparativa de `TerritoryManagement` responsive (`minmax(0,1fr)` + columnas angostas).
  - **Nota:** 3 tests backend fallan en baseline (`test_pdvs_empty`, `test_duplicate_name_same_zone`, `test_invalid_category`) por la **paginación en curso** (`/pdvs` devuelve `{items,total}` en vez de lista) — preexistente, ajeno a estos cambios.

---

## Orden recomendado (por olas)

### 🌊 Ola A — Quick wins + redeploy (cierra ~5 ítems con 1 build)
- **14** [S] Cambiar default `competitor_coverage_every_n_visits` `'4'→'5'` (`app_settings.py:26`) + `PUT /settings` en prod (si ya existe fila con `'4'`, el default no alcanza).
- **16** [S] Alta de producto **Hills** vía `POST /products` `{Name:'Hills', Category:'Cigarrillos', IsOwn:false}`. OJO: `seed_products` hace early-return en DB poblada → crear por admin/API en prod, no por seed.
- **6** [S] Cerrar gaps de microcopy: `MarketNewsStepPage`, `PhotoCapture` (hint por categoría), botón `POPCensusPage`; decidir stubs muertos de `SurveyForm`.
- **10** [S] Verificar que prod incluye `987d17c`; opcional label "En curso".
- **7** [S] Ya en código → entra en el rebuild.
- → **Acción de cierre de ola: rebuild frontend + `cap sync` + APK + bump de versión de service-worker** (un solo APK, no varios).

### 🌊 Ola B — Cluster fotos (1 edición coordinada, mismo rebuild)
Convergen en `PhotoCapture.tsx` + `VisitSummaryPage.tsx`. Hacer junto para tocar el gating una sola vez.
- **11** [S] `required:false` en `storefront/shelf` (`PhotoCapture.tsx:27-28`) + relajar `handleFinish`/botón Continuar. **← decisión de producto (fachada).**
- **5** [M] `VisitSummaryPage.tsx:196-202`: contar `visitPhotos.length` (fotos reales) en vez de `acts.filter(PhotoTaken)`, para que el paso "fotos" figure completo y no reabra `PhotoCapture`. La cura real del "pide la foto al final" es relajar el gating (item 11).

### 🌊 Ola C — Bug real + admin mobile (independientes, sin decisión)
- **2** [M] **Bug de duplicado de visita.** Crear `markVisitOpenLocally` en `optimistic-cache.ts` (simétrico a `markVisitClosedLocally`); llamarlo en ambas ramas de `CheckIn.handleCheckIn`; `loadData` mergea visitas OPEN locales; `handleSave` del PDV no debe pisar la visita en curso; dedupe server por `PdvId+UserId` en `create_visit`.
- **4** [M] **Admin mobile.** Tailwind puro: modal usuario `grid-cols-1 sm:grid-cols-2`; tabla usuarios `hidden md:block` + cards apiladas `md:hidden`; arreglar anchos fijos de `TerritoryManagement`; sidebar arranca cerrada en mobile.

### 🌊 Ola D — Reglas de censo + herencia
Primero extraer helper compartido `_previous_closed_visit(db, pdv_id, exclude_visit_id)` (con fallback `ClosedAt→OpenedAt` para visitas offline) — hoy la query está duplicada en `visit_coverage.py:91-100` y `visits.py:765-773`.
- **15** [M] ESPERT stock+precio obligatorios. Validar por fila `IsOwn && Works` en `validate-close` (tras `:758`) y en `CoverageFormPage.handleSave` (enforcement real client-side, el cierre offline no llama validate-close). **← decisión: "stock" = `Availability` o columna numérica nueva (migración).**
- **9** [L] Heredar visita anterior: `PrevVisitDate` en banner cobertura + nuevo `GET .../pop/diff` + `GET .../actions/previous` (read-only). Sin migración.

### 🌊 Ola E — Flag PDV + métrica
- **17** [M] Flag **"vende sueltos"**. Migración `0019_pdv_sells_loose` (Boolean nullable) + modelo + schemas + builders de respuesta + filtro `sells_loose` en `list_pdvs` + switch en `PointOfSaleDetail`/`NewPointOfSale` + filtro en `POSManagement`. Opcional: sincronizar desde `save_loose_survey`. **← decisión: tri-estado vs booleano; auto-sync desde censo o manual.**
- **13** [M] Métrica "visitas hasta perfil completo". `GET /reports/pdv-completeness` (solo lectura) + sección en `Reports.tsx`. **← decisión: qué define "perfil completo".**

### 🌊 Ola F — Grande / bloqueado
- **8** [L] **Pausar/reanudar visita.** Estado `PAUSED` en `_VALID_STATUSES`/`_TRANSITIONS` (Status ya es `String(20)`, sin migración); `create_visit` ignora PAUSED; UI pausar/reanudar; reusa scaffolding del item 2. **← decisión: pausa explícita vs auto; máx. pausadas; ¿cuentan en métricas?**
- **18** [XL] **"Mi Variable".** Fase 1 read-only reusando lógica de efectividad de `visit_indicators`/`validate-close`; Fase 2 criterios configurables (tablas nuevas). **← BLOQUEANTE: criterios/metas/pesos exactos del negocio.**
- **12** [S] **Perfect Store.** Bloqueado por propuesta de Santi (WhatsApp). Tratarlo como criterio del item 18 para no duplicar scoring.

---

## Migraciones
- **0019_pdv_sells_loose** (item 17) — única migración cierta, standalone. `down_revision=0018_add_user_dni`.
- Item 15 (numérico) y item 18 Fase 2 — condicionales a decisión de producto; encadenar como 0020/0021 sólo cuando se confirmen.

## Decisiones de producto pendientes (bloquean su ola)
1. **Item 11/5 (fachada):** ¿`storefront`/`shelf` 100% opcionales, o fachada sigue obligatoria en algún flujo (ej. solo en alta de PDV)?
2. **Item 15 ("stock"):** ¿`Availability` (sí/quiebre, sin migración) o número de unidades nuevo (migración)? ¿Bloquea avance a POP o solo el cierre? ¿Todo ESPERT o solo "trabaja"?
3. **Item 14 (1ª visita):** ¿la primera visita sigue forzando competencia, o se cuenta puro cada 5? ¿N editable por admin?
4. **Item 8 (pausa):** ¿explícita o auto? ¿máx. pausadas y expiración? ¿cuentan en métricas/fin-de-día? ¿duración neta sin pausa?
5. **Item 17 (sueltos):** ¿tri-estado (Sí/No/Sin relevar) o booleano? ¿auto-sync desde censo (gana el último) o manual?
6. **Item 13 (completo):** ¿qué censos/campos definen "perfil completo"? ¿cuenta el alta? ¿global o por TM/zona?
7. **Item 18 (variable):** criterios, metas, pesos, periodicidad, histórico, ¿Perfect Store es criterio? (BLOQUEANTE — negocio)
8. **Item 12 (Perfect Store):** framework de Santi (BLOQUEANTE — WhatsApp).
9. **Item 6 (SurveyForm):** ¿cablear los stubs de foto muertos o quitarlos del builder?
10. **Item 16 (Hills):** ¿Manufacturer exacto? Category `'Cigarrillos'`, `IsOwn=false`.
