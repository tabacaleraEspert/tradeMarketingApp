# Tablero TMR — cada trade ve su propia gestión

## Contexto

`/tablero-tmr/index.html` (estático, `frontend/public/tablero-tmr/`) es solo-admin: `routes.tsx` (`TableroTmrRedirect`) patea al home a todo el que no sea admin, y los 4 endpoints `/kpi/tmr/*` llevan `require_role("admin")`. Se quiere que cada trade (vendedor) entre y vea directamente su vista individual (la misma que ve el admin al filtrar por 1 TMR) para medir su performance.

Lo bueno: el scope ya está resuelto por jerarquía. `_resolve_target_user_ids` → `visible_user_ids` devuelve `{self}` para un vendedor y el sub-árbol para un TM, y valida `user_id` (403 si no es visible). O sea: sacando el `require_role("admin")`, un vendedor que llama `/kpi/tmr/team` recibe un `trades` de 1 fila (él mismo), y `/routes` + `/pdvs` con su `user_id` funcionan igual que para el admin.

## Backend (`backend/app/routers/kpi.py`)

- [x] Sacar `dependencies=[Depends(require_role("admin"))]` de `/tmr/team`, `/tmr/routes`, `/tmr/pdvs`, `/tmr/catalog` (quedan con `get_current_user`; scope por `_tmr_scope`).
- [x] Cache: `routes`/`pdvs` cachean por `current_user.UserId` + `user_id`. El resultado depende sólo del scope resuelto, no de quién pregunta → resolver el scope antes y usar `tuple(scope)` en la key. Así el admin mirando a X y X mirándose a sí mismo comparten la entrada (DB S0: 1 escaneo de cobertura en vez de 2).
- [x] Tests (`tests/test_tmr_dashboard.py` o `test_kpi_router.py`): vendedor → `team` devuelve sólo su fila; vendedor con `user_id` de otro → 403; TM ve su sub-árbol.

## Frontend

### `routes.tsx`
- [x] `TableroTmrRedirect`: dejar pasar a cualquier usuario logueado (hoy `role === "admin"`).

### `public/tablero-tmr/index.html` — modo "mi gestión"
- [x] Después de cargar `team`: si `DD.trades.length === 1` → auto-seleccionar ese TMR (`filterByTmr`) y ocultar la barra "Filtrar TMR" (chips + "Todos") y el header "Seleccioná un TMR para ver su gestión". No hace falta leer el rol: un vendedor siempre recibe 1 trade; un TM con equipo ve chips como hoy.
- [x] Título del topbar en ese modo: "Mi gestión" en vez de "Seguimiento TMR".
- [x] Link "← Volver a la app" en el topbar (hoy no hay forma de volver salvo el botón del navegador; para el vendedor en el celu es necesario).
- [x] Deep-link `?tmr=` sigue funcionando para admin.

### `Home.tsx`
- [x] Botón "Mi gestión TMR" para no-admin (mismo estilo que "Panel Admin" del admin) → `/tablero-tmr`.

## Verificación
- [x] pytest backend.
- [ ] Local contra prod DB: NO se hizo (lectura de prod bloqueada por permisos). Se verificó E2E con SQLite local (Playwright, vendedor + admin). Falta ver con datos reales tras deploy.
- [x] Probar en ancho de celu (la página fue pensada para desktop).

## Preguntas abiertas
1. TMs (territory managers) también entran y ven su equipo con chips? (default: sí, jerarquía)
2. Botón en Home del vendedor OK, o sólo desde menú/perfil?
3. La vista individual muestra todo lo que ve el admin (5 KPIs, rutas foco, PDVs, quick wins, precios). Algo que el vendedor NO debería ver?
4. Página estática es de desktop: alcanza que "funcione" en celu o querés adaptación mobile?

## Review (2026-09-22)
- Backend: 4 endpoints abiertos a todo rol; cache por scope resuelto; 5 tests nuevos (497 pasan).
- Frontend: ruta abierta a logueados; página estática con modo "Mi gestión" (auto-select + ocultar selector), link Volver, media query 640px; botón Home vendedor.
- E2E Playwright local (SQLite): 17/17 checks (vendedor mobile 390px + admin desktop). Pendiente ver con datos reales de prod tras deploy.
