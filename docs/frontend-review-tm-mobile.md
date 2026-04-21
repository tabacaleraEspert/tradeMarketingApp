# Revisión frontend — Mobile para rol TM

**Fecha:** 2026-04-21
**Alcance:** flujos y UI del rol Trade Marketing (TM / `vendedor`) en la app mobile (`Layout` con bottom nav).
**Método:** revisión de código estática sobre `frontend/src/app/**`.
**Stack:** React + React Router + Vite + Tailwind + shadcn/ui + sonner.

> Este informe agrupa los hallazgos por severidad y categoría. Cada hallazgo apunta al archivo y línea concreta para que puedas ir al código directamente. Las recomendaciones están pensadas para acciones pequeñas y verificables.

---

## Resumen ejecutivo

- El rol TM (`vendedor`) usa el `Layout` mobile con bottom nav de 5 tabs. El gating por rol **se resuelve únicamente en el login** (redirige admin/regional_manager a `/admin`), no en el router. Un TM autenticado puede entrar a `/admin/...` escribiendo la URL.
- Hay varios botones destructivos (borrar PDV, borrar foto de perfil, borrar nota, borrar foto de visita) sin gating por rol o con `window.confirm()` en vez del `ConfirmModal` que ya existe en el código.
- En `CheckIn.tsx` hay un **bug crítico real**: el flujo offline referencia `visit.VisitId` en la línea 199, pero la variable `visit` solo se define en la rama online (línea 147). Cuando el dispositivo está offline esto lanza un `ReferenceError` después del "toast.success" y rompe la navegación a la encuesta.
- A nivel UI mobile: touch targets pequeños en varios íconos, estilo de botón igual para el estado "GPS ok" y "GPS fuera de rango" (riesgo de check-in fuera de perímetro por accidente), y falta de skeletons (solo texto "Cargando...").
- A favor: el `Layout` respeta `env(safe-area-inset-top)`, el `OfflineBanner` + cola de sync están bien pensados, y hay un buen uso de componentes reutilizables (`DateSelector`, `GpsCaptureButton`, `QuickContactsModal`).

---

## 1. Críticos

### 1.1 `/admin` accesible para TM vía URL directa
**Archivo:** `frontend/src/app/routes.tsx` líneas 70–85
**También afecta:** `frontend/src/app/components/Layout.tsx` líneas 10–14 (solo valida `isAuthenticated()`) y `Login.tsx` línea 30–35 (redirige por rol solo en login).
**Problema:** El router no tiene guardia por rol sobre `/admin`. Un TM autenticado puede tipear `/admin` y ver el `AdminLayout`. Aunque los endpoints del backend probablemente bloqueen las acciones, la UI admin es visible.
**Fix sugerido:** crear un `RequireRole(['admin','regional_manager'])` que envuelva los `children` del bloque `/admin` y que haga `navigate('/')` si el rol no corresponde. Complementario al gating del backend, no sustituto.

### 1.2 `visit.VisitId` referenciado fuera de su scope en el flujo offline
**Archivo:** `frontend/src/app/pages/CheckIn.tsx` líneas 145–201
**Problema:** la variable `visit` está declarada solo dentro del `if (navigator.onLine)` (línea 147). En la rama offline se asigna `visitId = generateTempVisitId()`, pero al navegar a la encuesta (línea 198–200) se usa `visit.VisitId`, que no existe en esa rama → `ReferenceError` en TS porque `visit` no se declaró con `let` fuera del if. Esto rompe el flujo de check-in offline justo después del toast.
**Fix sugerido:** cambiar la línea 199 a `visitId` (la variable local) y declararla fuera del if, o usar `currentVisitId` que ya se seteó en la línea 194. Verificar además que `_tempVisitId` llegue correctamente al `visit_check` encolado (ya se hace en línea 188).

