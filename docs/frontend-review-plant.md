# Revisión frontend — Vista planta (/plant)

**Fecha:** 2026-04-21
**Alcance:** `frontend/src/app/pages/plant/*` (~1.360 LOC, 1 dashboard + 7 componentes + mockData).
**Rol destino:** "Líder de Turno" según el header de `PlantLayout` ("Monitor Líder de Turno"). No aparece como rol en `ROLE_LABELS` del admin.
**Foco:** UX + UI desktop + permisos + a11y + **estado de integración con backend** (porque esta área está totalmente mockeada).
**Método:** lectura estática archivo por archivo (no hice delegación porque es un área chica).

Páginas y componentes revisados:
- `PlantLayout.tsx` (69 LOC)
- `PlantDashboard.tsx` (127 LOC)
- `components/SemaphoreCard.tsx` (65)
- `components/ProductionTable.tsx` (163)
- `components/StockPanel.tsx` (124)
- `components/ProductionChart.tsx` (59)
- `components/AlertsPanel.tsx` (141)
- `components/WeeklyView.tsx` (139)
- `components/MonthlyView.tsx` (172)
- `data/mockData.ts` (302)

---

## Resumen ejecutivo

Este módulo es distinto a los otros dos en un aspecto clave: **no tiene backend**. Todo lo que muestra viene de `mockData.ts` con fechas hardcoded ("Hoy" = 2026-04-09, hoy son 12 días después; `weekNumber === 15` como "semana actual"). Conclusión: **`/plant` es un prototipo de demo**, no una vista funcional, y tratarlo como otra cosa puede llevar a malentendidos.

Lo más importante que encontré:

- **`/plant` no tiene ningún guard de auth**. `PlantLayout` no chequea `isAuthenticated()` (a diferencia del `Layout` mobile). Cualquiera con la URL entra — incluye quienes no están logueados. Tampoco está en la lógica de redirección de `Login.tsx`.
- **Toda la data es mock estático**. Si se muestra el dashboard en una pantalla de planta, los números no cambian nunca excepto el reloj. Los timestamps de alertas son de hace 12 días.
- **Problemas numéricos** en `calculateKPIs`: fallback `efficiencyPct || 95` (línea 290) — si el cálculo da 0 (cero órdenes completadas), la pantalla miente con un 95% inventado para que "se vea bien".
- **El botón "Actualizar" hace `window.location.reload()`** (PlantLayout:55). Dumpea el estado (incluyendo qué alertas el líder de turno ya acusó) y se queda sin nada.
- **El "Acusar" de una alerta crítica no pide confirmación** (AlertsPanel:88–93). Un clic accidental en una parada de línea desaparece la alerta del grid.
- **UI no responsive**: `grid-cols-5` en el header mensual (MonthlyView:38) y `grid-cols-4` en el semanal (WeeklyView:26) no degradan; en tablet/1024px queda todo muy apretado.
- **`setInterval(1000)` en PlantLayout** dispara un re-render completo cada segundo para actualizar el reloj. Para un monitor que va a estar 12h en la misma pantalla, aislar el clock en un subcomponente con memo ahorra ciclos.
- Bugs más chicos: `StockPanel` ordena `supplies` en sitio (muta el array importado), barras de stock que saturan a 100% esconden diferencias reales, `isCurrent = week.weekNumber === 15` hardcoded, ninguno de los tres charts de recharts tiene `<Tooltip>`.
- A favor: el diseño visual (tema oscuro control-room, semáforos, tipografía grande) es muy adecuado para un monitor de turno; el `SemaphoreCard` es reusable; los colores de estado son consistentes.

---

## 1. Estado de integración (este módulo vs el resto)

