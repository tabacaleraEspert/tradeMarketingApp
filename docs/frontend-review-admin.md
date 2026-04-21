# Revisión frontend — Panel admin (/admin)

**Fecha:** 2026-04-21
**Alcance:** todas las páginas bajo `frontend/src/app/pages/admin/` + `AdminLayout.tsx`.
**Roles que llegan a `/admin`:** por `Login.tsx:30–35`, `admin` y `regional_manager`.
**Foco:** permisos por rol, UX de flujos admin, UI/visual en desktop, a11y.
**Método:** lectura estática con verificación archivo/línea.

Páginas revisadas: `AdminDashboard`, `POSManagement`, `ChannelManagement`, `RouteManagement`, `RouteEditorPage`, `TerritoryManagement`, `FormBuilder`, `FormEditorPage`, `NotificationManagement`, `Reports`, `UserManagement` (~9.000 LOC totales).

---

## Resumen ejecutivo

Esta es la sección más sensible de los tres informes porque el admin pelea contra dos tipos de riesgo que el mobile no tiene: **escalada de privilegios entre roles** y **acciones con efecto global** (borrar usuarios, canales, territorios o formularios).

Lo más importante que encontré:

- **Crítico real: un `regional_manager` puede promover a cualquier usuario a `admin`** desde `/admin/users`. El `Select` de rol se puebla con el listado completo de roles del backend (línea 549–555 de `UserManagement.tsx`) y el `usersApi.setRole(...)` se llama sin chequeo de cliente (línea 160). Si el backend no lo bloquea duro, es escalada.
- **Gating por rol prácticamente inexistente dentro de /admin**. Solo `FormBuilder` y `RouteEditorPage` tienen algún check; todas las demás (`POSManagement`, `RouteManagement`, `UserManagement`, `TerritoryManagement`, `ChannelManagement`, `NotificationManagement`, `Reports`) le muestran los botones de crear/editar/eliminar a **cualquier rol que alcance `/admin`**. Un regional_manager ve exactamente la misma UI que un admin.
- **Rol fantasma "supervisor"** referenciado en varios lugares: `RouteEditorPage.tsx:160` (`["admin","supervisor"]`), `UserManagement.tsx:224` (color de badge) y `UserManagement.tsx:276` (contador "Admin/Supervisor"). No está en `ROLE_LABELS` ni lo asigna nadie — es código muerto que puede esconder bugs.
- `window.confirm()` reaparece en `ChannelManagement.tsx:75, 129` y `NotificationManagement.tsx:53` para acciones destructivas (desactivar canal/subcanal/notificación) cuando ya existe `ConfirmModal` en otros módulos.
- `AdminDashboard.tsx` llama a `reportsApi.summary()`, `vendorRanking()`, `channelCoverage()`, `perfectStore()`, `smartAlerts()`, `gpsAlerts()` **sin filtro de zona**. Si hay un regional_manager logueado, ve métricas nacionales al lado de las suyas. El filtro debería venir del rol.
- UI en desktop: sidebar fijo a `w-64`, `AdminLayout` sin botón de colapsar para liberar espacio en laptops de 1024px donde las tablas de 6–7 columnas quedan apretadas (`UserManagement`, `FormBuilder`, `POSManagement`).
- A favor: `ConfirmModal` usado bien en `UserManagement` y `FormBuilder`; status con ícono+color en Dashboard y Territorio; responsive grids en summary cards.

---

## 1. Permisos y gating por rol

> Nota: el router no tiene guard por rol sobre `/admin` (ya reportado en el primer informe). Aun así, dentro de `/admin` conviven admin y regional_manager — por eso las diferencias de permisos entre ambos roles dentro del panel importan.

