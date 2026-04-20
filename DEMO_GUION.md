# Guión de Demo — Trade Marketing App

> **Duración objetivo:** 15-20 min · **Audiencia:** Decisores / Espert
> **Pre-requisitos antes de empezar:**
> 1. `cd backend && python seed_demo.py` (crea/refresca todos los datos)
> 2. Backend levantado: `uvicorn app.main:app --reload`
> 3. Frontend levantado: `cd frontend && npm run dev`
> 4. Tener 2 navegadores abiertos (o 2 ventanas privadas) para alternar entre **TM Rep** y **Admin**

## Usuarios para el login

| Rol      | Email              | Contraseña |
|----------|--------------------|------------|
| Admin    | admin@demo.com     | Demo123!   |
| TM Rep   | carlos@demo.com    | Demo123!   |
| TM Rep   | lucia@demo.com     | Demo123!   |
| TM Rep   | martin@demo.com    | Demo123!   |
| TM Rep   | paula@demo.com     | Demo123!   |

**Datos clave que el seed deja listos:**
- 8 PDVs reales en CABA (Belgrano + Microcentro)
- 2 Rutas Foco (Norte → Carlos, Centro → Lucía), cada una con 4 PDVs
- Días de ruta para **hoy / mañana / pasado mañana**
- 1 Form "Censo Precios - Kioscos" con frecuencia semanal y 5 preguntas
- 1 Acción obligatoria "Colocar cigarrera" vinculada al form
- ~16 visitas históricas cerradas (últimos 30 días) con respuestas y duraciones
- 5 notas pendientes (TODOs) en distintos PDVs

---

## ESTRUCTURA DE LA DEMO (3 actos)

### Acto 1 — La perspectiva del TM Rep en campo (5-7 min)
*Mostrar lo que ve y hace un trade rep en su jornada.*

### Acto 2 — La perspectiva del Admin / Supervisor (5-7 min)
*Mostrar cómo se planifica, asigna y mide.*

### Acto 3 — Cierre + diferenciales (3-5 min)
*Resumen de lo que vieron y por qué importa.*

---

## ACTO 1 — TM REP EN CAMPO

> **Login con `carlos@demo.com / Demo123!`**

### Escena 1.1 — Inicio del día (Home)
> *Apertura: "Esto es lo primero que ve Carlos al abrir la app a la mañana."*

**Mostrar:**
- Saludo personalizado + fecha del día
- **Botón "Hoy"** arriba a la derecha (mostrar que existe contexto de fecha global)
- **Anillo de progreso** visitas completadas / pendientes
- Card del **próximo PDV** a visitar
- Stats del mes (visitas hechas, cobertura)

**Punto a destacar:** *"Carlos abre la app y en 3 segundos sabe exactamente qué tiene que hacer hoy, sin abrir Excel ni llamar al supervisor."*

---

### Escena 1.2 — Cambiar de fecha (contexto global)
> *Para mostrar la persistencia de fecha entre pantallas.*

**Mostrar:**
- Tocar el chip de fecha → seleccionar **mañana**
- Volver al Home → la fecha sigue en mañana
- Tocar **"Hoy"** → vuelve al día actual

**Punto a destacar:** *"La fecha viaja entre pantallas. Si quiero planificar mañana, todo el flujo me muestra mañana hasta que decida volver a hoy."*

---

### Escena 1.3 — Ver ruta del día (RouteFoco)
> *Tocar "Ver ruta" o "Ruta del Día"*

**Mostrar:**
- Lista de los 4 PDVs en orden de visita
- Toggle **Lista / Mapa** → mostrar el mapa con los puntos
- Filtro por estado (Pendiente / En curso / Completa)

**Punto a destacar:** *"Una sola vista, lista y mapa. Carlos sabe el recorrido óptimo, las distancias entre puntos y el tiempo estimado."*

---

### Escena 1.4 — Entrar a un PDV con notas pendientes
> *Tocar el primer PDV de la ruta (Kiosco San Martín)*

**Mostrar:**
- **Card amarilla "📝 Notas del PDV"** con badge "1 pendiente" arriba de todo
- *"Hablar con Don Pedro sobre el reposicionamiento de cigarreras..."* — dejada por Martín hace 5 días

**Punto a destacar:** *"Antes de pisar el local, Carlos ya sabe qué dejó pendiente el rep anterior. Cero pérdida de información entre visitas, cero 'me olvidé qué tenía que preguntar'."*