### 1.1 Todo el dashboard es mock sin backend
**Archivos:** `PlantDashboard.tsx:10–20` (imports de `mockData`), `mockData.ts:79–254` (arrays hardcoded).
**Problema:** no hay `useEffect` + `api.get`, no hay hooks de `lib/api`, no hay fetch. Los datos son un prototipo. En cambio, `/admin` y `/mobile` están conectados a backend real.
**Riesgo:** si esto entra a producción como está, la planta verá siempre los mismos números. Si se demo-eó como prueba de concepto, conviene documentarlo.
**Fix sugerido:** decidir roadmap explícito. Si es demo: poner `// TODO: replace with API` en cada página y/o un banner "DEMO" arriba. Si va a producción: endpoints a diseñar (`/plant/orders/today`, `/plant/supplies`, `/plant/alerts`, `/plant/summary?period=week|month`).
**Severidad:** Crítico (depende del contexto).

### 1.2 Fechas y semana actual hardcoded
**Archivos:**
- `mockData.ts:189, 198, 206, 214, 223, 232` — timestamps `"2026-04-09T..."` en alertas.
- `mockData.ts:242` — `{ dayLabel: "Hoy" }` pegado al 9 de abril.
- `MonthlyView.tsx:128` — `const isCurrent = week.weekNumber === 15;`.

**Problema:** si se mueve el reloj del server, el dashboard sigue creyendo que la semana actual es la 15 y que hoy es el 9 de abril.
**Fix sugerido:** reemplazar con `new Date()`. Para el "Hoy" usar `isToday(day.day)`. Para la semana actual, `ISOWeekNumber(new Date())`.
**Severidad:** Alta en cualquier escenario; si se conecta a backend, esto se corrige naturalmente.

### 1.3 `/plant` sin autenticación
**Archivo:** `PlantLayout.tsx` (todo el archivo) — falta el `useEffect(() => isAuthenticated() || navigate("/login"))` que sí tiene `components/Layout.tsx` (mobile) en líneas 10–14.
**Problema:** cualquiera que tenga la URL entra. Si la planta tiene una tablet compartida con la URL marcada como favorita, nadie impide que un visitante vea producción detallada y stock. El backend tampoco bloquea porque no se consulta ningún endpoint.
**Fix sugerido:** agregar el mismo check que `Layout`; idealmente crear un `RequireRole(["plant_manager", "admin"])` cuando se conecte a APIs reales.
**Severidad:** Alta.

### 1.4 Rol "Líder de Turno" / "plant_manager" no existe en el sistema
**Archivo:** `PlantLayout.tsx:40` (texto "Monitor Líder de Turno"). `ROLE_LABELS` en `AdminLayout.tsx:23–29` no contiene ningún rol relacionado con planta.
**Problema:** la vista está pensada para un rol que el sistema no modela. Si mañana un admin crea un usuario "Líder de Turno", no sabe qué permisos darle y qué redirección poner.
**Fix sugerido:** agregar `plant_manager` a `ROLE_LABELS`, contemplar en `Login.tsx:30–35` el redirect `if (role === "plant_manager") navigate("/plant")`.
**Severidad:** Media.

---

## 2. UX / flujos

### 2.1 Botón "Actualizar" con `window.location.reload()`
**Archivo:** `PlantLayout.tsx:54–59`
**Problema:** un reload pierde todo el estado (alertas acusadas, tabs, filtros de marca, filtros de categoría). Para un operador que está siguiendo la producción, es una mini-regresión cada vez que quiere "refrescar".
**Fix sugerido:** cuando se conecte a backend, reemplazar por un `refetch()` que dispare las queries sin tocar el DOM. Mientras es mock, simplemente remover el botón o dejarlo como placeholder con tooltip "pendiente".
**Severidad:** Alta.