### 1.1 Escalada de privilegios: cualquier admin-panel user puede hacer admin a otro
**Archivos:** `frontend/src/app/pages/admin/UserManagement.tsx`
**Líneas:** 158–161 (llamada), 540–555 (dropdown)
**Problema:** al editar/crear un usuario, el Select de rol se llena con `roles.map(...)` sin filtrar. Un `regional_manager` (o cualquiera que entre a `/admin`) puede elegir "admin" de la lista y se ejecuta `usersApi.setRole(editingUser.UserId, Number(form.RoleId))` (línea 160) sin chequeo de cliente. También puede promoverse a sí mismo.
**Fix sugerido:**
1. Filtrar `roles` según el rol actual: un regional_manager no debería ver "admin" ni "regional_manager" en el Select.
2. Gatear toda la página `UserManagement`: si `currentUser.role !== "admin"`, mostrar una vista de solo lectura o redirigir.
3. Validar también en backend (defensa en profundidad). Idealmente `PUT /users/:id/role` retorna 403 si el caller no es admin o si intenta asignar un rol igual o mayor al suyo.
**Severidad:** **Crítica**.

### 1.2 Botones de borrar usuario sin check de rol
**Archivo:** `UserManagement.tsx` líneas 458–463
**Problema:** el botón `<Trash2 ... setDeleteUser(u)>` se renderiza para cualquier fila de usuario sin condicional. Un regional_manager puede abrir el `ConfirmModal` y borrar a otros usuarios (incluyendo admins o su propio superior).
**Fix sugerido:** envolver edit/delete en `{isAdmin && (...)}`. Definir `isAdmin = currentUser.role === "admin"` al tope del componente (como ya hace `FormBuilder`) y aplicarlo.
**Severidad:** Alta.

### 1.3 Creación de formularios sin chequeo de rol
**Archivo:** `FormBuilder.tsx` líneas 225–243
**Problema:** `canEditForm` (línea 85) protege correctamente el editar/eliminar de formularios existentes, pero el botón "Nuevo Formulario" / "Nueva Acción" (líneas 225–243) no está gateado. Un regional_manager puede crear un formulario nuevo, quedarse como `CreatedByUserId`, y pasar a editarlo libremente (gracias a `canEditForm = isAdmin || CreatedByUserId === currentUserId`).
**Fix sugerido:** envolver el botón en `{isAdmin && (...)}` — si regional_manager debe poder crear sus propios formularios, revisar que el flujo de asignación a rutas también esté limitado a las rutas de su territorio.
**Severidad:** Alta.

### 1.4 `POSManagement`, `RouteManagement`, `ChannelManagement`, `NotificationManagement`, `Reports`, `TerritoryManagement` sin gating por rol
**Archivos:** todos los anteriores.
**Problema:** ninguna de estas páginas define `isAdmin`/`canEdit`/`canDelete`. Los botones de alta/edición/baja se renderizan para cualquier rol que llegue a `/admin`. En particular:
- `ChannelManagement`: alta/baja de canal y subcanal (líneas 74–84, 128–137) — afecta el catálogo global de clasificación de PDVs.
- `NotificationManagement`: alta/baja de notificaciones que llegan a todos los TM (líneas 52–61).
- `POSManagement`: ABM de PDVs; todos los TMs dependen de esos datos.
- `RouteManagement`: crea/edita rutas que luego asignan trabajo a los TMs.
- `Reports` y `TerritoryManagement`: mostrar es OK, pero los botones de exportar / setear alertas / etc. deberían ser admin-only si aplica.

**Fix sugerido:** introducir un helper central `canEdit(resource, role)` en `lib/auth.ts` (p. ej. `canEdit: (resource, role) => ["admin"].includes(role)` por defecto, con overrides por recurso). Consumirlo consistentemente.
**Severidad:** Alta.

### 1.5 Rol fantasma "supervisor" en el gate
**Archivo:** `RouteEditorPage.tsx` línea 160
**Problema:** `const isAdmin = ["admin", "supervisor"].includes(currentUser.role);` — "supervisor" no aparece en `ROLE_LABELS` (AdminLayout 23–29), no está entre los usuarios demo del login, y no se usa en ninguna otra regla. Si este check llega a gatear algo importante en el editor de rutas (es la llave `isAdmin` del componente de ~1500 líneas), cualquier feature que dependa de "supervisor" está concediendo permisos a un fantasma o directamente no funciona para nadie.
**Fix sugerido:** reemplazar por `currentUser.role === "admin"`. Grep del codebase (tanto front como back) por `"supervisor"` antes de borrar — si existe en seeds o migrations históricos, documentarlo.
**Severidad:** Alta (clarity + potential gap).

