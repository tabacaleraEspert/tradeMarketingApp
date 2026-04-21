# Revisión UX — Journey del TM en campo

**Fecha:** 2026-04-21
**Alcance:** la experiencia del Trade Rep (`vendedor`) desde que abre la app a la mañana hasta el cierre de jornada, leyendo el flujo como un todo y no página por página.
**Foco:** **usabilidad en condiciones de campo reales** (sol, guantes, una mano, señal intermitente, batería, interrupciones por llamada, presión de tiempo).
**Diferencia con los 4 informes anteriores:** esta revisión no lista problemas por archivo; los lista por momento del día y por condición de uso. Cuando hace falta, referencia los informes previos (`frontend-review-tm-mobile.md`, `frontend-review-tm-mobile-rest.md`).

---

## 0. Resumen ejecutivo

Si hay que quedarse con tres cosas de este informe:

1. **La pantalla `/sync` miente.** Lee datos de `app/data/mockData.ts` (no del sistema offline real en `lib/offline/queue.ts`) y el botón "Sincronizar Ahora" corre un spinner falso de 3 s con `setInterval` y hace `toast.success("Sincronización completada")` sin tocar la cola real. Un TM en campo confía en esa pantalla para saber si sus datos están seguros. Hoy no puede confiar. Prioridad 0.
2. **Para arrancar la encuesta de un PDV hacen falta 3 taps + 1 espera artificial** desde Home: tocar el card "Siguiente visita" → leer/desestimar el detail del PDV → tocar "Iniciar Visita — Check-in" → tocar "Confirmar Check-in" → esperar `setTimeout(1500)` antes de llegar al relevamiento. En una jornada de 8 PDVs son ~24 taps + 12 s de esperas artificiales, todo con guantes y con sol pegando en la pantalla.
3. **No hay un "modo campo" pensado**: la tipografía está calibrada para revisión en interior (`text-[10px]` y `text-[9px]` en headers y metadata), los botones secundarios caen bajo 44 px, no se pide confirmación para acciones destructivas costosas, y en momentos claves (después del check-in GPS-out-of-range, al perder señal en medio de una foto) el feedback es un toast que pasa en 3 s y se pierde.

El resto del informe es la narrativa de la jornada con hallazgos específicos para cada paso, seguido de una sección transversal sobre condiciones de campo.

---

## 1. El día del TM, paso por paso

### 1.1 Arranque — abrir la app en el auto antes de salir

**Pantallas:** `Login.tsx` → `Home.tsx`.

**Lo que pasa bien:**
- El `Home.tsx:141–182` muestra un **card "Siguiente visita"** con el próximo PDV y el siguiente paso a dar (check-in o relevar). Es el mejor componente del flujo: reduce la decisión del TM a "seguir el botón grande". Hay que cuidarlo.
- El progress ring (líneas 99–131) da un pulso rápido de "dónde estoy en el día". El cambio a CheckCircle2 cuando llega al 100% (línea 113) es un cierre claro.
- El `greeting` (líneas 62–65) da un toque humano sin ocupar espacio.

**Fricciones de arranque:**

- **Overload de la Home.** La Home del TM hoy muestra: greeting, progress ring, card "Siguiente", card "Ruta completada" (si aplica), botón "Ver ruta completa", banner de alertas, 3 KPIs mensuales (`monthlyStats`), 4 quick actions ("Alta PDV", "Mis Rutas", "Buscar", "Cierre"), botón "Panel Admin" (si admin), y preview de "Próximos PDVs". Son ~10 bloques visuales en menos de dos pantallas. Para un TM que tiene 10 s para decidir antes de arrancar el auto, es ruido. Los KPIs mensuales y el banner de alertas son importantes pero no son el _next step_.
  - **Fix:** priorizar verticalmente. Primera pantalla visible (above fold) solo: greeting + ring + card "Siguiente". Todo lo demás abajo, con jerarquía. Los KPIs mensuales pueden vivir en `Profile`.

- **"Alta PDV" a un tap del Home confunde la intención.** El CTA para crear un punto de venta nuevo tiene el mismo peso visual que "Mis Rutas", "Buscar" y "Cierre" (grid 4×1 con íconos gold idénticos, `Home.tsx:270–289`). El alta de PDV es una acción rara (una o dos por semana) y sensible (backend valida GPS, duplicados, etc.); estar al nivel de "Buscar" invita a errores.
  - **Fix:** mover "Alta PDV" a una acción secundaria dentro de `Buscar PDV` ("¿No encontrás el PDV? Crear nuevo"). Al mismo nivel de prioridad que "Cierre" no debería estar.