### 1.3 Botones Editar y Eliminar PDV visibles para cualquier rol
**Archivo:** `frontend/src/app/pages/PointOfSaleDetail.tsx` líneas 493–498
**Problema:** `<Button variant="outline" size="sm" onClick={openEditModal}>` y el de borrar están fuera de cualquier check de rol. Un TM puede abrir el modal de edición y, aunque el campo "Día de visita" esté gateado (línea 1137–1158), otros campos sensibles (canal, coordenadas, territorio) no lo están.
**Fix sugerido:** envolver ambos botones con `{ ['admin','supervisor'].includes(role) && ( ... ) }`. Idealmente centralizar en un helper `canEditPdv(role)` / `canDeletePdv(role)`. Confirmar con producto qué campos puede tocar un TM (al menos notas y contactos parece razonable, el resto no).

### 1.4 `confirm()` nativo para acciones destructivas
**Archivos:**
- `frontend/src/app/pages/Profile.tsx` línea 87 (`confirm("¿Eliminar tu foto de perfil?")`)
- revisar además `PhotoCapture.tsx` y los `handleDelete` de notas en `PointOfSaleDetail.tsx`

**Problema:** `window.confirm()` en mobile es intrusivo, no respeta el diseño y en algunos webviews tiene bugs. Además el código ya expone un `ConfirmModal` accesible (usado para borrar PDV en `PointOfSaleDetail.tsx`), así que la inconsistencia es innecesaria.
**Fix sugerido:** usar el `ConfirmModal` existente en todos los flujos destructivos. Estandarizar copy en español: "Eliminar" / "Cancelar".

---

## 2. UX — alta prioridad

### 2.1 El botón de check-in no distingue visualmente "GPS ok" de "fuera de rango"
**Archivo:** `frontend/src/app/pages/CheckIn.tsx` líneas 593–627
**Problema:** cuando `gpsStatus === "out-of-range"` o `"no-pdv-coords"` se muestra un banner ámbar informando, pero el botón sigue con el mismo estilo (`className="w-full h-14 text-base font-semibold"`). El label cambia a "Iniciar visita igual", lo cual es bueno, pero el color es idéntico al happy path. En mobile, con sol, un TM puede no leer el banner y confirmar sin darse cuenta que queda alertado su supervisor.
**Fix sugerido:** aplicar variante `variant="destructive"` o una clase `bg-amber-500 hover:bg-amber-600` cuando `gpsStatus !== "ok"`. Incluir ícono de warning dentro del botón y no solo en el banner.

### 2.2 Falta de skeletons — todo "Cargando..." en texto plano
**Archivos:** `Home.tsx` línea 128, `Profile.tsx`, `PointOfSaleDetail.tsx`, `SurveyForm.tsx`, `MyRoutesPage.tsx`, etc.
**Problema:** en conexiones 3G/campo, el usuario ve un flash de texto y luego todo salta cuando llegan los datos. Shadcn ya trae `Skeleton` (`components/ui/skeleton.tsx`), pero no se usa.
**Fix sugerido:** reemplazar los `"Cargando..."` por `<Skeleton />` con el mismo layout de la tarjeta/fila final. Mínimo en: bloque de progreso del Home, header de PDV, lista de ruta, tarjetas de alertas.

### 2.3 No hay confirmación de "descartar cambios" al salir de formularios
**Archivos:** modal de edición en `PointOfSaleDetail.tsx` líneas 1001–1413; `SurveyForm.tsx`; `NewPointOfSale.tsx`.
**Problema:** el usuario puede tocar el botón atrás del browser/OS o el botón "Cancelar" y pierde todo lo tipeado sin advertencia. En campo con datos largos (contactos, distribuidores, preguntas de encuesta) esto es frustrante.
**Fix sugerido:** mantener un `initialFormData` y comparar con `formData`; si hay diff y el usuario intenta cerrar, abrir un `ConfirmModal` "Tenés cambios sin guardar. ¿Descartarlos?". Engancharse a `beforeunload` y al handler de Cancelar.