### 1.6 `AdminDashboard` sin filtro de región/zona
**Archivo:** `AdminDashboard.tsx` líneas 35–42
**Problema:** las 6 llamadas (`summary`, `vendorRanking`, `channelCoverage`, `perfectStore`, `trending`, `smartAlerts`, `gpsAlerts`) se ejecutan sin parámetro de zona. Si un regional_manager entra a `/admin`, ve métricas globales (top/bottom vendedores de otras zonas, cobertura nacional, alertas de rutas que no son suyas). Es un problema de segmentación de datos.
**Fix sugerido:** si `currentUser.role === "regional_manager"`, pasar `zoneId: currentUser.zoneId` (o el subconjunto de zonas que le corresponden) a cada llamada. Agregar un `DashboardHeader` que muestre explícitamente "Visualizando: Nacional" vs "Visualizando: Región Bs As".
**Severidad:** Media (la autoridad real está en backend, pero el UX actual confunde).

### 1.7 `RouteEditorPage` compartido entre admin y TM sin ramas visibles
**Archivo:** `routes.tsx` líneas 50, 53, 77 (tres rutas apuntan al mismo componente) + `RouteEditorPage.tsx` líneas 155–167.
**Problema:** el mismo editor se usa en `/admin/routes/:id/edit`, `/my-routes/new`, y `/my-routes/:id/edit`. El único gate interno es el `isAdmin` ya cuestionado (1.5). No hay diferenciación clara de qué puede hacer el TM en su propia ruta vs qué puede hacer el admin editando rutas corporativas. Mezclar ambos flujos en un componente de 1500 líneas dificulta razonar sobre seguridad.
**Fix sugerido:** o dividir en dos componentes (`MyRouteEditor` y `AdminRouteEditor`), o consolidar todos los permisos en un objeto `permissions = { canChangePdvs, canChangeOwner, canChangeDays, ... }` calculado una vez al tope según `currentUser.role + route.ownerId === currentUser.id`.
**Severidad:** Media (deuda arquitectónica que habilita los puntos 1.2–1.5).

---

## 2. UX / flujos admin

### 2.1 `window.confirm()` para acciones destructivas globales
**Archivos/líneas:**
- `ChannelManagement.tsx:75` — desactivar canal ("los PDVs que lo usen seguirán mostrándolo").
- `ChannelManagement.tsx:129` — desactivar subcanal.
- `NotificationManagement.tsx:53` — eliminar notificación.

**Problema:** ya existe `ConfirmModal` (usado en `UserManagement`, `FormBuilder`). Usar `window.confirm()` para acciones que afectan a todos los PDVs / todos los TMs no es consistente ni accesible.
**Fix sugerido:** migrar a `ConfirmModal` con `type="danger"` y copy explícito sobre el impacto ("Afecta a X PDVs que tienen este canal asignado").
**Severidad:** Alta.

### 2.2 Borrado de usuario sin información de cascada
**Archivo:** `UserManagement.tsx` líneas 607–616
**Problema:** el mensaje de confirmación (`"¿Estás seguro de eliminar a \"X\"? Esta acción no se puede deshacer."`) no muestra cuántos subordinados reportan a ese usuario, cuántas rutas asignadas tiene, cuántas visitas abiertas. Borrar un territory_manager con subordinados los deja huérfanos.
**Fix sugerido:** antes de abrir el `ConfirmModal`, hacer un pre-fetch ligero: `{subordinates, openVisits, assignedRoutes}`. Si alguno es > 0, mostrar en el modal: "Este usuario tiene 3 subordinados y 8 visitas abiertas. ¿Reasignar antes de eliminar?". Ofrecer un selector de reasignación inline.
**Severidad:** Alta.

### 2.3 `FormBuilder` — asignación masiva solo disponible si hay búsqueda
**Archivo:** `FormBuilder.tsx` sección "Asignar a rutas"
**Problema:** "Seleccionar todo / deseleccionar todo" está disponible solo cuando hay un término de búsqueda activo. Con 50–100 rutas sin filtrar, el admin tiene que tildar una por una.
**Fix sugerido:** mostrar los botones siempre, con el contador ("Seleccionar todas (47)"). Considerar `Shift+Click` para selección de rango.
**Severidad:** Media.