### 2.2 "Acusar" alerta sin confirmación ni deshacer
**Archivo:** `AlertsPanel.tsx:88–93`
**Problema:** una alerta `critical` (parada de línea, stock 0.9 días) se dismissa con un solo clic. El botón tiene el mismo estilo genérico (`bg-white/10`) que cualquier otra acción neutra. Además no hay forma de deshacer (no vi "Re-abrir" en las acusadas).
**Fix sugerido:**
1. Para `severity === "critical"`: abrir un `ConfirmModal` pidiendo confirmación explícita.
2. Agregar "Re-abrir" en la fila de acusadas, con la misma API `onAcknowledge` que también pueda des-acusar.
3. Registrar quién acusó y cuándo — útil para auditoría cuando se conecte a backend.

**Severidad:** Alta.

### 2.3 Reloj con segundos forzando re-render cada segundo
**Archivo:** `PlantLayout.tsx:11–14`
**Problema:** `setInterval(() => setTime(new Date()), 1000)` fuerza un re-render del `PlantLayout` y, vía `<Outlet />`, posiblemente del dashboard entero cada segundo. En un monitor de planta 12h corriendo, es un CPU drain innecesario y un riesgo de romper el estado de hover/focus con cada tick.
**Fix sugerido:** aislar el reloj en un subcomponente `<ShiftClock />` memoizado para que sólo él se re-renderice. O reducir el tick a 30s si los segundos no son críticos.
**Severidad:** Media.

### 2.4 Filtros por marca no persisten entre tabs Hoy/Semana/Mes
**Archivo:** `PlantDashboard.tsx:42–125`
**Problema:** al cambiar a "SEMANA" y volver a "HOY" se resetean los filtros de marca y categoría (están en state de los componentes hijos que se desmontan). El operador que quiere ver sólo Viceroy en los tres tabs pierde el filtro cada vez.
**Fix sugerido:** subir el estado a `PlantDashboard` o a un contexto local.
**Severidad:** Media.

### 2.5 Expandir orden: no hay botón "colapsar todo"
**Archivo:** `ProductionTable.tsx:87–132`
**Problema:** solo se puede tener una orden expandida a la vez (`expandedId` es un id único), y para cerrar hay que tocar de nuevo la misma fila. Si se quieren abrir varias, no se puede.
**Fix sugerido:** pasar a `Set<number>` de expandidos para permitir múltiples. Agregar botón "Expandir todos / Colapsar todos" arriba de la tabla.
**Severidad:** Baja.

### 2.6 Charts sin tooltip: no se ven valores al hover
**Archivos:**
- `ProductionChart.tsx:24–54` — recharts `<BarChart>` sin `<Tooltip />`.
- `WeeklyView.tsx:53–81` — misma.
- `MonthlyView.tsx:68–107` — misma.

**Problema:** recharts no muestra tooltip si no se declara `<Tooltip />`. El operador que quiere saber exactamente qué valor tiene una barra/punto tiene que ir a la tabla de al lado.
**Fix sugerido:** agregar `<Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />` en los tres charts.
**Severidad:** Media.

### 2.7 Filtros sin limpiar: no hay botón "Reset"
**Archivos:** `ProductionTable.tsx:42–60` (marcas), `StockPanel.tsx:56–76` (categorías).
**Problema:** tras filtrar, para volver a ver todo hay que tocar "Todas" / "Todos". No hay forma de saber si el filtro actual es el default o aplicado.
**Fix sugerido:** indicador visual cuando el filtro NO es "Todas" (p. ej. un chip chico "Filtro activo: Viceroy ×"). El "×" limpia en un tap.
**Severidad:** Baja.

### 2.8 Tema fijo oscuro, sin toggle
**Archivo:** `PlantLayout.tsx:30` (`bg-[#0a0a0a] text-white`).
**Problema:** el resto de la app soporta tema light/dark; acá es oscuro forzado. En una planta con mucha luz ambiente, el monitor podría necesitar modo claro puntualmente (aunque el oscuro es buena elección para pantallas 24/7).
**Fix sugerido:** si el monitor va a estar siempre en oscuro, nada. Si se usa también en tablet con luz, ofrecer toggle.
**Severidad:** Baja.