### 2.4 Sin paginación ni virtualización en listas largas
**Archivo:** `frontend/src/app/pages/RouteList.tsx` líneas 54–59 (`filteredPdvs` renderiza todo).
**Problema:** una zona con cientos de PDVs renderiza todos en un único `.map`. En mobile esto pega perf y memoria.
**Fix sugerido:** limitar a 50 con "Ver más" (infinite scroll con `IntersectionObserver`) o integrar `react-window` / `@tanstack/virtual` si el DOM crece más de ~100 items. Mientras no esté paginado, al menos limitar resultado inicial con `limit` en el hook de fetch.

### 2.5 Navegación inconsistente: mezcla de `navigate(-1)` y `navigate('/ruta')`
**Archivos:** `PointOfSaleDetail.tsx`, `CheckIn.tsx`, `VisitSummaryPage.tsx`, `SurveyForm.tsx`.
**Problema:** algunos "Atrás" vuelven al historial con `navigate(-1)` y otros rutean a un path absoluto. Si el TM entra por deep-link (notificación, link compartido), `navigate(-1)` lo saca de la app.
**Fix sugerido:** elegir una convención (recomendado: `navigate(-1)` con fallback a `/` si `window.history.length <= 1`). Crear un componente `BackButton` que maneje ambos casos.

### 2.6 Estados vacíos inconsistentes
**Archivos:** `RouteList.tsx` tiene empty state (líneas ~160–167), pero `Alerts.tsx`, `History.tsx`, `VisitSummaryPage.tsx` y el home cuando no hay ruta usan texto plano (`<p>Sin alertas</p>` o similar).
**Fix sugerido:** crear `EmptyState` reutilizable con ícono, título, subtítulo y CTA opcional. Usarlo en todas las listas.

### 2.7 Feedback después del check-in usa `setTimeout(1500)` artificial
**Archivo:** `frontend/src/app/pages/CheckIn.tsx` líneas 197–201
**Problema:** se agrega un delay artificial de 1.5s para navegar a la encuesta. En condiciones de señal baja, esto bloquea al TM con el spinner visible; en señal buena, se siente lento.
**Fix sugerido:** navegar inmediatamente; mostrar el toast en la siguiente pantalla o usar `<Sonner />` que ya persiste la notificación entre rutas. Si el delay es para que el TM "vea" el checkmark animado, reducirlo a 400ms.

---

## 3. UI / Visual / Responsive

### 3.1 Touch targets < 44px en íconos de acción
**Archivos:**
- `PointOfSaleDetail.tsx` líneas 493–498 (Editar/Eliminar con `size="sm"`)
- íconos de resolver/borrar notas
- el toggle `UserCog` en `CheckIn.tsx`

**Problema:** Apple HIG recomienda ≥44×44pt y Material ≥48×48dp. Botones con `size="sm"` + icon 18 dan aprox 32×32 px.
**Fix sugerido:** cambiar a `size="icon"` con padding mínimo `p-2.5` o aumentar a `size="default"` cuando el botón es crítico (editar/borrar PDV).

### 3.2 Sin `pb-[env(safe-area-inset-bottom)]` en páginas con CTA sticky
**Archivos:** `CheckIn.tsx` línea 589 (`<div className="space-y-3 pb-4">`), `PointOfSaleDetail.tsx` bloque de acciones bottom (~889).
**Problema:** en iPhone con home indicator el botón queda pegado al borde y es incómodo de tocar. El `Layout` sí lo resuelve en el bottom nav, pero no en el contenido de cada página.
**Fix sugerido:** cambiar `pb-4` por `pb-[max(1rem,env(safe-area-inset-bottom))]` en los contenedores de acciones.