- **"Cierre" habilitado aunque falten visitas.** El botón de `Home.tsx:285–288` navega a `/end-of-day` sin importar si hay visitas pendientes. Un TM con 3 visitas abiertas puede cerrar la jornada sin querer — el `EndOfDayPage` las muestra como "pendientes" pero no obliga a cerrarlas.
  - **Fix:** si `pendingVisits > 0`, el botón pide confirmación: "Te quedan 3 visitas sin hacer. ¿Cerrar la jornada igual?".

- **No hay un indicador explícito de "última sync".** Cuando el TM sube al auto y abre la app puede estar en una zona con Wi-Fi (hogar) o no (estación de servicio). Hoy la app **no le dice si los datos que ve son recientes** — no hay "Actualizado hace 2 min" en la Home.
  - **Fix:** agregar un chip discreto al lado del date picker que muestre "Actualizado 07:14" o "Offline desde 06:20".

### 1.2 Decidir el orden y arrancar — el salto del Home al check-in

**Pantallas:** `Home.tsx` → `PointOfSaleDetail.tsx` → `CheckIn.tsx` → `SurveyForm.tsx`.

**El problema central: 3 taps + 1 espera para iniciar el relevamiento del primer PDV.**

El card "Siguiente visita" del Home navega a `PointOfSaleDetail` (`Home.tsx:145`), no al check-in. En PDV detail, el TM tiene que tocar "Iniciar Visita — Check-in" (`PointOfSaleDetail.tsx:898–909`) que lo lleva a `CheckIn`. Ahí toca "Confirmar Check-in" (`CheckIn.tsx:613–627`), y después de un `setTimeout(1500)` (líneas 197–201) aparece el relevamiento.

```
Home → [tap 1] → PDV Detail → [tap 2] → Check-in screen → [tap 3] → espera 1.5s → Survey
```

Para los PDVs de _la misma ruta_ esto se repite **en cada visita** del día. En 8 visitas son 24 taps y ~12 s de esperas artificiales sólo para llegar a escribir el primer dato.

**Fixes posibles (en orden de agresividad):**

1. **Quick win:** el card "Siguiente visita" del Home debería navegar directamente a `CheckIn` cuando `step === "checkin"` (línea 50), y a `SurveyForm` cuando `step === "relevamiento"` (línea 47). Se salta el step intermedio de PDV detail.
2. **Medio:** en `CheckIn`, sacar el `setTimeout(1500)` y navegar apenas termina la promesa (ya reportado en informe 2, 2.7).
3. **Agresivo pero recomendable:** si el TM llega a un PDV que ya tiene check-in hecho en la ruta de hoy, saltearse el paso de `PointOfSaleDetail` y llevarlo directo al último paso sin completar (relevamiento si no está / fotos si sí / acciones si sí / summary).

**Decisión adicional:** el card "Siguiente" decide automáticamente el PDV basado en status (`Home.tsx:44–52`), pero no respeta el orden geográfico de la ruta. Si el TM hizo mal el orden y el "siguiente" según la app está a 20 km, la app lo manda ahí en vez de al más cercano. Al menos la lista de "Próximos PDVs" debería ofrecer el botón "Reordenar por distancia".

### 1.3 Llegar al PDV — el check-in GPS

**Pantallas:** `CheckIn.tsx`, `GpsCaptureButton.tsx`.

**Lo que pasa bien:**
- La lectura de GPS arranca en `watchPosition` al montar (`CheckIn.tsx:128–133`), así que cuando el TM abre el CheckIn la ubicación ya se está capturando — no hace falta esperar que él toque un botón.
- Los toast de error del `GpsCaptureButton` (líneas 48–60) son específicos: distingue "permiso denegado", "GPS no disponible", "timeout". Mucho mejor que "error".
- Hay un banner ámbar (`CheckIn.tsx:592–611`) explicando si estás fuera del perímetro o si el PDV no tiene coordenadas, diciendo "queda marcado como alerta para tu supervisor". Es honestidad útil.

**Fricciones en campo:**

