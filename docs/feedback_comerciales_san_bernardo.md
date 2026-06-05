# Feedback comerciales San Bernardo

> Levantado el 2026-06-03. **NO atacar todavía** — backlog para priorizar después.

## Items

1. **Consumo de batería y datos móviles**
   - Revisar el footprint de la app. Reportes informales de que consume mucho.
   - Posibles culpables a investigar: precache offline, GPS polling, sync worker re-flushes, sentry, animaciones continuas (animate-pulse en badges).

2. **Al editar la dirección se duplicó la visita**
   - Reproducir: PDV con visita en curso → editar dirección del PDV → se generó una segunda visita.
   - Hipótesis a verificar: el editar PDV dispara un refetch que crea una visita fantasma, o el flujo de check-in se re-dispara.

3. **Poder borrar la foto que subiste**
   - En este momento las fotos del local / fachada / POP no son borrables desde el celular una vez subidas.
   - UX request: ícono de papelera en cada foto del listado.

4. **Admin mobile**
   - El panel admin está pensado para escritorio (anchos grandes, tablas).
   - Pedido: que sea operable desde el celular para tareas básicas (alta de usuarios, asignación de TM, etc.).

5. **POP pide dos veces la foto del PDV** (reportado por Sol)
   - Hay que reproducir el flujo exacto que ella sigue.
   - Confirmado además: al final de la visita el sistema le vuelve a pedir la foto (segunda vez).
   - Hipótesis a verificar: alguna pantalla del censo POP reabre el picker después de tomar la foto, o el componente de foto se desmonta y vuelve a pedirla; revisar también el cierre de visita.

6. **Texto explicativo en cada pedido de foto**
   - En cada paso que pide foto (fachada, POP, acción, etc.) mostrar qué se está pidiendo exactamente.
   - Evita que el usuario tome la foto equivocada o no entienda el contexto.

7. **Opción de elegir foto desde la galería**
   - Hoy solo se puede usar la cámara. Permitir también seleccionar una imagen ya guardada en el celular.

8. **Pausar un check-in e ir a otro PDV**
   - Caso: el PDV está lleno y no se puede atender. Hoy te traba con "visita en curso" y no podés iniciar otra.
   - Pedido: poder pausar la visita actual e iniciar otra; al volver, retomar la pausada.

9. **Heredar info de la visita anterior en los censos**
   - En la próxima visita, en cobertura / POP / acciones, mostrar lo que se relevó la vez pasada (precios, presencia, acciones) con la fecha.
   - Objetivo: que el TM pueda comparar / actualizar, no empezar de cero.

10. **Mostrar tiempo de visita en `/admin/visit-data`**
    - Hoy el modal del detalle de visita (ver screenshot) muestra fecha + hora de cierre pero no la duración total.
    - Agregar "Duración: X min" o "OpenedAt → ClosedAt".

11. **Re-chequear obligatoriedad de la foto**
    - En algunos pasos la foto es obligatoria cuando no debería serlo (ej: acciones).
    - Auditar cada paso y aflojar donde no aporta.

12. **Perfect Store (input de Santi)**
    - Recordatorio: revisar el WhatsApp de Santi con la propuesta de "Perfect Store" y evaluar.

13. **Cantidad de visitas hasta tener TODOS los datos cargados**
    - Métrica nueva: cuántas visitas pasan hasta que un PDV tiene su perfil completo (incluye datos del alta).
    - Útil para entender adopción y completitud de data.

14. **Cobertura de PRECIOS NO ESPERT — obligatoria cada 5 visitas**
    - Hoy no hay regla; pedir el relevamiento cada 5 visitas en vez de en cada una.
    - Reduce fricción en visitas frecuentes.

15. **Productos ESPERT — stock + precio obligatorios**
    - Complemento del 14: para productos ESPERT, stock y precio sí son obligatorios siempre.
    - UX: hoy no aparece obligatorio pero igual hay que relevarlo — alinear UI con la regla real.

16. **Agregar Hills a la lista de productos para cobertura**
    - Nuevo SKU/marca a incluir en el catálogo de productos de la cobertura.

17. **Marcar en el PDV si vende sueltos o no**
    - Nuevo campo/flag en el perfil del PDV: "vende sueltos" sí/no.
    - Permite segmentar y filtrar en reportes / acciones de canje de sueltos.

18. **Ver cumplimiento de criterios para variable mensual**
    - El vendedor (y/o su manager) tiene que poder ver en qué está parado respecto al variable: qué criterios cumple, cuáles faltan, % de avance del mes.
    - UX: una vista dedicada estilo "mi variable" que muestre los criterios y el progreso en tiempo real, sin tener que pedirlo por mail/excel.

---

## Notas de proceso

- Estos items vienen del campo en San Bernardo, no de QA de oficina. Priorizar los que tocan operación diaria (1, 3) sobre los nice-to-have (4).
- Antes de cada fix, intentar reproducir con un usuario real / device real, no solo en desarrollo.