### 2.4 `FormEditorPage` — afordance de drag & drop sin implementación clara
**Archivo:** `FormEditorPage.tsx` (import de `GripVertical` en línea 12)
**Problema:** el ícono de grip vertical sugiere que se pueden reordenar preguntas con drag, pero el comportamiento real no queda claro: o no hay listeners de drag, o existen pero sin feedback visual. Si el ícono está y el drag no funciona, es un dead affordance.
**Fix sugerido:** si hay drag real, agregar estados visuales (`cursor-grab`, hover, drop-zone line). Si no lo hay, reemplazar el grip por botones arriba/abajo o integrar `dnd-kit`.
**Severidad:** Media.

### 2.5 `POSManagement` — panel de filtros avanzados sin cerrar rápido
**Archivo:** `POSManagement.tsx` (estado `showAdvancedFilters`)
**Problema:** una vez abierto el panel avanzado, ocupa bastante alto. El único modo de cerrarlo es toggle del trigger original (arriba) — no hay un "X" dentro del propio panel.
**Fix sugerido:** agregar `<button onClick={() => setShowAdvancedFilters(false)} aria-label="Cerrar filtros avanzados">×</button>` en la esquina del panel. Alternativa: un chevron up/down en el header del propio panel.
**Severidad:** Media.

### 2.6 `RouteEditorPage` — optimización TSP sin progreso ni cancelar
**Archivo:** `RouteEditorPage.tsx` (`handleOptimizeRoute`)
**Problema:** calcular el orden óptimo de PDVs puede tardar segundos (nearest neighbor + Google Directions en algunos forks). Durante ese tiempo, el único feedback es `disabled={saving}` en el botón. Sin spinner ni cancelar, el admin puede pensar que se colgó.
**Fix sugerido:** `<Loader2 className="animate-spin"/>` mientras optimiza, copy "Optimizando N PDVs...", botón secundario "Cancelar optimización" que aborte la request con `AbortController`.
**Severidad:** Media.

### 2.7 `RouteManagement` — sin confirmación de reasignación masiva
**Archivo:** `RouteManagement.tsx` (lógica de asignar rutas a usuarios)
**Problema:** cambiar el `AssignedUserId` de una ruta afecta a todas las visitas planificadas futuras de esa ruta. Si la acción se hace con un Select inline (no modal), es fácil tocar sin querer.
**Fix sugerido:** exigir confirmación explícita cuando la ruta ya tiene visitas planificadas o abiertas: "Esta ruta tiene X visitas en curso. ¿Reasignar a Y? Las visitas abiertas siguen con el TM original."
**Severidad:** Media.

### 2.8 Reports — exportación sin preview
**Archivo:** `Reports.tsx`
**Problema:** al disparar un export a Excel no hay preview del rango de datos ni del número de filas que se van a generar. Para reportes grandes (visitas del trimestre), un admin puede disparar un xlsx de decenas de MB.
**Fix sugerido:** antes del download, mostrar un resumen ("Vas a exportar 14.320 filas / 12 MB. ¿Continuar?") y permitir ajustar filtros.
**Severidad:** Baja.

---

## 3. UI / visual / responsive desktop

### 3.1 Sidebar fijo 256 px sin toggle en desktop
**Archivo:** `AdminLayout.tsx` líneas 125–167 (`<aside>` con `w-64 lg:sticky`)
**Problema:** en un MacBook 13" (1440×900) el sidebar ocupa un 18% horizontal. Las tablas de 6–7 columnas ya no entran sin scroll. El toggle `<Menu>/<X>` existe pero está `lg:hidden` — no se puede colapsar en desktop.
**Fix sugerido:** permitir colapsar a `w-14` en desktop (solo íconos) cuando el user lo quiera, persistiendo la preferencia en `localStorage`. Agregar `title` en cada item del menú para que la versión colapsada sea usable.
**Severidad:** Alta.

### 3.2 Tablas con grids de columnas fijas que se rompen bajo 1280 px
**Archivos:**
- `UserManagement.tsx` líneas 416–479 (table con 7 columnas, `overflow-x-auto` pero sin indicador).
- `FormBuilder.tsx` línea 372: `grid-cols-[1fr_120px_100px_100px_140px_80px]`.
- `POSManagement.tsx` ~946: grid fijo con breakpoints de pocas columnas.