- **El botón "Iniciar visita igual" tiene el mismo estilo que "Confirmar Check-in"** (ya reportado en informe 1, 2.1). En sol pegando, el TM no nota la diferencia y confirma sin querer algo que queda flagueado al supervisor.
- **No hay recuperación si GPS tarda más de 15 s.** `enableHighAccuracy: true, timeout: 15000` (línea 131); si falla, el UI se queda en `gpsStatus === "checking"` y el botón "Esperando GPS...". Un TM en una calle con poca recepción se queda congelado; el único escape es salir y volver a entrar.
  - **Fix:** botón "Saltar GPS y hacer check-in igual" visible tras 10 s de "checking".
- **El offline check-in tiene un bug real** — `visit.VisitId` está fuera de scope (informe 1, 1.2). En campo con señal cortada se rompe el flujo.
- **No hay batería visible en ningún momento.** El `watchPosition` con `enableHighAccuracy: true` es costoso. Un indicador chico de "GPS activo" ayudaría al TM a cerrar la app entre PDVs.

### 1.4 La encuesta — el trabajo largo

**Pantallas:** `SurveyForm.tsx`.

**Fricciones que golpean más en campo:**

- **Ícono `WifiOff` estático y mentiroso** en el header (`SurveyForm.tsx:346–348`): siempre muestra "sin conexión" aunque haya señal, y el botón no hace nada (ya reportado en informe 2, 1.3). En campo confunde: el TM piensa que no tiene señal cuando sí.
- **No hay guardado automático.** `handleSaveDraft` guarda explícitamente cuando el TM toca "Borrador" (líneas 276–282). Si llega una llamada, si se queda sin batería y el teléfono se apaga, si hay un crash — las respuestas que escribió a mano no están guardadas.
  - **Fix:** `setInterval` que haga `saveDraft` cada 30 s si hay cambios. En offline, encolar. Es la clase de cosa que se nota sólo cuando se pierde trabajo y se vuelve imposible defender.
- **Al salir con Back sin guardar, no hay "descartar cambios?"** (ya reportado en informe 1, 2.5).
- **Si hay muchas preguntas, no hay "ir a primera obligatoria sin responder".** El TM tiene que scrollear hasta encontrar qué falta.
  - **Fix:** al intentar finalizar, mostrar toast + scroll automático a la primera obligatoria sin responder.
- **Los dos botones finales** ("Borrador" y "Finalizar y Continuar") tienen peso visual parecido (informe 2, 3.1). En sol, el TM que quería finalizar toca borrador o viceversa.

### 1.5 Acciones y fotos — evidencia de la visita

**Pantallas:** `VisitActionsPage.tsx`, `PhotoCapture.tsx`.

**Fricciones específicas de campo:**

- **`PhotoCapture` permite "Continuar" aunque falten fotos obligatorias** (informe 2, 3.3). En campo con apuro, el TM toca Continuar, recibe el toast de error, y tiene que re-scrollear para entender qué foto falta. Sin `disabled` no hay fricción preventiva.
- **Las fotos se borran con `window.confirm()`** (`PhotoCapture.tsx:164`), ya reportado en informe 1. En mobile con guantes un tap erróneo en el tacho borra una foto sin deshacer.
- **No hay compresión ni feedback de tamaño**. Si el TM sube una foto de 6 MB desde la cámara, el upload/sync consume datos y batería. No hay indicador de "Subiendo 4.2 MB" ni compresión automática.
  - **Fix:** comprimir client-side a 1280px longest-edge y JPEG q0.85 antes de encolar o subir. Reduce 6 MB a ~400 KB sin pérdida visible.
- **`VisitActionsPage` no muestra qué acciones son obligatorias hoy según la ruta.** El TM puede cerrar la visita sin ejecutar una "Promo" obligatoria. `MandatoryActivityManagement.tsx` existe en el admin pero no vimos indicadores en campo de "faltan X acciones obligatorias".
  - **Fix:** tarjeta arriba de `VisitActionsPage` con "Pendientes de esta visita: 2/3 obligatorias completadas".

### 1.6 Cierre de visita — el summary

**Pantallas:** `VisitSummaryPage.tsx`.

