# QA Checklist — Trade Marketing App

> **Fecha:** 2026-04-13
> **Tester:** Davor
> **Entorno:** localhost (SQLite + storage local)
> **Cómo usar:** probá cada item, marcá ✅ si funciona, ❌ si falla (con detalle), ⏭️ si lo salteás.
> **Agregado por Davor:** Si agrego + entre lineas es por cosas a cambiar

---

## 1. LOGIN + AUTH

- [✅] **1.1** Login con admin (`juampi@espert.com.ar` / `Espert2026!`) → entra OK
- [✅] **1.2** Al primer login aparece **modal de cambio de contraseña obligatorio** → no deja navegar sin cambiar
- [✅] **1.3** Cambiar contraseña → toast verde → modal se cierra → podés navegar
- [✅] **1.4** Logout desde Perfil → vuelve al login → los tokens se borran
- [✅] **1.5** Intentar acceder a `/admin` sin login → redirige a `/login`
+ El admin entra directo al panel dashboard no entra a la app trade rep como todo el resto.
- [✅] **1.6** Login con TM Rep (`tmcuyo1@espert.com.ar` / `Espert2026!`) → entra, ve Home del rep
- [✅] **1.7** Login con Territory Manager (`emmanuel.anzorena@espert.com.ar`) → entra OK
- [✅] **1.8** Login con Regional Manager (`martin.lescano@espert.com.ar`) → entra OK
- [✅] **1.9** Accesos rápidos demo (`carlos@demo.com` / `Demo123!`) → siguen funcionando

## 2. HOME DEL TM REP

- [✅ ] **2.1** Saludo personalizado ("Buenos días, [nombre]")
- [✅] **2.2** Fecha del día visible → selector de fecha abre calendario
+ Anota que me gustaria cambiar esta vista de calendario a algo que de mas info. pero despeus
- [✅ ] **2.3** Cambiar fecha → navegar a otra pantalla → volver → la fecha persiste (contexto global)
- [✅] **2.4** Botón "Hoy" aparece cuando la fecha no es hoy → click → vuelve a hoy
- [✅] **2.5** KPIs (visitas mes, cumplimiento, PDVs nuevos) con colores diferenciados de las acciones
+ Me gustaria cambiarlo. hoy solo cambia el color del icono quisiera cmabiar el color del fondo de la card.
- [❌] **2.6** Acciones rápidas: Alta PDV / Mis Rutas / Buscar / Cierre → todos navegan bien
+ Que buscar puntos de venta solo vea sus puntos de venta asignados. o de ultima los de su ciudad (cheuqear esto con Gerencia, no deberian ver TODOS los PDV del pais los TM sino los suyos o los de su zona no asginados, anotar.)
+ En lata de PDV en el formulario falta: En Distribuido poder agreagr mas de uno, tambien se puede agegar manual si no esta en la lista, que pida nombre y nro telefefonoo (el nro de telefono lo tenemos que sanitizar porque mas adelante sera un id) (que no sea obligatorio)
+ en contacto etan bien los datos peor hay que darle la posibldiad de agregar mas campos como datos extras libres tipo hincha de que equipo de futobl, el hijo se llama X, etc. porque el tm va crando una relacion con el contacto y agregando datos y fechas y recordatorios, etc.
+ Faltan datos que antes habiamos agregado ya como rol de local, poder de decision, etc.
+ Tomar foto del frente no enciende la camra sino que sube una foto precargada 
+ Buscar PDV por mapa no anda
+ Me gustaria que buscar PDV tenga un filtro de mas recientes
+ Si marco un PDV como incactivo quiero que siga apareciendo en las busqeuedas pero como inactivo. incluso que exista ese filtro.
+ La navegacion anda bien
- [✅] **2.7** Si hay alertas activas → banner rojo con cantidad
+ Hay que agregar un flujo a las alertas. O que el admin las quite, o que alguna alertas requeiran accion del tm coom marcar completada o algo. Se puede pensar