**Problema:** el contenido se corta y el scroll horizontal no es obvio; el usuario no sabe que hay más columnas a la derecha.
**Fix sugerido:**
1. Agregar sombra gradient en el lado derecho del contenedor cuando hay overflow (clase `scrollable-shadow` o Tailwind con mask image).
2. En `md:` ocultar columnas secundarias (p. ej. "Reporta a" en UserManagement) y exponerlas en un menú "Ver más" o tooltip.

**Severidad:** Alta.

### 3.3 `FormBuilder` — chips de metadata hacen wrap en viewports estrechos
**Archivo:** `FormBuilder.tsx` líneas 393–413
**Problema:** cada fila de formulario renderiza status + "Nacional" + frecuencia en `flex-wrap`. En 1024 px eso salta a dos renglones, rompiendo el grid de la tabla y desalineando las celdas.
**Fix sugerido:** en `md:` pasar badges secundarios a tooltip/secondary row; o dejar solo el status y mover frecuencia a una columna propia.
**Severidad:** Media.

### 3.4 Badges y tipografía `text-[10px]` en tablas
**Archivos:** varios (ver `FormBuilder:437`, `TerritoryManagement`, `POSManagement`).
**Problema:** la densidad está OK para desktop wide, pero los `text-[10px]` llevan el texto a aprox. 10 px real, bajo el mínimo recomendado (12 px).
**Fix sugerido:** subir a `text-xs` por defecto; reservar `text-[10px]` solo para metadata muy secundaria.
**Severidad:** Media.

### 3.5 `AdminDashboard` — muchas tarjetas + gráficos sin lazy
**Archivo:** `AdminDashboard.tsx` líneas 35–42 (todas las llamadas en `useEffect` sin dependencias, juntas)
**Problema:** al entrar al dashboard se disparan 7 requests en paralelo y se renderizan todas las secciones a la vez. En conexiones lentas el first paint tarda, y no hay skeletons por sección. Además `trending` suele venir con arrays largos que se grafican con recharts en el viewport no visible.
**Fix sugerido:** skeletons por tarjeta mientras carga cada uno; `IntersectionObserver` para disparar `trending`/`gpsAlerts` cuando estén cerca del viewport.
**Severidad:** Media.

### 3.6 `getRoleBadge` con color duplicado para "admin" y "supervisor"
**Archivo:** `UserManagement.tsx` líneas 220–232
**Problema:** ambos colors son iguales (`bg-espert-gold/10 text-espert-gold`) y "supervisor" no existe. Si en el futuro se agrega un rol real "supervisor", su badge no va a distinguirse del admin.
**Fix sugerido:** quitar la entrada "supervisor" y cuando se definan nuevos roles elegir colores diferenciados.
**Severidad:** Baja.

### 3.7 Modales mezclan shadcn `Dialog` (Alerts admin) y `Modal` custom
**Archivos:** `NotificationManagement`, `UserManagement`, `FormBuilder` → Modal custom; otras pantallas TM usan shadcn `Dialog`.
**Problema:** ya reportado en los dos informes anteriores; se repite aquí por si hay un esfuerzo de unificación en marcha.
**Severidad:** Media.

---

## 4. A11y — quick wins

### 4.1 Tablas sin `scope="col"` en `<th>`
**Archivos:** `UserManagement.tsx` líneas 420–426, otras tablas similares.
**Problema:** screen readers no asocian celdas con headers correctamente.
**Fix sugerido:** `<th scope="col">...</th>` en todas las tablas.
**Severidad:** Media.

### 4.2 Botones icon-only sin `aria-label`
**Archivos:** `UserManagement.tsx` líneas 458–463 (Edit/Trash2 sin label), `FormBuilder.tsx` líneas 443–447 (Eye/Edit/Trash2).
**Problema:** solo `title=` está presente (solo funciona en desktop hover, no en screen reader ni mobile tap).
**Fix sugerido:** `aria-label="Editar usuario {name}"`, `aria-label="Eliminar usuario {name}"`.
**Severidad:** Media.