- **El botón principal es rojo** (`bg-red-600`, informe 2, 1.2). En la última interacción de la visita, el color destructivo atrasa.
- **`reminderForNext`** (líneas 359–363) es un textarea útil pero sin autosave: si el TM escribe "Llamar el viernes a Juan" y toca atrás en vez de "Cerrar Visita", se pierde.
- **No hay preview de lo que se va a enviar.** El summary muestra lo hecho pero no dice "Se van a enviar X respuestas + Y fotos + Z acciones". Un TM reflexivo puede querer ver eso antes de cerrar.

### 1.7 Entre PDVs — traslado, sync y alertas

**Lo crítico acá es la pantalla `/sync`.**

`Sync.tsx` importa `syncStatus` de `app/data/mockData.ts` (línea 18), que tiene valores **hardcodeados**:

```ts
export const syncStatus = {
  lastSync: "2026-02-23T08:00:00",   // hace 2 meses
  pendingRecords: 3,
  pendingPhotos: 2,
  isOnline: true,
};
```

El botón "Sincronizar Ahora" (líneas 226–242) ejecuta:

```ts
const interval = setInterval(() => {
  setSyncProgress((prev) => prev >= 100 ? 100 : prev + 10);
}, 300);
// …toast.success("Sincronización completada")
```

Es un **spinner falso de 3 segundos que no toca la cola real** en `lib/offline/queue.ts`. La cola real tiene su propio worker (`lib/offline/sync-worker.ts`) y un componente distinto (`PendingSyncSheet.tsx`) para ver operaciones reales — pero la pantalla que el TM abre desde el bottom nav "Sync" no usa ninguno de los dos.

**Impacto en campo:** el TM que vuelve al auto entre visitas y quiere confirmar "¿se subieron mis fotos?" abre la pantalla de sync, ve "3 registros pendientes" (que es lo que mostró hace un mes y lo que va a mostrar mañana), toca Sincronizar, ve "Sincronización completada" y se va tranquilo. Si había un problema real, no lo supo. Si la cola real tenía 50 items, la pantalla le dijo que solo había 3.

**Fix urgente:**
1. Borrar la dependencia a `mockData.syncStatus`.
2. Conectar a `queue.list()` / `queue.count()` / `subscribeQueueChanges()` que ya existen en `lib/offline/queue.ts`.
3. El botón "Sincronizar Ahora" debe llamar al trigger del `sync-worker.ts` (idealmente el mismo que usa `PendingSyncSheet.tsx`).
4. El `isOnline` debe escuchar `window.online/offline` como hace `OfflineBanner.tsx`.

**Severidad:** Crítica. Es el único hallazgo de los cinco informes que rompe la promesa central del producto ("trabajá offline, nosotros te sincronizamos cuando vuelva la señal"). Mientras esta pantalla esté así, la promesa no se puede verificar desde la app.

Aparte de este tema, entre PDVs también hay que pensar:

- **El banner de alertas en Home** es un link a `/alerts`, pero el TM tiene que volver a Home para verlo; ninguna notificación push. Si un supervisor abre una incidencia urgente para su PDV actual, el TM no se entera hasta que toca "Home".
  - **Fix:** integrar con web push notifications; al menos un polling cada N min de `notifications.list({user_id})` en el background.

### 1.8 Cierre de jornada

**Pantalla:** `EndOfDayPage.tsx`.

**Lo bueno:** la página muestra un resumen honesto — KPIs cuadrados (visitas planeadas vs hechas, compliance, duración promedio, acciones ejecutadas), compliance bar, actions by type, y el detalle por PDV. Es probablemente la mejor "vista resumen" del mobile.

**Fricciones:**

- El botón final dice "Volver al Inicio" (línea 250). No hay un "Cerrar sesión / Cambiar de día" explícito. Un TM que termina su turno y va a pasarle el celular a otro no sabe qué hacer.
- No consolida las pendientes reales de sync antes del cierre. Un TM puede ver "3 visitas cerradas" pero no se entera de que 2 de esas fotos aún están en la cola local.
  - **Fix:** arriba del botón, un chip "Datos sin sincronizar: 4 items. Conéctate a Wi-Fi antes de guardar el celular".
- **Resumen de día es solo para el rol `vendedor` + fecha "hoy"** (implícito en `today = new Date()`). Si el TM quiere revisar lo que hizo ayer, no hay selector de fecha.

---

## 2. Fricciones por condición de campo

Esta sección re-organiza hallazgos del journey y de los informes previos, pero mirados desde la condición física que los golpea.

### 2.1 Uso con guantes / dedos gruesos

