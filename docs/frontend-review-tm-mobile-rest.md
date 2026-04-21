# Revisión frontend — Resto de vistas mobile TM

**Fecha:** 2026-04-21
**Alcance:** pantallas mobile del flujo TM no cubiertas en detalle por `frontend-review-tm-mobile.md`, más componentes mobile compartidos.
**Foco:** UX / flujos, UI / visual / responsive, A11y quick wins.
**Método:** lectura estática de código con verificación archivo/línea.

Pantallas revisadas: `Sync`, `Alerts`, `History`, `Profile`, `NewPointOfSale`, `VisitSummaryPage`, `EndOfDayPage`, `SurveyForm`, `PhotoCapture`, `RouteFocoPage`, `RouteGeneratorPage`, `MyRoutesPage`, `MyRouteEditorPage`, `VisitActionsPage`.

Componentes revisados: `OfflineBanner`, `PendingSyncSheet`, `ForcePasswordChangeModal`, `QuickContactsModal`, `GpsCaptureButton`, `AddressAutocomplete`, `DateSelector`, `LocationMap`.

> Este informe no repite hallazgos del anterior (p. ej. `confirm()` destructivo, `/admin` sin guard, touch targets en PointOfSaleDetail). Referencia cruzada al final.

---

## Resumen ejecutivo

- Hay **un bug funcional confirmado en `MyRouteEditorPage.tsx`**: el comentario dice que solo territory_manager/regional_manager/admin editan, pero el array `canEdit` incluye explícitamente a `"vendedor"`. Cualquier TM puede entrar en modo edición, lo que contradice la intención del código.
- El **botón primario del check-out** en `VisitSummaryPage.tsx` usa `bg-red-600`, color normalmente reservado a destructivo. En el contexto del cierre de visita no lo es — confunde la señal visual.
- El **ícono WifiOff del header de `SurveyForm`** (línea 346–348) es estático: un `<button>` sin `onClick`, sin lógica de conexión, y además muestra siempre el ícono "desconectado" aunque haya señal. Ya existe `OfflineBanner` que hace este trabajo bien.
- `AddressAutocomplete` tiene el flujo teclado bien (arrow keys + Enter), pero falta la capa ARIA (`role="listbox"`, `aria-expanded`, `aria-selected`) que hace que lectores de pantalla lo anuncien.
- `NewPointOfSale` detecta que la dirección está fuera del radio de 300m (línea 368–375) pero **no desactiva el botón submit** — el alta puede continuar con la inconsistencia.
- `QuickContactsModal` usa `<select>` nativos en vez de shadcn `Select`, rompiendo la estética y en iOS abre el picker nativo encima del formulario.
- Positivo: `OfflineBanner` es sencillo y correcto; `GpsCaptureButton` maneja bien los casos de error (permiso denegado, timeout, no disponible); `SurveyForm` tiene tracking de tiempo por formulario sin fricción.

---

## 1. Críticos / Altos — UX

### 1.1 Comentario y código se contradicen en edición de rutas del TM
**Archivo:** `frontend/src/app/pages/MyRouteEditorPage.tsx` líneas 38–42
**Problema:** el comentario indica que solo territory_manager, regional_manager y admin pueden editar la ruta, pero el array incluye explícitamente `"supervisor"` y `"vendedor"`:
```ts
// Sólo territory_manager, regional_manager y admin pueden editar rutas.
// Los vendedores (TM Reps) ven la ruta en modo lectura.
const canEdit = ["admin", "territory_manager", "regional_manager", "supervisor", "vendedor"].includes(
  (currentUser.role || "").toLowerCase()
);
```
Cualquier TM autenticado entra con `canEdit === true`.
**Fix sugerido:** decidir cuál es la intención real y alinear comentario + array. Si el TM sí puede editar su propia ruta (parece que sí, es "My Route"), borrar el comentario engañoso. Si no, sacar `"vendedor"` del array.
**Severidad:** Alta (confusión + riesgo de que alguien ajuste el comentario en vez del código).