### 4.3 Labels sin `htmlFor` en formularios
**Archivos:** varios; en particular `UserManagement.tsx` usa `<Label>` sin `htmlFor` y `<Input>` sin `id` pareado (líneas 500–517).
**Problema:** screen readers anuncian "campo sin etiquetar".
**Fix sugerido:** pair `id`/`htmlFor` en todos los forms del admin.
**Severidad:** Media.

### 4.4 `Select` nativo para "Reporta a"
**Archivo:** `UserManagement.tsx` líneas 577–593 (`<select>` HTML en vez de shadcn `<Select>`)
**Problema:** única mezcla en el modal de usuario — rompe la consistencia y en macOS Safari el popup nativo se ve distinto.
**Fix sugerido:** migrar a shadcn `Select` como el resto.
**Severidad:** Media.

### 4.5 Color-only en compliance %
**Archivo:** `TerritoryManagement.tsx` área de compliance %
**Problema:** el % cambia de verde a ámbar a rojo en el umbral. Daltonismo rojo-verde no lo distingue.
**Fix sugerido:** sumar un ícono (CheckCircle / AlertTriangle / XCircle) o una barra de progreso junto al número.
**Severidad:** Media.

### 4.6 Modales custom sin verificar focus trap y Escape
**Archivo:** `components/ui/modal.tsx` (usado en admin)
**Problema:** no queda claro si el componente atrapa el foco y vuelve al trigger al cerrar. Si no lo hace, el tab se escapa al body detrás del modal.
**Fix sugerido:** revisar la implementación. Si falta, usar `@radix-ui/react-dialog` (que shadcn ya incluye) — reemplaza al `Modal` custom con garantías de a11y.
**Severidad:** Media.

---

## 5. Dead code y bugs menores

### 5.1 Rol "supervisor" repetido en tres lugares sin existir
**Archivos / líneas:**
- `RouteEditorPage.tsx:160` — gate `["admin","supervisor"]`.
- `UserManagement.tsx:224` — color de badge `supervisor`.
- `UserManagement.tsx:276` — contador "Admin/Supervisor" con `u.roleName === "supervisor"`.

**Problema:** mencionado en 1.5, 3.6, aquí lo consolido como ítem de tarea.
**Fix sugerido:** decisión explícita: o se define oficialmente el rol "supervisor" en `ROLE_LABELS` y se propaga, o se purga en una misma PR.
**Severidad:** Media.

### 5.2 `inactiveReps` usa `u.UserId > 2` como filtro mágico
**Archivo:** `AdminDashboard.tsx` línea 56
**Problema:** `inactiveReps = activeUsers.filter((u) => !activeRepsToday.has(u.UserId) && u.UserId > 2)` — `u.UserId > 2` es un hack para excluir admin/test. Si mañana se reindexa la tabla o se crean usuarios de test con Id > 2, esto falla silenciosamente.
**Fix sugerido:** filtrar por rol en vez de por Id: `u.roleName === "vendedor"`.
**Severidad:** Baja.

### 5.3 `AdminLayout` — indicador `isOnline` siempre en `true`
**Archivo:** `AdminLayout.tsx` líneas 36, 86–98
**Problema:** `const [isOnline] = useState(true);` — nunca cambia. Muestra un chip "Online" estático. El mobile tiene `OfflineBanner` real; el admin no.
**Fix sugerido:** enganchar a `window.addEventListener('online'/'offline')` como hace `OfflineBanner`, o reutilizar el mismo componente.
**Severidad:** Baja.

### 5.4 Badge de notificaciones hardcodeado a `3`
**Archivo:** `AdminLayout.tsx` línea 103
**Problema:** `<Badge>3</Badge>` — número hardcoded que no refleja las notificaciones reales. El admin ve siempre "3" independientemente del estado.
**Fix sugerido:** o conectarlo al endpoint de notificaciones activas y mostrar el contador real, o quitarlo hasta que haya lógica real.
**Severidad:** Baja.

### 5.5 `getAlertIcon` vacío (ref. informe anterior)
**Archivo:** `Alerts.tsx` (mobile) — ya reportado. Apunto acá que el mismo patrón puede estar en otras utilidades del admin; conviene hacer `grep "function get.*Icon"` y revisar todas.
**Severidad:** Baja.

---

## 6. Observaciones positivas