El umbral de HIG/Material es 44×44 px. Debajo de eso, con guantes de trabajo, la precisión cae a niveles inútiles.

- Botones "Hoy" y date picker en Home (`Home.tsx:78–92`): `px-2.5 py-1.5` y `px-2.5 py-1` con `text-[10px]/text-sm` → ~28–32 px.
- Botones "Hoy" y date picker en `RouteFocoPage.tsx:171–181` (informe 2, 2.2).
- Ícono Eliminar avatar en `Profile.tsx:138–146` (informe 2, 2.1): `p-1.5` + `Trash2 size={12}` → ~24 px.
- Iconos edit/delete PDV en `PointOfSaleDetail.tsx:493–498` (informe 1, 3.1): `size="sm"` → ~32 px.
- Grip/chevron en listas, X de cerrar modales, check de "marcar como resuelto" en notas — todos en rangos de 24–32 px.

**Fix transversal:** auditar todos los `<button>` sin text child y exigir `p-2.5` mínimo (40 px con ícono 16–20) o idealmente `h-10 w-10` (40 px), y preferentemente `h-11 w-11` (44 px, mínimo HIG).

### 2.2 Sol directo / brillo alto en la pantalla

El contraste cae y los colores se des-saturan bajo luz directa.

- **Tipografía micro**: `text-[8px]`, `text-[9px]`, `text-[10px]`, `text-[11px]` salpicados en Home, PointOfSaleDetail, History, SurveyForm. Debajo del umbral de legibilidad incluso con visión 20/20 indoor.
- **Dorado espert `#A48242`** sobre fondos claros y oscuros: en sol, es borderline AA. En `Login.tsx:107` (botón primario) y como color de acento ubicuo.
- **Banners ámbar con texto `amber-700`**: CheckIn, PhotoCapture, Sync. Bajo luz, casi se pierde contra el fondo pastel.
- **Botón "Iniciar visita igual" sin diferenciación visual** cuando GPS está out-of-range — el único indicador es el texto del label, que en sol el TM no lee.

**Fix transversal:** definir una "modo sol" implícito: toda tipografía mínima `text-sm` (14 px) en áreas operativas, contraste WCAG AAA (7:1) para texto crítico, y para acciones con consecuencias (check-in fuera de rango, borrar foto), color + ícono + shape distintos.

### 2.3 Uso con una mano sola (la otra sostiene mercadería, un contacto, la moto)

- **Bottom nav bien ubicado** (`Layout.tsx:30–86`) — pulgar alcanza.
- **Botones principales en la parte inferior de cada pantalla** — bien.
- **Pero hay páginas con CTA arriba (`Volver` flechas) y con botones de acción a la mitad de la pantalla (Home)** — forzan reach-up.
- **Modales con scroll vertical interno** (modal de edición en `PointOfSaleDetail`) obligan a dos manos.
- **Teclado virtual** oculta botones de acción que no están sticky bottom — pasa en `NewPointOfSale`, `SurveyForm` en campos text largos.

**Fix transversal:** todos los formularios de entrada de datos deben tener sticky bottom con el CTA principal que nunca se tape con teclado. `pb-[env(keyboard-inset-height)]` o equivalente polyfill.

### 2.4 Señal intermitente

La app tiene la infraestructura offline (queue, sync worker, visit-id-map) pero la superficie UX no la refleja consistentemente.

- **`OfflineBanner`** aparece cuando `navigator.onLine` es false. Pero `navigator.onLine` es notoriamente poco fiable en mobile — puede decir "online" con red WiFi sin internet. No se combina con un "health check" activo.
- **`/sync`** es falso (sección 0.1).
- **El flujo offline del check-in tiene un bug** (informe 1, 1.2) que rompe la navegación.
- **No hay feedback de "estoy encolando esto"** cuando el TM hace una acción offline. El toast dice "Se sincronizará cuando vuelva la señal" pero no hay un contador visible de "tenés 7 operaciones en cola".
- **`PendingSyncSheet.tsx`** es un buen UI para ver la cola, pero está escondido — solo se llega desde el indicador flotante `PendingSyncIndicator` que aparece solo si hay operaciones. El TM no sabe que existe hasta que ya tiene problemas.

**Fix transversal:** exponer la cola real en un único lugar en la bottom nav (sustituir la pantalla falsa de `/sync`). Mostrar contador en el ícono permanentemente (badge) cuando cola > 0.