---

## 3. UI / visual / responsive

### 3.1 `grid-cols-5` y `grid-cols-4` sin fallback responsive
**Archivos:**
- `MonthlyView.tsx:38` — `<div className="grid grid-cols-5 gap-4">` (5 KPIs).
- `WeeklyView.tsx:26` — `grid-cols-4`.
- `PlantDashboard.tsx:107` — `grid-cols-1 lg:grid-cols-2` (este SÍ está bien).

**Problema:** en un laptop 1024px o tablet horizontal, los 5 KPIs mensuales entran pero con tipografía de 3xl son muy chicos; en portrait tablet (768px) se cortan.
**Fix sugerido:** `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` (el último KPI queda en la segunda fila en pantallas chicas, mejor que cortarse).
**Severidad:** Media.

### 3.2 Tipografía `text-[10px]` y `text-[8px]` en un monitor
**Archivos:**
- `AlertsPanel.tsx:78–84` (`text-[10px]` en metadata de alerta).
- `AlertsPanel.tsx:119–122` (acusadas).
- `StockPanel.tsx:110–114` (metadata de stock).
- `MonthlyView.tsx:137–163` (`text-xs`, `text-[10px]`).
- `ProductionTable.tsx:67–72` (headers `text-xs`) — OK, este es el mínimo aceptable.

**Problema:** un monitor de planta es mirado desde 2–3 metros. `text-[10px]` se traduce a ~10 px visuales, que a esa distancia es ilegible. En una pantalla táctil de operación es aceptable, pero para "monitor de turno" conviene subir.
**Fix sugerido:** mínimo `text-sm` (14 px) para datos y `text-xs` (12 px) para etiquetas. Reservar `text-[10px]` solo para timestamps o metadata muy secundaria.
**Severidad:** Media.

### 3.3 `animate-pulse` en rojo crítico sin `prefers-reduced-motion`
**Archivos:**
- `SemaphoreCard.tsx:31` (`glow: "animate-pulse"` para rojo).
- `AlertsPanel.tsx:73` (fila de alerta `${cfg.pulse}` para crítico).
- `StockPanel.tsx:42` (chip rojo).

**Problema:** animaciones constantes pueden inducir fatiga visual e incluso problemas para usuarios con sensibilidad a flicker/seizures. No se respeta `@media (prefers-reduced-motion: reduce)`.
**Fix sugerido:** definir una clase `.critical-pulse` que dentro de `@media (prefers-reduced-motion: reduce)` se desactive. Tailwind: `motion-safe:animate-pulse` en vez de `animate-pulse`.
**Severidad:** Media.

### 3.4 Barra de stock satura al 100% escondiendo diferencias
**Archivo:** `StockPanel.tsx:84`
**Problema:** `pct = Math.min((supply.daysRemaining / Math.max(supply.minDays * 2, 1)) * 100, 100)`. Para `minDays=3`:
- 6d remaining → 100%
- 10d remaining → capped a 100%
- 30d remaining → capped a 100%

Todos se ven iguales ("lleno") aunque la holgura es muy distinta. Engaña al vistazo rápido.
**Fix sugerido:** o normalizar al `maxDays` del dataset (`Math.max(...supplies.map(s => s.daysRemaining))`), o mostrar el número absoluto de días y sacar la barra. La barra en su forma actual sólo distingue "¿está abajo de 2×minDays o no?".
**Severidad:** Media.

### 3.5 Cambio de marca con `text-[10px]` en `uppercase` — contraste borderline
**Archivo:** `AlertsPanel.tsx:78–80`
**Problema:** `text-[10px] font-semibold uppercase ${cfg.iconColor}` — el `iconColor` para `info` es `text-blue-400`, sobre `bg-blue-500/10` con alpha bajo. Es poco contraste.
**Fix sugerido:** pasar a `text-blue-300` o engrosar. Alternativa: unificar en `text-white/70` para el tipo, dejando el color sólo en el ícono.
**Severidad:** Baja.