### 1.2 Botón principal del cierre de visita usa color destructivo
**Archivo:** `frontend/src/app/pages/VisitSummaryPage.tsx` líneas 373–380
**Problema:** `<Button className="w-full h-11 text-sm font-semibold bg-red-600 hover:bg-red-700">...Cerrar Visita y Check-out</Button>`. El rojo se asocia universalmente a "borrar/cancelar", no a "finalizar con éxito". Un TM puede dudar antes de confirmar, o peor, otro botón rojo en otra pantalla le generará falsos positivos de "cuidado".
**Fix sugerido:** usar `bg-espert-gold` o la variante primaria por defecto. Reservar el rojo para acciones destructivas reales (borrar visita, descartar borrador).
**Severidad:** Alta (UX).

### 1.3 `SurveyForm` muestra ícono WifiOff estático y no interactivo
**Archivo:** `frontend/src/app/pages/SurveyForm.tsx` líneas 346–348
**Problema:** el header tiene `<button className="text-muted-foreground"><WifiOff size={20} /></button>` siempre visible, sin onClick, sin aria-label, sin lógica que alterne a `Wifi` según `navigator.onLine`. Engaña al usuario (parece que está offline cuando no lo está) y ocupa espacio táctil sin utilidad. `OfflineBanner` ya cubre el estado offline.
**Fix sugerido:** borrar el botón, o transformarlo en un indicador que use `navigator.onLine` con `aria-live="polite"`.
**Severidad:** Alta (UX + a11y).

### 1.4 `NewPointOfSale` permite submit aunque la dirección esté fuera de rango
**Archivo:** `frontend/src/app/pages/NewPointOfSale.tsx` líneas 368–375
**Problema:** se calcula `addressOutOfRange` comparando la dirección con la ubicación GPS capturada (tolerancia 300m, línea 79). El alert se pinta en rojo, pero nada impide continuar. Hay riesgo de dar de alta PDVs con dirección escrita a mano que no coincide con las coordenadas guardadas.
**Fix sugerido:** agregar `disabled={addressOutOfRange || loading || ...}` al botón "Crear PDV" y mostrar el motivo en el `title`/tooltip del botón. Idealmente pedir confirmación explícita antes de permitir el override.
**Severidad:** Alta (UX + data quality).

### 1.5 `getAlertIcon` ignora su argumento
**Archivo:** `frontend/src/app/pages/Alerts.tsx` líneas 52–54
**Problema:** la función recibe `type: string` y siempre retorna `<AlertTriangle size={20} />`. Es dead code semántico — el argumento sugiere que iba a haber íconos distintos por tipo (stock-out, missing-material, price-issue…).
**Fix sugerido:** o mapear los tipos a íconos distintos (`Package` para stock-out, `Tag` para price-issue, etc.), o sacar el argumento y llamarla sin parámetro.
**Severidad:** Media (clarity / consistencia visual).

### 1.6 Sin confirmación al "Descartar todo" en la cola de sync
**Archivo:** `frontend/src/app/components/PendingSyncSheet.tsx` líneas 92–100
**Problema:** `Descartar todo` (líneas 92–100) ejecuta `handleDiscardAll` sin confirmación intermedia. Si el TM lo toca por error pierde definitivamente todas las operaciones pendientes — incluye check-ins, respuestas de encuestas, fotos.
**Fix sugerido:** envolver la acción en `ConfirmModal` con texto explícito: "Vas a descartar N operaciones pendientes. Esta acción no se puede deshacer."
**Severidad:** Alta (riesgo de pérdida de datos).

---

## 2. Críticos / Altos — UI y touch targets

### 2.1 Botón de eliminar avatar ~24×24 px
**Archivo:** `frontend/src/app/pages/Profile.tsx` líneas 138–146
**Problema:** botón flotante con `p-1.5` + `Trash2 size={12}`. Queda en ~24 px, muy por debajo del mínimo de 44 px para HIG y del 48 dp de Material.
**Fix sugerido:** subir a `p-2.5` + `size={16}`, o `h-10 w-10` con ícono centrado.

### 2.2 Botones "Hoy" y date picker en `RouteFocoPage` chicos
**Archivo:** `frontend/src/app/pages/RouteFocoPage.tsx` líneas 171–181
**Problema:** `px-2 py-1` + `text-[10px]`/`text-sm` dan botones de ~28 px de alto. Son las acciones más usadas de esa pantalla (cambiar día de ruta).
**Fix sugerido:** `px-3 py-2` + `text-xs` min, o usar el componente `Button size="sm"` de shadcn que ya respeta `h-9`.