### 2.5 Batería

El campo = 8–10 horas con el GPS encendido. Sin optimizaciones:

- **`watchPosition` con `enableHighAccuracy: true`** en CheckIn (línea 131) se mantiene activo hasta desmontar. Si el TM deja la pantalla abierta "a la espera", el GPS drenea batería.
- **Google Maps sin lazy loading** en RouteList/MyRoutes. El SDK de Maps carga al entrar y el mapa rinde en continuo.
- **`setInterval(1000)` para reloj** no está en mobile (bien), pero sí en `PlantLayout`.
- **Sin `visibilitychange` listener para pausar polling** cuando la app va a background. El TM que mete el celular en el bolsillo no apaga los refetchs.

**Fix transversal:**
- `watchPosition` con `enableHighAccuracy: false` (acelerometer-based) como default, y solo pasar a alta precisión durante el momento puntual de check-in.
- Pausar hooks de refresh cuando `document.hidden === true`.
- Lazy-load mapa solo cuando la vista de mapa está activa, no cuando el TM está en vista de lista.

### 2.6 Interrupciones (llamada entrante, notificación de WhatsApp del supervisor)

Todo estado no persistido se pierde cuando el TM vuelve a la app.

- `SurveyForm` sin autosave (ver 1.4).
- `NewPointOfSale` con todos los campos en React state.
- `VisitActionsPage` con la acción que se estaba redactando.
- Modal de edición de PDV con formulario a medio llenar.

**Fix transversal:** cada formulario persiste draft en IndexedDB keyed por `{userId}:{pdvId}:{form}` con TTL. Al volver, pre-carga y muestra banner "¿Seguir donde habías dejado?".

### 2.7 Presión de tiempo

**Contar taps por tarea es un buen ejercicio:**

- Iniciar relevamiento desde Home: **4 interacciones** (tap Siguiente → (leer PDV) → tap Check-in → tap Confirmar → espera 1.5 s). Debería ser 2.
- Sacar una foto obligatoria: abrir PDV → Fotos → elegir categoría → cámara → aceptar → guardar. Mínimo 4 taps.
- Marcar una alerta como resuelta: Home → Alertas → click alerta → acciones → confirmar. 4 taps.
- Agregar una nota rápida a un PDV: abrir PDV detail → scroll a notas → escribir → enviar. 3 taps + scroll + teclado.

**Fix transversal:** shortcuts para las acciones más frecuentes. Quick actions en el card "Siguiente" del Home ("Check-in", "Foto rápida") que se salteen el PDV detail. Floating action button para "Agregar nota" visible desde PDV detail sin scroll.

---

## 3. Dead-ends y recuperación de errores

Cómo se comporta la app cuando algo sale mal — área menos pulida.

### 3.1 PDV no encontrado

`SurveyForm.tsx:319–325`: si `pdv` es null, muestra centrado "PDV no encontrado" sin botón de volver. El TM queda atascado en esa pantalla hasta tocar back del navegador/OS. Lo mismo en `PointOfSaleDetail`, `CheckIn`, `VisitActionsPage`, `PhotoCapture`.

**Fix:** empty state con ícono + texto + botón "Volver" o "Ir a Home" en TODOS los empty/error states.

### 3.2 Error 403 / permiso denegado

No hay un handler centralizado para 403 del backend. Si el backend le dice al TM "no podés modificar este PDV", lo que ve es un `toast.error(err.message)` con el texto crudo del backend (que puede ser "Forbidden" o algún string técnico).

**Fix:** interceptar 403 en `lib/api/client.ts` y mostrar un mensaje consistente: "No tenés permisos para esta acción. Contactá a tu supervisor.".

### 3.3 GPS permiso denegado — dead-end real

Si el TM toca "No permitir" en la primera pregunta de ubicación, `GpsCaptureButton.tsx:49–51` muestra un toast y ya — no hay ayuda para volver a activarlo.

**Fix:** pantalla explicativa con instrucciones específicas (pasos Chrome Android, Safari iOS) cuando `permission === "denied"`. Link directo a `chrome://settings/content/location` donde posible.

### 3.4 Token expirado

`auth.ts:63` evalúa `isAuthenticated()` mirando el access token local pero no valida su vigencia. Si el token venció mientras el TM estaba offline, cada llamada al backend responde 401. El `Layout.tsx` no tiene handler — asume auth OK y muestra la UI; cada request falla con toast.