### 3.6 Sin empty state en `ProductionTable` con filtro activo
**Archivo:** `ProductionTable.tsx:76`
**Problema:** si se filtra por marca y esa marca no tiene órdenes, el grid aparece vacío sin mensaje.
**Fix sugerido:** `{filtered.length === 0 && <div className="px-5 py-6 text-center text-white/40">Sin órdenes para este filtro</div>}`.
**Severidad:** Baja.

### 3.7 Scroll en `AlertsPanel.max-h-[300px]` sin indicador
**Archivo:** `AlertsPanel.tsx:61`
**Problema:** `max-h-[300px] overflow-auto` deja ver ~3 alertas; si hay más, el scroll vertical no tiene indicador (sombra, gradient). El líder de turno puede pensar que son todas.
**Fix sugerido:** agregar sombra gradient en la parte inferior cuando hay más contenido (CSS mask o un `div` degradado en el padre con `pointer-events-none`).
**Severidad:** Baja.

---

## 4. A11y

### 4.1 Botones del TabsList con `text-base font-bold` pero sin `aria-label`
**Archivo:** `PlantDashboard.tsx:46–64`
**Problema:** `<TabsTrigger>` de shadcn viene con a11y razonable por defecto (role="tab"). Sin embargo, la diferencia visual entre tab activa e inactiva es solo de color/fondo, que puede ser difícil para usuarios daltónicos.
**Fix sugerido:** confirmar que shadcn agrega `aria-selected` automáticamente (lo hace). Agregar un indicador no-color (borde inferior grueso en la activa, o ícono ✓).
**Severidad:** Baja.

### 4.2 Icon-only button "Actualizar" en el header sin aria-label
**Archivo:** `PlantLayout.tsx:54–59`
**Problema:** el `<button>` con ícono `RefreshCw` sólo tiene `className`. Un lector de pantalla anuncia "button" a secas.
**Fix sugerido:** `aria-label="Actualizar datos"` o `title="Actualizar"`.
**Severidad:** Media.

### 4.3 Tablas emuladas con `<div className="grid">` en vez de `<table>`
**Archivos:** todas las tablas del módulo (`ProductionTable`, `StockPanel` list, `WeeklyView` details, `MonthlyView` weekly summary).
**Problema:** los lectores de pantalla pierden la semántica de fila/columna. Es el mismo patrón que `/admin` (no usan `<table>` real en muchas).
**Fix sugerido:** migrar a `<table>` + `<th scope="col">` cuando sea una tabla real. Si el diseño requiere `grid`, usar `role="table"`, `role="row"`, `role="columnheader"`, `role="cell"`.
**Severidad:** Media.

### 4.4 Color como único canal en barras y dots
**Archivos:**
- `ProductionTable.tsx:93` — dot rojo/ámbar/verde sin texto visible adyacente (el status sí tiene ícono, OK) — **acá está OK porque el ícono de status lleva la información**.
- `StockPanel.tsx:92` — dot sin texto extra, solo el número de días en color.
- `ProductionChart.tsx:50` — barras coloreadas por % sin leyenda de umbrales.
- `WeeklyView.tsx:74–78` — ídem.

**Problema:** para Daltonismo, los tres niveles "verde/ámbar/rojo" son indistinguibles.
**Fix sugerido:** agregar label textual al lado de la barra de stock ("OK"/"Bajo"/"Crítico"). En los charts, agregar una leyenda explicando los colores ("≥95% verde, 80–95% ámbar, <80% rojo").
**Severidad:** Media.

### 4.5 Foco visible no verificado en botones custom
**Archivos:** todos los botones con `active:bg-white/10` / `hover:bg-white/10` sin `focus-visible:ring-*`.
**Problema:** navegación con Tab deja al usuario sin indicación clara de dónde está el foco.
**Fix sugerido:** `focus-visible:ring-2 focus-visible:ring-[#A48242] focus-visible:ring-offset-2 focus-visible:ring-offset-black` como baseline.
**Severidad:** Media.