### 2.3 Bottom bar del cierre de visita sobre el espacio seguro del dispositivo
**Archivo:** `frontend/src/app/pages/VisitSummaryPage.tsx` línea 372
**Problema:** `p-3 pb-[env(safe-area-inset-bottom)]` está bien, pero el botón tiene `h-11` (aprox 44 px) apretado. En iPhone con home indicator, al respetar el inset queda todo pegado al sensor.
**Fix sugerido:** `p-4 pb-[max(1rem,env(safe-area-inset-bottom))]`.

### 2.4 `QuickContactsModal` usa `<select>` nativos
**Archivo:** `frontend/src/app/components/QuickContactsModal.tsx` líneas 139–158
**Problema:** tres selects nativos ("Rol...", "Decisión..." y un input date) en un grid de 3 columnas. En iOS esto abre el picker nativo grande, tapa el modal; en Android rompe con la tipografía y colores del resto. El resto de la app usa shadcn `Select`.
**Fix sugerido:** migrar a `<Select>` de shadcn (ya importado en otras páginas). Apilar verticalmente los campos en mobile (<375px) en lugar de `grid-cols-3` para que no se corte el texto.

### 2.5 Uso de `text-[10px]` y `text-[8px]` en badges y labels
**Archivos:**
- `frontend/src/app/pages/History.tsx` línea 468 (`text-[8px]` en `Badge`)
- `frontend/src/app/pages/RouteFocoPage.tsx` línea 173 (`text-[10px]`)
- `frontend/src/app/pages/Home.tsx` línea 90 (`text-[9px]`) — ya reportado en el informe anterior
- varios lugares con `text-[10px]` y `text-[11px]`

**Problema:** tamaños por debajo del mínimo recomendado (12 px) para legibilidad en outdoor/sun. Acumulan fatiga visual.
**Fix sugerido:** mínimo `text-xs` (12 px). Si se necesita un "micro label", definir `text-micro` en CSS con tamaño ≥ 11 px y usarlo con parsimonia.

### 2.6 `Alerts` filter row con 4 botones se corta en 320 px
**Archivo:** `frontend/src/app/pages/Alerts.tsx` líneas 148–177
**Problema:** "Todas / Abiertas / En Proceso / Resueltas" con sus contadores caben gracias a `overflow-x-auto`, pero el scroll horizontal es poco visible. En 320 px solo se ven dos botones y el usuario puede no notar que hay más a la derecha.
**Fix sugerido:** `flex-wrap` en <375 px, o agregar una sombra/indicador en el lado derecho cuando hay contenido oculto a la derecha.

---

## 3. Medios — UX

### 3.1 `SurveyForm` tiene dos botones separados sin jerarquía clara (Borrador vs Finalizar)
**Archivo:** `frontend/src/app/pages/SurveyForm.tsx` líneas 285–309 (lógica) y el bloque de botones del final del archivo
**Problema:** las llamadas son distintas y los mensajes también (líneas 276, 280, 299, 303), pero visualmente los botones suelen quedar iguales en ancho; el TM puede tocar "Finalizar" pensando que solo guarda. Además "Finalizar" navega a `/pos/:id/actions` inmediatamente (línea 305) sin pasar por resumen, lo cual puede ser confuso.
**Fix sugerido:** hacer "Finalizar" el botón principal (gold) y "Borrador" secundario (outline). Agregar confirmación si hay preguntas obligatorias sin responder.

### 3.2 `MyRoutesPage` no muestra cuántos filtros están activos al alternar list/map
**Archivo:** `frontend/src/app/pages/MyRoutesPage.tsx`
**Problema:** al saltar entre vista lista y vista mapa, los filtros (zona, canal, prioridad, búsqueda) se conservan en state pero visualmente no hay badge que diga "3 filtros activos". El TM puede creer que está viendo todo cuando no es así.
**Fix sugerido:** agregar un chip `Filtros (3)` en el header que permita resetearlos en un tap.