### 3.3 Jerarquía tipográfica inconsistente
**Archivos:** títulos `text-xl` en `PointOfSaleDetail.tsx:489`, `text-lg` en `Home.tsx:74`, `text-3xl` en `Login.tsx:73`; tamaños `text-[9px]`, `text-[10px]`, `text-[11px]` mezclados con `text-xs`.
**Fix sugerido:** consolidar en el `Guidelines.md` del frontend una escala (H1/H2/H3/body/caption) y convertir los `text-[9px]` a utilities nombrados (`text-caption`, `text-micro`). Regla simple: evitar tamaños arbitrarios fuera de `2xl, xl, lg, base, sm, xs`.

### 3.4 Progreso del home usa color como único canal semántico
**Archivo:** `Home.tsx` líneas 96–124
**Problema:** el anillo cambia de dorado a verde al llegar a 100% (línea 103), sin ícono ni texto adicional. Para daltonismo rojo-verde y lectores de pantalla, esto es invisible.
**Fix sugerido:** agregar un `CheckCircle2` dentro del anillo cuando `progressPercent === 100` y un `aria-label` tipo "5 de 5 visitas completadas".

### 3.5 Mapas con alto fijo no responsive
**Archivo:** `RouteList.tsx` línea ~207 (`height: "calc(100vh - 200px)"`) y mapas en `NewPointOfSale.tsx`.
**Problema:** al aparecer el teclado virtual, `100vh` no se ajusta y el mapa se sale de la vista. También falta fallback cuando Google Maps no carga (sin key, sin data, offline).
**Fix sugerido:** usar `100svh` (small viewport) o `100dvh` (dynamic) según soporte; máximo 60vh en listas. Renderizar un `<EmptyState>` si el SDK de Google Maps falla en cargar.

### 3.6 Modales sin `max-h` + `overflow-y-auto`
**Archivo:** modal de edición en `PointOfSaleDetail.tsx` líneas 1001–1413
**Problema:** el formulario crece con muchos campos (horarios, canal, subcanal, contactos, distribuidores, día de visita). En pantallas 320–360px el footer con los botones se va debajo del viewport.
**Fix sugerido:** el contenedor del modal con `max-h-[calc(100dvh-2rem)] overflow-y-auto`, footer con `sticky bottom-0 bg-card border-t`.

### 3.7 Modales heterogéneos
**Archivos:** `ConfirmModal`, `Modal`, `QuickContactsModal`, `ForcePasswordChangeModal`, `PendingSyncSheet` — conviven dialog custom y shadcn `Dialog/Sheet`.
**Fix sugerido:** migrar a un único sistema (shadcn `Dialog` para modales y `Sheet` para drawers mobile) con tamaños estandarizados (`sm`, `md`, `lg`). Eliminar el `Modal` custom si no aporta.

### 3.8 Uso de `details/summary` para "Otros usuarios demo" en Login
**Archivo:** `Login.tsx` líneas 157–176
**Problema:** es funcional pero visualmente rompe el ritmo del card (el triángulo nativo del navegador no matchea el diseño oscuro con gold). Además el texto `[11px]` es demasiado pequeño.
**Fix sugerido:** reemplazar por un botón "Ver más usuarios" que expanda con estado local, estilado en la misma línea que el resto.

---

## 4. Gating de permisos TM

### 4.1 Edición de PDV: campos sensibles sin gatear para TM
**Archivo:** `PointOfSaleDetail.tsx` líneas 1001–1413
**Problema:** solo "Día de visita" (línea 1137) está gateado. Canal, subcanal, coordenadas, territorio, distribuidores, etc. no tienen check de rol.
**Fix sugerido:** definir explícitamente qué puede editar un TM (posible lista: notas, contactos, foto del frente). Gatear el resto con `readOnly` + mensaje tooltip.

### 4.2 Alta de PDV accesible para TM
**Archivo:** `routes.tsx` línea 62 (`path: "new-pos"`), botón en `Home.tsx` ~línea 264.
**Problema:** no queda claro si un TM debería poder crear PDVs nuevos o es una tarea supervisora/admin. Ahora mismo el botón aparece para todos.
**Fix sugerido:** confirmar con producto. Si se permite, validar unicidad/coordenadas; si no, gatear el botón y la ruta.