**Fix:** interceptar 401 global, hacer refresh token automático, y si el refresh también falla, mostrar modal "Tu sesión expiró, iniciá sesión de nuevo" con redirect a `/login`.

---

## 4. Quick wins — 10 cosas de alto impacto ordenadas por ROI

1. **Conectar `/sync` a la cola real** — elimina el peor engaño de la app. Unas horas de trabajo con los módulos ya existentes.
2. **Autosave en `SurveyForm` cada 30 s** — protege contra llamadas, crash y batería baja.
3. **`disabled` en los CTAs de PhotoCapture cuando faltan obligatorias y en NewPointOfSale cuando addressOutOfRange** — fricción preventiva en vez de error reactive.
4. **Agregar confirmación al "Descartar todo" de `PendingSyncSheet`** — evita pérdida de datos por error.
5. **Botón "Cerrar jornada" del Home pide confirmación si hay pendientes** — evita cierre accidental.
6. **Home → CheckIn/Survey directo** (saltear PDV detail si tiene `step`) — reduce tiempo a tarea en ~30%.
7. **Compresión de fotos client-side** — ahorra datos y batería, acelera sync.
8. **Borrar el `<WifiOff>` estático y mentiroso de `SurveyForm` header** — ya flagueado, quick fix de 2 líneas.
9. **Sustituir `bg-red-600` por primario en "Cerrar Visita y Check-out"** — 1 línea, cierra un golpe visual confuso.
10. **Audit de touch targets < 44 px** — un sprint de polish que cambia la sensación general de "pro".

---

## 5. Idea más grande: un "Modo Campo" explícito

Hoy la app tiene los componentes para un buen mobile-first pero les falta el concepto paraguas. Vale la pena considerar una preferencia de usuario `fieldMode: boolean` (o auto-activada cuando `outdoor`/`high-brightness` detectado) que:

- Aumenta toda tipografía una escala (`sm` → `base`, `xs` → `sm`).
- Engorda todos los touch targets (`p-2` → `p-3`, `h-10` → `h-12`).
- Sube contraste: negros más negros, blancos más blancos, colores de estado saturados.
- Oculta secciones no esenciales (KPIs mensuales en Home, resumen de últimos PDVs) dejando solo el next step.
- Deshabilita animaciones (`motion-reduce`) — ahorran CPU y evitan confusión en sol.
- Activa autosave agresivo en formularios.
- Pre-carga el próximo PDV (prefetch de survey, historial, contactos) en background para que al llegar el TM ya tenga todo.

No hace falta que sea un toggle visible — puede ser implícito por hora del día, por GPS moving, por `userAgent`, o por rol. Pero pensar explícitamente en "uso en campo" vs "uso en oficina" desbloquea decisiones de diseño que hoy están en el medio.

---

## 6. Referencias cruzadas

Esta revisión no reemplaza los cuatro informes anteriores: cita casos puntuales pero los clasifica por journey/condición en vez de por archivo. Para fixes concretos con archivo/línea, seguir usando:

- `docs/frontend-review-tm-mobile.md` — flujos core
- `docs/frontend-review-tm-mobile-rest.md` — resto del mobile + componentes
- `docs/frontend-review-admin.md` — panel admin
- `docs/frontend-review-plant.md` — vista planta

---

## 7. Cosas que NO están en este informe pero conviene hacer aparte

- **Research con TMs reales** (shadow de una jornada con un TM, observación etnográfica): la única forma de validar hipótesis de uso en campo. Este informe es análisis heurístico basado en código — capta lo estructural, no lo emocional.
- **Usability test moderado de 3 tareas** (startup mañana / completar 1 visita / cerrar jornada) con 5 TMs: saca 80% de los problemas reales en media jornada.
- **Métricas en producción** (Sentry + un analytics propio): "cuánto tarda el TM medio en completar una visita", "cuántos reintentan check-in", "cuántos borrones de fotos por accidente" — el código no lo dice, los logs sí.

Si hay oportunidad de sumar research al backlog, es lo que más retorno da para UX. Lo escribo acá para no perder el norte: no todo se resuelve leyendo código.

---

*Revisión generada con lectura estática del flujo y verificación archivo/línea. Los taps y tiempos citados son conteo de interacciones visibles; medidos con cronómetro en un TM real pueden variar.*