### 3.3 `PhotoCapture` no bloquea el submit cuando faltan categorías obligatorias
**Archivo:** `frontend/src/app/pages/PhotoCapture.tsx` líneas 177–190
**Problema:** `handleFinish` valida y muestra `toast.error(...)` si faltan fotos, pero el botón "Continuar" siempre está habilitado. El usuario recibe feedback solo al tocar.
**Fix sugerido:** usar `coveredRequired < requiredCount` (ya calculado en 195–198) para `disabled` del botón. Mostrar además un chip `Faltan 2/5 obligatorias` sticky arriba.

### 3.4 `RouteGeneratorPage` — si el backend tarda no hay feedback intermedio
**Archivo:** `frontend/src/app/pages/RouteGeneratorPage.tsx` (flujo completo)
**Problema:** generar ruta automática es una operación costosa (optimización geográfica). Si el endpoint tarda, el único feedback es un estado `loading`. Falta progreso visual y un botón cancelar.
**Fix sugerido:** mensaje secuencial ("Geolocalizando PDVs...", "Optimizando orden...", "Calculando tiempos..."), botón `Abort` que cancele la request.

### 3.5 `History` muestra todas las visitas sin paginar
**Archivo:** `frontend/src/app/pages/History.tsx`
**Problema:** misma lógica que `RouteList` (reportada en informe 1): un TM con muchas visitas históricas renderiza todo de golpe. Además las fotos del modal (líneas 459–473) no tienen lazy loading (`loading="lazy"`).
**Fix sugerido:** paginar por semana o por mes; `<img loading="lazy" />` en la grilla de fotos.

### 3.6 `VisitActionsPage` y `PhotoCapture` pueden dejar al TM en un dead-end offline
**Archivos:** ambos encolan operaciones con `executeOrEnqueue` pero no avisan que el próximo paso depende de que esta visita exista en el server.
**Problema:** en offline, si el TM crea una acción (POST `/visits/:id/actions`), y la visita base todavía no subió, la cola se encadena por `_tempVisitId`. Pero si por algún motivo el `visit_create` falla y el TM descarta desde `PendingSyncSheet`, quedan las acciones huérfanas en la cola.
**Fix sugerido:** al descartar un `visit_create`, descartar en cascada sus dependientes (por `_tempVisitId`) con confirmación explícita "Vas a perder también N acciones relacionadas".

---

## 4. Medios — UI / Visual

### 4.1 `OfflineBanner` ocupa el `env(safe-area-inset-top)` sin respetarlo
**Archivo:** `frontend/src/app/components/OfflineBanner.tsx` líneas 32–40
**Problema:** el banner es `fixed top-0` sin `pt-[env(safe-area-inset-top)]`. En iPhone con notch se superpone al indicador de hora/señal.
**Fix sugerido:** `fixed top-0 left-0 right-0 pt-[env(safe-area-inset-top)]` y ajustar el padding del contenedor interno.

### 4.2 `PendingSyncSheet` — z-index y scroll del modal
**Archivo:** `frontend/src/app/components/PendingSyncSheet.tsx` líneas 84–170
**Problema:** la lista tiene `max-h-[60vh] overflow-y-auto` (línea 120) pero con muchas operaciones pendientes y un footer largo (líneas 90–110), en pantallas bajas el footer queda fuera de vista.
**Fix sugerido:** pasar el modal a `<Sheet>` (bottom sheet) de shadcn, que es el patrón mobile-nativo para esto.

### 4.3 `RouteFocoPage` — leyenda del mapa sobre el mapa
**Archivo:** `frontend/src/app/pages/RouteFocoPage.tsx`
**Problema:** la leyenda del mapa se renderiza con `relative -mt-12` (posicionamiento frágil). En mapas pequeños puede tapar marcadores o quedar detrás de controles nativos del mapa.
**Fix sugerido:** posicionar la leyenda `absolute bottom-4 right-4` dentro del contenedor del mapa, con `bg-card/95 backdrop-blur`. Alternativa: abajo del mapa, fuera de él.