## 3. RUTA DEL DÍA (TM Rep)

+ Un TM no deberia poder modificar sus rutas, ni su frecuencia ni sus PDV, a lo sumo dejar una alerta sobre la ruta y que el cambio lo haga el superior
+ si un admin cambia el TM de una ruta foco, entonces los dias asignados tienen que cambiar tambien para es TM. y dias Asignados es solo para casos particulares, lo que reina es la frecuencia. 
+Luego si una ruta no tiene dias asignados pero tiene
- [✅] **3.1** Entrar a "Ruta del Día" → ver lista de PDVs con estado (pendiente/en curso/completada)
- [✅] **3.2** Toggle Lista / Mapa → ambos funcionan
- [✅] **3.3** Filtros por estado (Todos/Pendiente/En Curso/Completa) → filtran correctamente
+ hice una visita completa, no me actuliazo el sigueitne pdv del inicio ni me la puso como completa la sigo viendo en la lista como Pendiente, me gustaria que cambie el punto de color en el mapa tambien
- [✅] **3.4** Botón **"+ Fuera de ruta"** visible → lleva al buscador de PDVs
- [✅] **3.5** Buscar por nombre/dirección → filtra la lista

## 4. CHECK-IN + VISITA COMPLETA

- [✅] **4.1** Entrar a un PDV pendiente → ver notas pendientes (si las hay)
- [✅] **4.2** Banner GPS si estás fuera de perímetro → **no bloquea**, muestra warning "alerta para supervisor" → botón dice "Iniciar visita igual"
- [✅] **4.3** Check-in → toast éxito → navega al survey
- [✅] **4.4** Botón "Contactos" en header del check-in → abre modal edición → editar un contacto → guardar
+ Me gustaria poder editar no solo en el check in.
+ No veo los datos de observacines y etc cuando lo agrego, dejar la opcion de ver mas sobre un contacto facil asi lo puede analizar antes de la visita a detalle.
- [✅] **4.5** Completar formulario de relevamiento → guardar respuestas
+ no guarda bien las fotos creo ni en el historico de la vistia veo todo (las fotos no las veo por eso nose si no las guarda o no las meustra ahi simplemetne)
- [✅] **4.6** Ir a Fotos → tomar/seleccionar foto → se sube y aparece con badge "Sync"
- [✅] **4.7** Ir a **Acciones** → ver acciones obligatorias (ej: "Colocar cigarrera") → marcar como DONE
- [✅] **4.8** Ir a Resumen de visita → ver pasos completados
- [✅] **4.9** Escribir nota "TODO para próxima visita" → cerrar visita
- [✅] **4.10** Al cerrar → **auto-navega al siguiente PDV pendiente** con banner verde "Ruta en curso"
+ Cambiar el color del Banner. 
+ Mostrar un modal de Excelente terminaste este pdv, el proximo en la ruta es XX. Ir --> cerrar 
- [✅] **4.11** Si no hay más PDVs → card "¡Terminaste tu ruta del día!" con botón "Ir al cierre del día"

## 5. NOTAS DE PDV

- [✅] **5.1** Abrir un PDV → ver sección "Notas del PDV" con pendientes
- [✅] **5.2** Crear una nota nueva → aparece en la lista
- [✅] **5.3** Marcar una nota como resuelta (✅) → pasa a "resueltas" colapsable
- [✅] **5.4** Eliminar una nota (✕) → desaparece
- [✅] **5.5** La nota dejada al cerrar visita (paso 4.9) aparece como nota del PDV

## 6. PDV — DATOS NUEVOS DEL FEEDBACK