---

### Escena 1.5 — Check-in al local
> *Tocar "Iniciar visita" → llega a CheckIn*

**Mostrar:**
- **GPS valida proximidad al local** (radio 200m)
- La nota pendiente vuelve a aparecer arriba del check-in (recordatorio justo antes de entrar)
- Botón "Marcar como resuelta" en la nota

**Punto a destacar:** *"El check-in con GPS asegura que la visita es real. Y la nota lo acompaña hasta el último segundo antes de entrar."*

---

### Escena 1.6 — Hacer el relevamiento (Form)
> *Tocar "Relevamiento" después del check-in*

**Mostrar:**
- Form "Censo Precios - Kioscos" con sus 5 preguntas
- Llenar precio de Marlboro, Philip Morris, marcar checkbox de cigarrera visible

**Punto a destacar:** *"Los formularios son configurables por el admin. El que ven acá es de relevamiento de precios, pero podría ser de auditoría, de quiebres, lo que quieran."*

---

### Escena 1.7 — Acción obligatoria + foto
> *Volver al detalle del PDV → Acciones*

**Mostrar:**
- Acción "Colocar cigarrera mostrador" → tipo POP, **foto obligatoria**
- Indicar que tiene un form vinculado (badge azul)

**Punto a destacar:** *"Las **acciones** son lo que el rep tiene que ejecutar (no sólo relevar). Foto obligatoria como evidencia. Si la acción tiene un formulario, además le pide datos."*

---

### Escena 1.8 — Cerrar visita + dejar nota para próxima
> *Resumen de visita → ver el textarea "Nota / TODO para la próxima visita"*

**Mostrar:**
- Escribir: *"Pasar a buscar el material POP que dejó el supervisor"*
- Cerrar visita
- *(Opcional)* Loguear con `lucia@demo.com` o ir al detalle del mismo PDV → ver que la nota quedó como pendiente

**Punto a destacar:** *"Carlos cierra el día y la app garantiza que lo que dejó pendiente lo vea el próximo rep, automáticamente. Cero comunicación informal por WhatsApp."*

---

## ACTO 2 — ADMIN / SUPERVISOR

> **Login con `admin@demo.com / Demo123!`** (en otra pestaña)

### Escena 2.1 — Dashboard de admin
**Mostrar:**
- Card "Estado en campo — Hoy" (reps activos / con actividad / sin actividad)
- Card "Alertas" con incidencias abiertas
- KPIs por canal, cobertura, etc.

**Punto a destacar:** *"En 5 segundos el supervisor sabe quién está trabajando, quién no, y dónde están los focos rojos."*

---

### Escena 2.2 — Gestión de Rutas
> *Sidebar → Rutas Foco*

**Mostrar:**
- Lista con las 2 rutas
- Badge **"⚡ Optimizada"** verde en Ruta Norte
- Badge gris "Sin optimizar" en Ruta Centro
- Click en Ruta Norte → editor

**En el editor mostrar:**
- Datos de la ruta + frecuencia (diaria)
- Lista de PDVs con su orden y distancias
- Sección "PDVs disponibles" con **filtros canal/ciudad/zona** (mostrar que el filtro funciona)
- Demostrar que un PDV ya asignado a otra ruta **no aparece** como disponible (regla 1 PDV = 1 Ruta)

**Punto a destacar:** *"El admin arma rutas con drag, optimiza por distancia, asigna trade reps. Y la regla de negocio queda enforced: un PDV pertenece a una sola ruta, entonces a un solo TM Rep."*

---

### Escena 2.3 — Plantillas de Visita (Forms + Acciones)
> *Sidebar → Plantillas de Visita*

**Mostrar:**
- Tab "Relevamiento" → form "Censo Precios - Kioscos" con badge **"Semanal"**
- Crear nuevo form (sólo abrir el modal y mostrar la UX) — hero con icono, selector visual de canal, frecuencia
- Tab "Acciones" → "Colocar cigarrera mostrador" con badge **azul "📋 Censo Precios"** (form vinculado)

**Click en "Asignar a rutas"** del form:
- Mostrar el modal con multi-select, búsqueda, "Todas / Ninguna", contador de cambios pendientes

**Punto a destacar:** *"Los formularios son las preguntas, las acciones son lo que el rep tiene que **hacer**. Cualquiera de las dos se asigna a las rutas que correspondan, masivamente, sin tocar PDV por PDV."*