### 4.4 `ForcePasswordChangeModal` — sin medidor de fuerza ni toggle "mostrar contraseña"
**Archivo:** `frontend/src/app/components/ForcePasswordChangeModal.tsx` líneas 29–120
**Problema:** valida ≥8 caracteres (línea 30) pero no muestra feedback visual de fuerza. No hay toggle para ver la contraseña tipeada, que en mobile es incómodo con los dedos grandes. El `onClose` es no-op (línea 53) — sin salida de escape, lo cual es intencional pero sin `aria-modal="true"` explícito.
**Fix sugerido:**
- Medidor: usar una barrita que considere largo + mayúscula + número + símbolo.
- Botón `Eye/EyeOff` dentro de los Input de contraseña.
- Permitir Enter en el campo "Confirmar" → submit.

### 4.5 `AddressAutocomplete` — z-[10000] arbitrario
**Archivo:** `frontend/src/app/components/AddressAutocomplete.tsx` línea 204
**Problema:** `z-[10000]` es un número mágico. Si mañana se agrega un toast o modal con z alto, quién gana es impredecible.
**Fix sugerido:** centralizar z-index en `Guidelines.md` (toast=60, modal=50, dropdown=20, banner-offline=80, etc.) y usarlos por token.

### 4.6 Mezcla de `<Dialog>` de shadcn y `<Modal>` custom
**Archivos:** `Alerts.tsx` usa shadcn `Dialog`; `PhotoCapture.tsx`, `VisitSummaryPage.tsx`, `PendingSyncSheet.tsx` usan el `Modal` custom (`components/ui/modal.tsx`); `QuickContactsModal` extiende lo custom.
**Problema:** doble API para lo mismo. Mismo problema visual y de mantenimiento ya reportado en el informe 1 (punto 3.7) — aquí aparece otra vez.
**Fix sugerido:** unificar en shadcn `Dialog` + `Sheet` y retirar `Modal` custom en una pasada.

---

## 5. A11y — quick wins

### 5.1 `AddressAutocomplete` — dropdown sin ARIA
**Archivo:** `frontend/src/app/components/AddressAutocomplete.tsx` líneas 188–235
**Problema:** tiene manejo de teclado OK (arrow keys + Enter + Escape en `handleKeyDown`), pero al lector de pantalla no le anuncia:
- que hay una listbox abierta (`aria-expanded`)
- que tal opción está seleccionada (`aria-selected`)
- que el input controla un listbox (`aria-controls`, `role="combobox"`)
**Fix sugerido:**
```tsx
<input
  role="combobox"
  aria-expanded={showDropdown}
  aria-controls="address-autocomplete-list"
  aria-activedescendant={activeIndex >= 0 ? `addr-opt-${activeIndex}` : undefined}
  ...
/>
<div id="address-autocomplete-list" role="listbox">
  {predictions.map((p, i) => (
    <button id={`addr-opt-${i}`} role="option" aria-selected={i === activeIndex}>...</button>
  ))}
</div>
```

### 5.2 `ForcePasswordChangeModal` — Labels sin `htmlFor`
**Archivo:** `frontend/src/app/components/ForcePasswordChangeModal.tsx` líneas 80, 95, 109
**Problema:** `<Label>` sin `htmlFor`, `<Input>` sin `id` correspondiente. Lectores de pantalla leen cada input como "sin etiqueta".
**Fix sugerido:** darle `id="pwd-current"`, `id="pwd-next"`, `id="pwd-confirm"` a los Input y `htmlFor` igual a los Label.

### 5.3 `DateSelector` — celdas de día sin aria-label
**Archivo:** `frontend/src/app/components/DateSelector.tsx`
**Problema:** los botones del calendario probablemente solo contienen el número; VoiceOver anuncia "12", sin mes ni día de semana. En un flujo rápido en mobile el contexto falta.
**Fix sugerido:** `aria-label={\`\${dayName} \${day} de \${monthName}\`}` en cada celda.