### 4.3 Borrado de nota / resolver alerta
**Archivos:** `PointOfSaleDetail.tsx` (notas) y `Alerts.tsx` líneas 97–117 (crear/resolver alertas).
**Problema:** un TM puede resolver alertas que quizás debería ver solo el supervisor.
**Fix sugerido:** definir quién puede cerrar incidencias y aplicar el check.

### 4.4 Ruta `my-routes/generate` potencialmente sensible
**Archivo:** `routes.tsx` línea 51 → `RouteGeneratorPage.tsx`.
**Problema:** si el generador crea rutas automáticas con lógica de negocio (optimización geográfica, inclusión de PDVs fuera de la cartera del TM), debería limitarse.
**Fix sugerido:** revisar el código del generador y decidir si permanece como self-service para TM o pasa al supervisor.

---

## 5. Accesibilidad — quick wins

### 5.1 Botones icon-only sin `aria-label` consistente
**Archivos:** `Layout.tsx` líneas 32–85 (bottom nav, aunque tiene `<span>` visible OK), `PointOfSaleDetail.tsx` ediciones/borrado, toggles de vista en `RouteList.tsx`.
**Fix sugerido:** agregar `aria-label="Editar PDV"` / `aria-label="Eliminar PDV"` a cada botón icon-only.

### 5.2 Inputs sin `htmlFor` explícito en forms complejos
**Archivo:** `PointOfSaleDetail.tsx` modal de edición usa `<label>` con texto pero sin `htmlFor`. El `Input` tampoco tiene `id`.
**Fix sugerido:** darles `id` + `htmlFor` pareados. Shadcn `Label`/`Input` lo soportan directo.

### 5.3 Foco visible en navegación por teclado
**Problema:** no hay evidencia de `focus-visible` explícito en los botones custom de la bottom nav (`Layout.tsx`). Apple Switch Control y teclados externos dependen de esto.
**Fix sugerido:** agregar clase `focus-visible:ring-2 focus-visible:ring-espert-gold` al `<button>` de la nav.

### 5.4 Color dorado sobre fondo oscuro cerca del umbral AA
**Archivo:** `Login.tsx` `#A48242` sobre `#1A1A18` — ratio ~4.3:1 (apenas debajo de 4.5 para texto normal AA).
**Fix sugerido:** usar `#C9A962` (hover actual) como base para texto o engrosar a 500+. Chequear con `https://webaim.org/resources/contrastchecker/`.

---

## 6. Observaciones positivas

- **Safe area insets** bien aplicados en el top y bottom del `Layout` (líneas 21, 30).
- **OfflineBanner** existe como componente dedicado; se nota intención de UX offline-first.
- **Cola de sync con `executeOrEnqueue`** y tempIds negativos es un diseño sólido para campo con señal intermitente (bug 1.2 aparte).
- **Sonner toasts** usados de forma consistente en vez de `alert()`.
- **Componentes de dominio reutilizables** (`DateSelector`, `GpsCaptureButton`, `QuickContactsModal`, `LocationMap`) reducen duplicación.
- **Tracking de tiempo por formulario** en `SurveyForm` (`ElapsedSeconds`) sin molestar al usuario — útil para analytics sin fricción.
- **Login con accesos rápidos demo** pensado para presentaciones/QA es un detalle práctico.

---

## 7. Tabla consolidada