**Punto clave del modelo:** *"Importante: los formularios **no** afectan el % de cumplimiento de la visita. Sólo las acciones obligatorias cuentan. El relevamiento de precios puede ser semanal, no en cada visita, así no penalizamos al rep."*

---

### Escena 2.4 — Gestión de PDVs
> *Sidebar → Gestión PDV*

**Mostrar:**
- Lista de los 8 PDVs
- Toggle Lista / Mapa
- **Filtros avanzados** abiertos → mostrar el filtro **"Asignación a ruta"** con opción "Sin ruta (huérfanos)" y **Trade Marketer**

**Punto a destacar:** *"Si tenemos 200 PDVs y 5 quedaron sin asignar a ninguna ruta, el admin los encuentra en 2 clicks."*

---

### Escena 2.5 — Reportes
> *Sidebar → Reportes*

**Mostrar:**
- KPIs del mes (visitas, cobertura, GPS, fotos, tiempo promedio)
- Ranking de TM Reps
- Cobertura por canal
- **Tabla nueva: "Tiempo promedio por TM Rep en cada PDV"** (últimos 90 días)
  - Verde si ≤15 min, ámbar 15-30, rojo >30
  - Mostrar que cada combinación rep-PDV tiene su número

**Punto a destacar:** *"Esto detecta dos cosas: PDVs donde el rep pierde más tiempo (capacitación, mejor planificación) y reps que terminan muy rápido (auditar calidad de visita)."*

---

## ACTO 3 — CIERRE

### Mensaje final (1 frase por bloque)

1. **Cero papel, cero Excel:** todo el flujo del día del TM Rep, end-to-end, en una app móvil.
2. **Contexto entre visitas:** las notas garantizan que la información viaje entre reps automáticamente.
3. **Reglas de negocio enforced:** 1 PDV = 1 ruta = 1 TM Rep. Sin solapamientos, sin ambigüedad.
4. **Configurable por el admin:** formularios, acciones, frecuencias, asignaciones masivas — sin tocar código.
5. **Datos accionables:** los reportes no muestran "totales", muestran **dónde mirar** (qué rep, qué PDV, qué canal).

### Próximos pasos a anunciar (roadmap visible pero no implementado todavía)

- **Calendario Territory** (vista mes/semana de qué hace cada TM Rep cada día)
- **Stock de materiales** (entrega → uso en PDV → reposición con trazabilidad)
- **Evolución de precios** con filtros por ruta, zona y rutas agrupadas
- **Vista jerárquica completa:** Regional → Territory → Ejecutivo → TM Rep, cada uno ve lo suyo + lo de los que tiene a cargo

---

## TIPS PARA LA DEMO

- **Si algo falla:** el cliente recuerda cómo lo manejaste, no el bug. Decí *"vamos a pasar al siguiente bloque"* y seguí.
- **Tiempo:** si vas corto, salteá 2.4 (Gestión PDV) — los filtros se pueden mencionar verbalmente.
- **Tiempo:** si te sobra, mostrá el flujo de aprobación de un PDV nuevo dado de alta por el rep en campo.
- **No expliques cómo funciona la tecnología.** Mostrá qué problema resuelve. *"Esto antes era una llamada al supervisor"* → mejor que *"esto usa un context global de React"*.
- **Validá entre actos:** *"¿Tiene sentido hasta acá?"* — abrí preguntas en bloques chicos, no al final.

---

## CHECKLIST PRE-DEMO (5 min antes)

- [ ] `python seed_demo.py` corrido exitosamente
- [ ] Backend levantado (`uvicorn app.main:app --reload` → http://localhost:8000/docs responde)
- [ ] Frontend levantado (`npm run dev` → http://localhost:5173 responde)
- [ ] Login con `carlos@demo.com / Demo123!` funciona y muestra ruta del día
- [ ] Login con `admin@demo.com / Demo123!` funciona y muestra dashboard admin
- [ ] El PDV "Kiosco San Martín" muestra la nota amarilla pendiente al abrirlo
- [ ] La pestaña Reportes muestra la tabla "Tiempo promedio por TM Rep en cada PDV"
- [ ] Wifi estable (GPS necesita conexión)
- [ ] Pantalla lista con resolución alta (zoom 110% si va a verse en proyector)