### 5.4 Contraste borderline en `bg-amber-50 / text-amber-900`
**Archivos:** banners de warning en varias pantallas (`NewPointOfSale` 369–374, `PhotoCapture`, `Sync`).
**Problema:** `bg-amber-50` (#FFFBEB) con `text-amber-900` (#78350F) ratio ~8.3:1 — OK. Pero `text-amber-700` (usado en varios lugares) sobre `bg-amber-50` da ~5.8:1 — borderline para subtexto.
**Fix sugerido:** usar siempre `amber-900` para texto importante dentro de banners amber.

### 5.5 Ícono como único canal semántico en `Alerts` por tipo
**Archivo:** `frontend/src/app/pages/Alerts.tsx` líneas 52–54
**Problema:** (relacionado con 1.5) aun cuando se corrija para mostrar un ícono distinto, el tipo debería también estar en texto. Hoy el título de la alerta puede no repetir el tipo.
**Fix sugerido:** renderizar `<Badge>{getAlertTypeLabel(type)}</Badge>` junto al ícono.

---

## 6. Observaciones positivas

- **`OfflineBanner`** es pequeño, correcto y cubre bien el caso principal; solo falta el safe-area-top.
- **`GpsCaptureButton`** maneja los tres casos de error con toast específico (permiso denegado, timeout, no disponible) — copy claro para TM.
- **`SurveyForm` — tracking de tiempo**: sigue siendo uno de los ejemplos más cuidados del codebase.
- **`VisitSummaryPage` — estructura del resumen**: modales de detalle por sección están bien separados; se ve que hubo pensamiento sobre el flujo.
- **`MyRoutesPage`** ofrece list y map view con filtros compartidos; el esqueleto del feature está sólido.
- **`PhotoCapture` — progreso por categoría**: el cálculo `coveredRequired / requiredCount` (195–198) es buena base para el badge de progreso; solo falta conectarlo al botón.
- **`AddressAutocomplete` — keyboard nav** (arrow keys, Enter, Escape) está bien implementado, aunque falte ARIA.
- **`Alerts` con shadcn `Dialog`**: es el ejemplo a seguir para unificar la capa de modales.
- **`PendingSyncSheet` — detalle de reintentos y errores**: muestra número de intentos, último error y edad de la operación. Muy útil para debug de sync.

---

## 7. Tabla consolidada

| # | Hallazgo | Archivo | Línea(s) | Sev. | Tipo |
|---|---|---|---|---|---|
| 1.1 | Comentario vs código canEdit | `MyRouteEditorPage.tsx` | 38–42 | Alto | UX/bug |
| 1.2 | Botón principal rojo en check-out | `VisitSummaryPage.tsx` | 373–380 | Alto | UX |
| 1.3 | WifiOff estático en header survey | `SurveyForm.tsx` | 346–348 | Alto | UX/a11y |
| 1.4 | Submit habilitado con dirección fuera de rango | `NewPointOfSale.tsx` | 368–375 | Alto | UX/data |
| 1.5 | `getAlertIcon` ignora argumento | `Alerts.tsx` | 52–54 | Medio | UX |
| 1.6 | `Descartar todo` sin confirmación | `PendingSyncSheet.tsx` | 92–100 | Alto | UX |
| 2.1 | Avatar delete ~24 px | `Profile.tsx` | 138–146 | Alto | UI |
| 2.2 | Date buttons chicos en ruta | `RouteFocoPage.tsx` | 171–181 | Alto | UI |
| 2.3 | Bottom bar apretada en summary | `VisitSummaryPage.tsx` | 372 | Medio | UI |
| 2.4 | `<select>` nativos en contactos | `QuickContactsModal.tsx` | 139–158 | Alto | UI |
| 2.5 | Tipografía `text-[8px]`/`text-[10px]` | varios | — | Medio | UI |
| 2.6 | Filtros `Alerts` cortados en 320px | `Alerts.tsx` | 148–177 | Medio | UI |
| 3.1 | Borrador vs Finalizar sin jerarquía | `SurveyForm.tsx` | 285–309 | Medio | UX |
| 3.2 | Filtros no visibles al alternar | `MyRoutesPage.tsx` | — | Medio | UX |
| 3.3 | Submit habilitado sin fotos obligatorias | `PhotoCapture.tsx` | 177–190 | Medio | UX |
| 3.4 | Generator sin progreso ni cancel | `RouteGeneratorPage.tsx` | — | Medio | UX |
| 3.5 | History sin paginar, fotos sin lazy | `History.tsx` | 459–473 | Medio | UX/perf |
| 3.6 | Cascada en descarte de visit_create | `PendingSyncSheet.tsx` | — | Medio | UX |
| 4.1 | OfflineBanner sin safe-area-top | `OfflineBanner.tsx` | 32–40 | Medio | UI |
| 4.2 | PendingSyncSheet footer fuera en pantallas bajas | `PendingSyncSheet.tsx` | 84–170 | Medio | UI |
| 4.3 | Leyenda del mapa mal posicionada | `RouteFocoPage.tsx` | — | Medio | UI |
| 4.4 | ForcePassword: sin strength ni show | `ForcePasswordChangeModal.tsx` | 29–120 | Medio | UX/UI |
| 4.5 | z-[10000] mágico | `AddressAutocomplete.tsx` | 204 | Bajo | UI |
| 4.6 | Dialog vs Modal conviven (ref.) | varios | — | Medio | UI |
| 5.1 | AddressAutocomplete sin ARIA | `AddressAutocomplete.tsx` | 188–235 | Medio | a11y |
| 5.2 | ForcePassword sin `htmlFor` | `ForcePasswordChangeModal.tsx` | 80, 95, 109 | Medio | a11y |
| 5.3 | DateSelector sin aria-label en celdas | `DateSelector.tsx` | — | Medio | a11y |
| 5.4 | Contraste amber-700 borderline | varios | — | Bajo | a11y |
| 5.5 | Tipo de alerta solo por ícono | `Alerts.tsx` | 52–54 | Bajo | a11y |

---

## 8. Plan de ataque sugerido

**Primera tanda (una tarde, bajo riesgo, alto impacto):**

1. Alinear comentario y código en `MyRouteEditorPage.tsx` (1.1).
2. Cambiar `bg-red-600` del check-out por color primario (1.2).
3. Eliminar el `<WifiOff>` estático del header de `SurveyForm` (1.3).
4. Desactivar el botón en `NewPointOfSale` cuando `addressOutOfRange` (1.4) y en `PhotoCapture` cuando faltan obligatorias (3.3).
5. Agregar `ConfirmModal` al "Descartar todo" de `PendingSyncSheet` (1.6).

**Segunda tanda (una iteración, UI polish):**

6. Subir touch targets en Profile (2.1) y RouteFocoPage (2.2).
7. Migrar `<select>` de `QuickContactsModal` a shadcn Select (2.4) y apilar vertical en <375 px.
8. Agregar `pt-[env(safe-area-inset-top)]` a `OfflineBanner` (4.1).
9. Tipografía: sustituir `text-[8px]`/`text-[10px]` por `text-xs` salvo casos justificados (2.5).

**Tercera tanda (plataforma / sistema de diseño):**

10. Unificar Modal custom → shadcn `Dialog` + `Sheet` (4.6).
11. Tokens de z-index en `Guidelines.md` (4.5).
12. Agregar strength meter y show/hide password en `ForcePasswordChangeModal` (4.4).
13. Capa ARIA completa en `AddressAutocomplete` (5.1) y `DateSelector` (5.3).
14. `htmlFor`/`id` pareados en todos los Input/Label del modal de password (5.2).

---

## 9. Referencias cruzadas con el informe anterior

Hallazgos que aparecieron también aquí pero ya están en `frontend-review-tm-mobile.md`:

- `window.confirm()` en `PhotoCapture.tsx:164` (sigue en el mismo patrón reportado en 1.4 del informe anterior).
- Modal custom vs shadcn Dialog (3.7 anterior).
- Sin skeletons (2.2 anterior, se ve de nuevo en `SurveyForm` 311–316 y `PhotoCapture` 200–206).
- Navegación inconsistente con `navigate(-1)` vs path absoluto — visible también en `VisitActionsPage` y `History`.
- Empty states de texto plano (2.6 anterior) — se repiten en `Alerts`, `History`, `MyRoutesPage`.

Atacar una sola vez los tres primeros (ConfirmModal universal, migración a shadcn Dialog, componente `<Skeleton>` reutilizable) cierra los dos informes a la vez.

---

*Revisión generada con lectura estática del código y spot-check de líneas; los puntos de "dead-end offline en cascada" (3.6) conviene validarlos reproduciendo el escenario con el device en modo avión.*