### 4.6 `<button>` expandible sin `aria-expanded`
**Archivo:** `ProductionTable.tsx:87–132`
**Problema:** el toggle de fila no anuncia a lectores si está expandido.
**Fix sugerido:** `aria-expanded={isExpanded}` y `aria-controls="row-detail-{id}"` ligado al div de detalle.
**Severidad:** Media.

---

## 5. Bugs encontrados incidentalmente

### 5.1 `calculateKPIs` miente con fallback 95%
**Archivo:** `mockData.ts:290`
**Problema:** `efficiencyPct: efficiencyPct || 95, // fallback for demo`. Si ninguna orden está completa, devuelve 95% inventado. El comentario "fallback for demo" deja claro que es intencional, pero no puede vivir en producción.
**Fix sugerido:** si no hay datos, devolver `null` y renderizar "—" en el UI.
**Severidad:** Alta (si se conecta a backend y se olvida cambiar).

### 5.2 `StockPanel` muta `supplies` importado
**Archivo:** `StockPanel.tsx:80–82`
**Problema:** `filtered.sort(...)`. Cuando `categoryFilter === "all"`, `filtered === supplies` (el array original importado). `.sort()` muta in-place. En cada render, `supplies` se re-ordena (no importa aquí porque la comparación es estable, pero es mala higiene — si mañana se usa `supplies` en otro componente, ya llegaría ordenado).
**Fix sugerido:** `.slice().sort(...)` o `[...filtered].sort(...)`.
**Severidad:** Baja.

### 5.3 División por cero potencial en `efficiencyPct`
**Archivo:** `mockData.ts:281`
**Problema:** `Math.round((... / completedOrders.reduce((s, o) => s + o.plannedQty, 0)) * 100)`. Si `completedOrders` está vacío, el denominador es 0 y el resultado es `NaN`. El `|| 0` + `|| 95` del fallback lo enmascara.
**Fix sugerido:** `const plannedSum = ...; if (!plannedSum) return null;`
**Severidad:** Baja.

### 5.4 Un `RefreshCw` sin spinner mientras "recarga"
**Archivo:** `PlantLayout.tsx:58`
**Problema:** el ícono no rota. No hay feedback de que se esté recargando (además porque `window.location.reload` es sincrónico visualmente).
**Fix sugerido:** cuando se conecte a backend y sea un `refetch`, agregar `className={loading ? "animate-spin" : ""}`.
**Severidad:** Baja.

### 5.5 `avgEfficiency` en `WeeklyProductionSummary` no usado
**Archivo:** `mockData.ts:55` (campo declarado) + 250–253 (data mock).
**Problema:** `avgEfficiency` está en el tipo y en los datos, pero nadie lo renderiza (MonthlyView usa el campo `efficiency` y recalcula).
**Fix sugerido:** borrar el campo o usarlo.
**Severidad:** Baja.

---

## 6. Positivas

- **Diseño visual** muy adecuado para monitor de control: tema oscuro, tipografía grande en los KPIs (4xl), semáforos claros, buen contraste general.
- **`SemaphoreCard`** es un componente reusable bien diseñado, con props claras y colores encapsulados.
- **Status con ícono + color** en `ProductionTable.statusConfig` (10–15) — patrón a11y-friendly.
- **`AlertsPanel`** separa `unacknowledged` de `acknowledged` con opacidad y line-through — buen ordenamiento visual.
- **Responsive en `lg:`** en `PlantDashboard:107` (stock + chart) y `WeeklyView:45` / `MonthlyView:61` — al menos a esa altura funciona.
- **Helpers puros** (`getSemaphoreColor`, `getStockSemaphore`, `getStopsSemaphore`, `getProductionByBrand`) bien separados de presentación.
- **Tipos fuertes**: las interfaces en `mockData.ts` están completas y los componentes las consumen correctamente (no hay `any`).