| # | Hallazgo | Archivo | Línea(s) | Sev. |
|---|---|---|---|---|
| 1.1 | `/admin` accesible para TM | `routes.tsx` · `Layout.tsx` | 70–85 · 10–14 | Crítico |
| 1.2 | `visit.VisitId` fuera de scope en offline | `CheckIn.tsx` | 145–201 | Crítico |
| 1.3 | Editar/Eliminar PDV sin gating | `PointOfSaleDetail.tsx` | 493–498 | Crítico |
| 1.4 | `confirm()` para acciones destructivas | `Profile.tsx` et al. | 87 | Crítico |
| 2.1 | Botón check-in = mismo estilo fuera de rango | `CheckIn.tsx` | 593–627 | Alto |
| 2.2 | Sin skeletons | varios | — | Alto |
| 2.3 | Sin confirmación de cambios al salir | `PointOfSaleDetail.tsx` et al. | 1001–1413 | Alto |
| 2.4 | Sin paginación en listas | `RouteList.tsx` | 54–59 | Alto |
| 2.5 | Navegación atrás inconsistente | varios | — | Alto |
| 2.6 | Empty states inconsistentes | `Alerts.tsx`, `History.tsx`, … | — | Alto |
| 2.7 | `setTimeout(1500)` tras check-in | `CheckIn.tsx` | 197–201 | Alto |
| 3.1 | Touch targets < 44px | `PointOfSaleDetail.tsx` et al. | 493–498 | Medio |
| 3.2 | Sin `safe-area-inset-bottom` en CTAs | `CheckIn.tsx` et al. | 589 | Medio |
| 3.3 | Jerarquía tipográfica inconsistente | varios | — | Medio |
| 3.4 | Progreso = solo color | `Home.tsx` | 96–124 | Medio |
| 3.5 | Mapas con alto fijo y sin fallback | `RouteList.tsx` | ~207 | Medio |
| 3.6 | Modales sin scroll vertical | `PointOfSaleDetail.tsx` | 1001–1413 | Medio |
| 3.7 | Modales heterogéneos | varios | — | Medio |
| 3.8 | `details/summary` nativo rompe estilo | `Login.tsx` | 157–176 | Bajo |
| 4.1 | Edición completa de PDV para TM | `PointOfSaleDetail.tsx` | 1001–1413 | Medio |
| 4.2 | Alta de PDV sin gating | `routes.tsx` · `Home.tsx` | 62 · ~264 | Medio |
| 4.3 | Resolver alertas sin gating | `Alerts.tsx` | 97–117 | Medio |
| 4.4 | Generador de rutas self-service | `RouteGeneratorPage.tsx` | — | Medio |
| 5.1 | Icon-only sin `aria-label` | varios | — | Medio |
| 5.2 | Inputs sin `htmlFor` | `PointOfSaleDetail.tsx` | 1001–1413 | Medio |
| 5.3 | Falta `focus-visible` en nav | `Layout.tsx` | 32–85 | Bajo |
| 5.4 | Contraste dorado borderline | `Login.tsx` | — | Bajo |

---

## 8. Sugerencia de orden de ataque

**Primera tanda (1–2 días, quick wins con mucho retorno):**

1. Fix del `visit.VisitId` offline (1.2) — bug real que rompe.
2. Guardia de rol para `/admin` (1.1).
3. Gating de botones Editar/Eliminar en `PointOfSaleDetail` (1.3) + reemplazo de `confirm()` por `ConfirmModal` (1.4).
4. Botón de check-in con estilo diferenciado cuando GPS fuera de rango (2.1).

**Segunda tanda (foco en UX de campo, ~1 semana):**

5. Skeletons en Home, PDV detail y listas (2.2).
6. Confirmación de cambios sin guardar en modal de PDV y encuesta (2.3).
7. Paginación/virtualización en `RouteList` (2.4).
8. `safe-area-inset-bottom` en páginas con CTA (3.2).

**Tercera tanda (sistema de diseño, para estabilizar):**

9. Unificar modales en `Dialog`/`Sheet` (3.7).
10. Definir y aplicar escala tipográfica + spacing en `Guidelines.md` (3.3).
11. Revisar con producto qué edita un TM y qué no (4.1, 4.2, 4.4).
12. Pasada de accesibilidad (5.1–5.4).

---

*Revisión generada a partir de lectura estática del código; conviene validar los puntos del apartado 4 (permisos) con producto antes de implementar cambios que oculten funcionalidad existente.*