- **`ConfirmModal` bien usado** en `UserManagement` (607–616) y en `FormBuilder` — patrón a propagar al resto.
- **`AdminDashboard` tiene KPIs bien elegidos**: top/bottom vendors, low coverage channels, reps sin actividad hoy, alertas GPS — cubre el día a día del admin con buena densidad.
- **`TerritoryManagement` exporta a Excel** con un nombre de archivo con fecha (línea 117) y `exportToExcel` es un helper reusable bien pensado.
- **`FormBuilder.canEditForm`** (línea 85) es el único gate fino por ownership en el admin — y está bien diseñado. Sirve como modelo para los puntos 1.2–1.4.
- **`RouteEditorPage`** tiene `pdvCache` (157) y `useApiList` con refetch — muestra pensamiento sobre refresh y performance en un componente grande.
- **Summary cards en grids responsive** (`UserManagement:257`, `FormBuilder:247`): `grid-cols-2 md:grid-cols-4` — bien.
- **Status con ícono + color** en `TerritoryManagement.STATUS_CONFIG` (40–46) — patrón a11y correcto que debería replicarse donde hoy hay solo color.

---

## 7. Tabla consolidada

| # | Hallazgo | Archivo | Línea(s) | Sev. | Categoría |
|---|---|---|---|---|---|
| 1.1 | Role dropdown sin filtrar → escalada a admin | `UserManagement.tsx` | 160, 540–555 | **Crítica** | Permisos |
| 1.2 | Delete user sin gating | `UserManagement.tsx` | 458–463 | Alta | Permisos |
| 1.3 | Crear formulario sin gating | `FormBuilder.tsx` | 225–243 | Alta | Permisos |
| 1.4 | Resto de páginas admin sin gating | varios | — | Alta | Permisos |
| 1.5 | Rol fantasma "supervisor" en gate | `RouteEditorPage.tsx` | 160 | Alta | Permisos/bug |
| 1.6 | Dashboard sin filtro de zona | `AdminDashboard.tsx` | 35–42 | Media | Permisos |
| 1.7 | `RouteEditorPage` compartido admin+TM | `RouteEditorPage.tsx` | 155–167 | Media | Arquitectura |
| 2.1 | `window.confirm()` destructivo global | `ChannelManagement.tsx`, `NotificationManagement.tsx` | 75, 129, 53 | Alta | UX |
| 2.2 | Delete user sin cascada | `UserManagement.tsx` | 607–616 | Alta | UX |
| 2.3 | Select All solo con búsqueda activa | `FormBuilder.tsx` | asignación rutas | Media | UX |
| 2.4 | Grip drag sin implementación clara | `FormEditorPage.tsx` | 12 + uso | Media | UX |
| 2.5 | Filtros avanzados sin cerrar rápido | `POSManagement.tsx` | — | Media | UX |
| 2.6 | Optimización TSP sin progreso/cancel | `RouteEditorPage.tsx` | — | Media | UX |
| 2.7 | Reasignación de ruta sin confirmar | `RouteManagement.tsx` | — | Media | UX |
| 2.8 | Export Reports sin preview | `Reports.tsx` | — | Baja | UX |
| 3.1 | Sidebar fijo sin toggle desktop | `AdminLayout.tsx` | 125–167 | Alta | UI |
| 3.2 | Tablas sin indicador de scroll | varios | — | Alta | UI |
| 3.3 | FormBuilder chips wrap en <1280px | `FormBuilder.tsx` | 393–413 | Media | UI |
| 3.4 | `text-[10px]` en tablas | varios | — | Media | UI |
| 3.5 | Dashboard sin lazy por sección | `AdminDashboard.tsx` | 35–42 | Media | UI |
| 3.6 | Badge color duplicado admin/supervisor | `UserManagement.tsx` | 220–232 | Baja | UI |
| 3.7 | Modal custom vs Dialog (ref.) | varios | — | Media | UI |
| 4.1 | Tablas sin `scope="col"` | varios | — | Media | a11y |
| 4.2 | Icon buttons sin `aria-label` | varios | — | Media | a11y |
| 4.3 | Labels sin `htmlFor` | varios | — | Media | a11y |
| 4.4 | `<select>` nativo "Reporta a" | `UserManagement.tsx` | 577–593 | Media | a11y |
| 4.5 | Color-only en compliance % | `TerritoryManagement.tsx` | — | Media | a11y |
| 4.6 | Focus trap no verificado en Modal custom | `components/ui/modal.tsx` | — | Media | a11y |
| 5.1 | Rol "supervisor" en 3 lugares | varios | — | Media | dead code |
| 5.2 | `u.UserId > 2` mágico | `AdminDashboard.tsx` | 56 | Baja | bug |
| 5.3 | `isOnline` siempre true en admin | `AdminLayout.tsx` | 36, 86–98 | Baja | bug |
| 5.4 | Badge 3 notificaciones hardcoded | `AdminLayout.tsx` | 103 | Baja | bug |