---

## 7. Tabla consolidada

| # | Hallazgo | Archivo | Línea(s) | Sev. | Tipo |
|---|---|---|---|---|---|
| 1.1 | Todo el módulo es mock estático | `PlantDashboard.tsx` + `mockData.ts` | 10–20 / 79–254 | Crítica (según contexto) | arquitectura |
| 1.2 | Fechas y semana 15 hardcoded | `mockData.ts`, `MonthlyView.tsx` | 189–232 / 128 | Alta | bug latente |
| 1.3 | `/plant` sin auth check | `PlantLayout.tsx` | todo | Alta | seguridad |
| 1.4 | Rol "plant_manager" no modelado | `PlantLayout.tsx`, `AdminLayout.tsx` | 40 / 23–29 | Media | permisos |
| 2.1 | `window.location.reload()` como refresh | `PlantLayout.tsx` | 54–59 | Alta | UX |
| 2.2 | Acusar alerta crítica sin confirmar | `AlertsPanel.tsx` | 88–93 | Alta | UX |
| 2.3 | Re-render por segundo | `PlantLayout.tsx` | 11–14 | Media | perf |
| 2.4 | Filtros no persisten entre tabs | `PlantDashboard.tsx` | 42–125 | Media | UX |
| 2.5 | Sin "colapsar todo" en tabla producción | `ProductionTable.tsx` | 87–132 | Baja | UX |
| 2.6 | Charts sin `<Tooltip />` | `ProductionChart`, `WeeklyView`, `MonthlyView` | varios | Media | UX |
| 2.7 | Filtros sin indicador/reset | `ProductionTable`, `StockPanel` | — | Baja | UX |
| 2.8 | Tema fijo oscuro | `PlantLayout.tsx` | 30 | Baja | UX |
| 3.1 | `grid-cols-5/4` sin fallback | `MonthlyView`, `WeeklyView` | 38 / 26 | Media | UI |
| 3.2 | `text-[10px]/[8px]` en monitor | varios | — | Media | UI |
| 3.3 | `animate-pulse` sin `prefers-reduced-motion` | `SemaphoreCard`, `AlertsPanel`, `StockPanel` | 31 / 73 / 42 | Media | UI/a11y |
| 3.4 | Barra de stock satura y miente | `StockPanel.tsx` | 84 | Media | UI |
| 3.5 | Contraste borderline info | `AlertsPanel.tsx` | 78–80 | Baja | UI |
| 3.6 | Sin empty state con filtro | `ProductionTable.tsx` | 76 | Baja | UI |
| 3.7 | Scroll sin indicador | `AlertsPanel.tsx` | 61 | Baja | UI |
| 4.1 | Tabs diferenciadas solo por color | `PlantDashboard.tsx` | 46–64 | Baja | a11y |
| 4.2 | Refresh icon-only sin aria-label | `PlantLayout.tsx` | 54–59 | Media | a11y |
| 4.3 | Tablas con `<div grid>` | varios | — | Media | a11y |
| 4.4 | Color-only en barras/charts | `StockPanel`, `ProductionChart`, `WeeklyView` | 92 / 50 / 74 | Media | a11y |
| 4.5 | Sin `focus-visible` | varios botones | — | Media | a11y |
| 4.6 | Expandibles sin `aria-expanded` | `ProductionTable.tsx` | 87–132 | Media | a11y |
| 5.1 | Fallback 95% en `calculateKPIs` | `mockData.ts` | 290 | Alta (si prod) | bug |
| 5.2 | `StockPanel` muta `supplies` | `StockPanel.tsx` | 80–82 | Baja | bug |
| 5.3 | División por cero en eficiencia | `mockData.ts` | 281 | Baja | bug |
| 5.4 | Refresh sin spinner | `PlantLayout.tsx` | 58 | Baja | UI |
| 5.5 | `avgEfficiency` no usado | `mockData.ts` | 55, 250–253 | Baja | dead code |