- [✅] **6.1** Editar un PDV → campo "Razón social" visible al lado de "Nombre de fantasía"
- [✅] **6.2** Asteriscos rojos en campos obligatorios (Nombre, Canal)
- [✅] **6.3** Campos "Horario apertura" y "Horario cierre" → input type=time
- [X] **6.4** Campo "Día de visita" → select Lun/Mar/Mié/.../Dom/Sin día fijo
+ este borremoslo, lo carga el superior no el tm
- [✅] **6.5** En cada contacto: campos "Observaciones" y "Perfil del contacto" → textarea
- [✅] **6.6** Desactivar un PDV → **modal pide razón obligatoria** → confirmar → banner rojo "PDV inactivo" con razón + fecha reactivar (60d)
+ Cuando se inactiva hay que poner MOTIVO
- [✅] **6.7** Reactivar el PDV → se limpia todo lo de inactivo
+ En buscar PDV cuando filtro por inactivo no se deselecciona el filtro todos
+ Falta agregar en distribuidores poder agregar mas de uno con nombre y telefono

## 7. DISTRIBUIDORES

- [X] **7.1** En modal de PDV, crear distribuidor nuevo → form expandido con Nombre + Teléfono + Tipo (Distribuidor/Mayorista/Intermediario) + Fuente de abastecimiento
+ En el modal PDV no veo el crear nuevo distribuidor. deberia
- [X] **7.2** El distribuidor creado aparece en el desplegable sin duplicarse

## 8. FOTOS

- [✅] **8.1** Subir foto → se guarda en `backend/uploads/visits/...`
- [✅] **8.2** Recargar la pantalla → la foto persiste (cargada desde el backend)
- [✅] **8.3** Borrar foto → desaparece de la lista y del disco
- [✅] **8.4** Categorías: Frente del Local, Góndola, Material POP, Precio, Otra
- [✅] **8.5** Badge "Completo" cuando las 2 categorías obligatorias tienen foto

## 9. OFFLINE

- [✅] **9.1** DevTools → Network → Offline → aparece banner amarillo "Sin conexión"
- [✅] **9.2** Cerrar visita offline → toast "Visita guardada. Se sincronizará..." → navega normalmente
- [v] **9.3** Subir foto offline → preview local con badge "Pendiente"
- [✅] **9.4** Botón naranja flotante "N pendientes" visible abajo a la derecha
- [ ] **9.5** Click en botón → modal lista las operaciones pendientes con tipo/label/tiempo
- [x] **9.6** Volver a online → la queue se flushea automáticamente → botón desaparece
- [X] **9.7** Check-in offline → **bloqueado con mensaje claro** "Necesitás conexión para iniciar"
+ Yo quiero que me permita hacer la visita y que luego se sincronice 

## 10. ADMIN — DASHBOARD

- [✅] **10.1** Login como admin → dashboard con KPIs, estado en campo, alertas
- [✅] **10.2** Card "Alertas GPS" → lista visitas fuera de perímetro o sin GPS
- [✅] **10.3** Click en una alerta GPS → navega al detalle del PDV
+ pero envia a una vista TM no deberia, deberia mostrar un resumen

## 11. ADMIN — RUTAS

- [ ] **11.1** Lista de rutas → badge "⚡ Optimizada" si corresponde
- [ ] **11.2** Editar ruta → filtros canal/ciudad/zona en PDVs disponibles
- [ ] **11.3** Un PDV ya asignado a otra ruta **no aparece** como disponible (exclusividad)
- [ ] **11.4** Optimizar ruta → badge cambia a verde "Optimizada" → agregar un PDV → badge vuelve a gris
- [ ] **11.5** Programar día de ruta → si la fecha es feriado → **banner amarillo** "Feriado: [nombre]"
- [ ] **11.6** Frecuencia: selector tipo + campo "A partir de" para every_x_days/biweekly/monthly
+ Falta asignar acciones a la ruta, esta solo fomrualrios

## 12. ADMIN — PLANTILLAS DE VISITA