---

## 8. Plan de ataque sugerido

**Tanda 0 — mitigación inmediata (mismo día si está deployado):**

1. **1.1** Gatear el `Select` de rol en `UserManagement` y el botón de eliminar (1.2). Si es una app interna con pocos usuarios con rol admin panel, puede ser suficiente por ahora.
2. Confirmar en backend que `PUT /users/:id/role` y `DELETE /users/:id` validan el rol del caller. Si no lo hacen, es prioridad P0 de backend.

**Tanda 1 — sprint corto (2–3 días):**

3. **1.3, 1.4** Introducir helper `can(action, resource)` en `lib/auth.ts` y gatear las páginas `/admin/channels`, `/admin/pos-management`, `/admin/routes`, `/admin/notifications`. Botones invisibles para regional_manager por defecto.
4. **2.1** Reemplazar `window.confirm()` por `ConfirmModal` en ChannelManagement y NotificationManagement.
5. **1.5 + 5.1** Borrar "supervisor" en las tres ocurrencias, reemplazar por `role === "admin"`.
6. **5.3, 5.4** Conectar el chip `isOnline` y el badge de notificaciones a datos reales, o quitarlos.

**Tanda 2 — sprint normal (1 semana):**

7. **2.2** Pre-fetch de cascada al eliminar usuarios, con selector de reasignación.
8. **3.1** Sidebar colapsable en desktop con preferencia persistente.
9. **3.2** Indicador de scroll horizontal en tablas + responsive column hiding en `md:`.
10. **1.6** Filtro de zona en `AdminDashboard` según rol + header "Visualizando: ..." explícito.
11. **4.1, 4.2, 4.3, 4.4** Pasada de a11y sobre tablas y formularios (`scope`, `aria-label`, `htmlFor`, migrar `<select>` nativo).

**Tanda 3 — plataforma:**

12. **1.7** Dividir `RouteEditorPage` o consolidar un objeto `permissions` único.
13. **4.6** Auditar `Modal` custom; migrar a shadcn `Dialog` (cerraría también los hallazgos 3.7 de los tres informes).
14. **2.6, 2.7, 2.8** UX avanzada: progreso en optimización TSP, confirmación en reasignación masiva, preview de export.

---

## 9. Referencias cruzadas

Hallazgos que aparecen también aquí pero ya estaban en informes previos:

- `/admin` sin guard en el router (informe 1, hallazgo 1.1): sigue siendo la primera línea de defensa a cerrar para que este informe tenga sentido en producción.
- `window.confirm()` destructivo (informe 1, hallazgo 1.4; informe 2, hallazgo 1.6): tercera aparición. Vale la pena hacer una sola PR que reemplace todos los usos con `ConfirmModal` y prohibirlos con un ESLint custom.
- Modales custom vs shadcn Dialog (informe 1, hallazgo 3.7; informe 2, hallazgo 4.6): ídem, unificar en una sola pasada.
- Skeletons vs "Cargando..." (informe 1, hallazgo 2.2): el dashboard también lo sufre (3.5).
- Labels sin `htmlFor` (informe 1, hallazgo 5.2; informe 2, hallazgo 5.2): cuarta aparición, candidato a lint rule.

Cerrar estos cuatro ítems de forma transversal simplifica los tres informes a la vez.

---

*Revisión generada con lectura estática y verificación archivo/línea sobre ~9k LOC de `pages/admin/*`. Los puntos del apartado 1 (permisos) requieren corroboración con backend antes de aplicar cambios que oculten funcionalidad — la intención del producto puede ser que regional_manager tenga algunos permisos y hoy no estén bien modelados.*