---

## 8. Plan de ataque sugerido

**Antes de cualquier otra cosa** — decidir el estado del módulo:

- **A) Es una demo permanente** (ej. para mostrar en ventas como "feature que vamos a construir"). En ese caso, agregar:
  - Banner amarillo arriba: "DEMO — datos simulados, no conectados a producción".
  - Auth check simple (1.3) para que no sea accesible sin login.
  - Documentar en README que `/plant` es demo.
  - Corregir el fallback `|| 95` (5.1) por un "—" así no engaña.
- **B) Va a producción pronto** (con endpoints reales de planta). En ese caso, el plan:

**Tanda 1 — entrada a producción (prerrequisitos):**

1. **1.3** auth guard + redirect en `Login.tsx` para el rol `plant_manager`.
2. **1.4** sumar `plant_manager` a `ROLE_LABELS` y backend.
3. **1.1, 1.2, 5.1, 5.3** reemplazar `mockData.ts` con hooks reales: `usePlantOrdersToday`, `usePlantSupplies`, `usePlantAlerts`, `usePlantWeekly`, `usePlantMonthly`. Eliminar el fallback 95 y las fechas hardcoded.

**Tanda 2 — UX crítica:**

4. **2.1** botón de refresh con `refetch()` + spinner, no reload.
5. **2.2** confirmación obligatoria al acusar alertas críticas; registrar quién y cuándo.
6. **2.6** agregar `<Tooltip />` a los tres charts.
7. **3.4** arreglar la escala de la barra de stock.

**Tanda 3 — UI / performance:**

8. **2.3** aislar el reloj en `ShiftClock` memoizado.
9. **3.1** grids responsive (cols-2/3/5).
10. **3.2** subir tipografía de labels a `text-xs`/`text-sm`.
11. **3.3** `motion-safe:animate-pulse`.

**Tanda 4 — a11y + polish:**

12. **4.x** aria-labels, focus-visible, aria-expanded.
13. **2.4** filtros que persistan entre tabs.
14. **2.5, 2.7, 3.6, 3.7** quick wins menores.

---

## 9. Referencias cruzadas con informes anteriores

Aparecen aquí también:
- **`window.*` brutos (`confirm()`, `reload()`)** — tercer informe con esto. Candidato a ESLint rule `no-restricted-globals`.
- **Tablas con `<div grid>`** — también en `/admin` (informe 3, hallazgo 4.1–4.2).
- **Color como único canal** — repetido en los tres informes. Convendría un `<StatusPill />` reutilizable con ícono+color+label.
- **`text-[10px]` y variantes arbitrarias** — cuarto informe con esto. Fijar escala en `Guidelines.md`.
- **Botones icon-only sin aria-label** — todos los informes. Candidato a lint rule que exija `aria-label` cuando el button children no contenga texto.
- **Modales/confirmaciones inconsistentes** — este módulo no los usa aún, pero cuando se agregue la confirmación de 2.2 debería ser con el `ConfirmModal` ya existente.

---

## 10. Nota sobre alcance

A diferencia de los tres informes anteriores (donde las páginas están conectadas a un backend real), este módulo es principalmente un mockup. Los hallazgos marcados como "Crítica" o "Alta" en la sección 1 dependen totalmente de la intención del producto:
- Si es prototipo/demo → son baja/media severidad (y conviene marcarlo visualmente como demo).
- Si va a producción → son bloqueantes.

Conviene aclarar este punto con producto antes de decidir prioridad.

---

*Revisión generada con lectura estática de ~1.360 LOC. Las sugerencias de endpoints en la tanda 1 son orientativas; los nombres exactos los debería definir el equipo backend.*