- [ ] **12.1** Crear formulario → modal mejorado con hero, selector canal por botones, versión +/−, frecuencia
- [ ] **12.2** Asignar formulario a rutas → multi-select con "Todas/Ninguna", búsqueda, guardado batch
- [ ] **12.3** Crear acción de ejecución → selector "Formulario vinculado" opcional
- [ ] **12.4** Badge de frecuencia visible en la lista de formularios (ej: "Semanal")
- [ ] **12.5** Badge azul "📋 Form" en acciones que tienen formulario vinculado

## 13. ADMIN — GESTIÓN PDV

- [ ] **13.1** Filtro avanzado "Asignación a ruta" → opción "Sin ruta (huérfanos)" → filtra correctamente
- [ ] **13.2** Vista Mapa → funciona con los PDVs filtrados

## 14. ADMIN — REPORTES

- [ ] **14.1** KPIs del mes, ranking de TM Reps, cobertura por canal
- [ ] **14.2** Tabla "Tiempo promedio por TM Rep en PDV" → datos de los últimos 90 días
- [ ] **14.3** Colores de tiempo: verde ≤15min, ámbar 15-30, rojo >30

## 15. PERMISOS (RBAC)

- [ ] **15.1** TM Rep NO puede borrar PDVs → 403
- [ ] **15.2** TM Rep NO puede crear rutas → 403
- [ ] **15.3** TM Rep NO puede borrar visitas → 403
- [ ] **15.4** TM Rep NO puede crear/editar formularios → 403
- [ ] **15.5** Territory Manager SÍ puede crear/editar rutas (de su zona)
- [ ] **15.6** Admin puede todo
- [ ] **15.7** `GET /users` filtra por sub-árbol: TM Rep ve sólo a sí mismo

## 16. ERRORES VISIBLES

- [ ] **16.1** DevTools → Network → Offline → recargo una pantalla → toast "Sin conexión al servidor"
- [ ] **16.2** Intentar una operación sin permiso → toast "No tenés permiso para hacer esta acción"
- [ ] **16.3** PDV que no carga → pantalla de error con botón "Reintentar" + "Volver"
- [ ] **16.4** Header `X-Request-ID` presente en todas las respuestas del backend

## 17. PERFIL

- [ ] **17.1** Ver perfil → nombre, email, zona, stats del mes
- [ ] **17.2** Subir avatar → foto aparece en el círculo → hover muestra ícono de cámara
- [ ] **17.3** Eliminar avatar (botón rojo ✕) → vuelve al ícono default
- [ ] **17.4** Cerrar sesión → vuelve al login

## 18. MIS RUTAS (vista TM Rep)

- [ ] **18.1** Ver "Mis Rutas Foco" → lista de rutas asignadas con info (nombre, zona, PDVs, frecuencia)
- [ ] **18.2** Toggle Lista / Mapa → mapa con polilíneas por ruta y markers numerados
- [ ] **18.3** Filtros en mapa: canal, prioridad, toggle por ruta, búsqueda
- [ ] **18.4** Click marker → InfoWindow con nombre + dirección + "Ver detalle" + "Cómo llegar"
- [ ] **18.5** "Cómo llegar" → abre Google Maps en nueva pestaña

---

## Criterios para pasar

- **SHOWSTOPPER**: cualquier ❌ en secciones 1 (auth), 4 (visita completa), 9.1-9.6 (offline), 15 (permisos)
- **BLOCKER**: cualquier ❌ en secciones 2-3 (home/ruta), 5 (notas), 8 (fotos), 10-11 (admin)
- **KNOWN ISSUE**: cualquier ❌ en secciones 6-7, 12-14, 16-18 → documentar en `KNOWN_ISSUES.md`, resolver en día 17

---

## Resultado QA

**Total:** __ / 87 items
**Showstoppers:** __
**Blockers:** __
**Known issues:** __

**Go/No-Go para deploy:** [ ] GO / [ ] NO-GO

**Fecha QA completada:** ___
