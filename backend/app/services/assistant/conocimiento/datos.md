# Cómo leer los datos

## Censo en tres estados

Para cada PDV y producto hay tres situaciones posibles:

| Estado | Qué significa |
|---|---|
| Sí | El trade relevó que el PDV trabaja el producto |
| No | El trade relevó explícitamente que no lo trabaja |
| Sin dato | Nadie lo relevó (no hay respuesta) |

"Sin dato" nunca es "No". Los "No" anteriores a una fecha de corte histórica tampoco cuentan, porque en esa época la app no distinguía "no" de "no relevado" (`get_cobertura_datos` informa el corte). Vale la última respuesta conocida de cada PDV para cada producto.

## Indicadores de Inteligencia (censo histórico)

- **PDVs activos**: universo total. **Censados**: los que tienen al menos un producto relevado. **% censado** = censados / activos.
- **Con Espert**: censados que trabajan al menos un producto propio. **Cobertura** = con Espert / censados (no sobre activos).
- **Completitud**: qué porcentaje del catálogo activo tiene respuesta (Sí o No) en el PDV; promedio sobre todos los PDVs del grupo, los no censados pesan 0. **Completitud Espert**: lo mismo sobre el catálogo propio.
- **A completar**: PDVs donde se relevó competencia pero no se sabe nada de Espert. Falta censo; no son oportunidad todavía.
- **SKUs promedio Espert**: cuántos productos propios trabaja, en promedio, un PDV con Espert.
- **Visitas 30d**: visitas de los últimos 30 días corridos.

## Oportunidades

Motor de reglas sobre el censo consolidado. Un PDV es oportunidad solo cuando el lado Espert está relevado explícitamente.

| Tipo | Prioridad | Qué detecta |
|---|---|---|
| primera_colocacion | Crítica | Trabaja competencia y ningún producto Espert. Si aplica, las demás reglas no se evalúan para ese PDV |
| categoria | Alta | Una categoría (tabacos, papelillos, vapes, pouches) solo con competencia |
| capsulados | Alta | Tiene capsulado de la competencia y ninguno de Espert |
| extension_milenio | Media | Tiene Milenio Red y le falta alguna variante capsulada (una oportunidad por variante) |
| franja_precio | Media | La competencia le cubre una franja de precio donde Espert tiene oferta y no está |

Un mismo PDV puede tener varias oportunidades: "cantidad de oportunidades" no es "cantidad de PDVs".

## Indicadores del Tablero TMR (actividad del período, sobre rutas foco)

- **Visitas**: visitas registradas en el período. **PDVs visitados**: PDVs distintos de sus rutas foco con al menos una visita. **Universo**: PDVs de sus rutas foco.
- **Efectividad** = PDVs planificados que se visitaron / PDVs planificados en el período. Sin plan cargado da 0 y no significa que no trabajó.
- **GPS %** y **Foto %**: visitas con check-in con GPS y con al menos una foto, sobre el total de visitas.
- **Acción %**: visitas con al menos una acción ejecutada. **Entregas**: unidades entregadas en canjes, promos y juegos.
- **Duración**: minutos promedio por visita.
- Por ruta: **relevados** (PDVs con censo en el período), **buenos** (PDVs con nivel de cobertura bueno) y **cobertura score** = buenos / relevados.
- Solo aparecen trades con al menos una ruta foco vigente. Un usuario que no figura puede simplemente no tener ruta foco.

## Comportamiento en campo (un trade, por rango de fechas, máximo 92 días)

- **ON / OFF promedio**: hora del primer check-in y del último check-out del día.
- **ON tarde**: primer check-in después de las 10:00. **OFF temprano**: último check-out antes de las 16:00.
- **Fuera de perímetro**: check-in a más de 200 m del PDV. **Visita corta**: cerrada en menos de 3 minutos. **Sin GPS**: visita sin posición.
- **Plan %**: PDVs planificados visitados / planificados. **Orden respetado %**: días en que se siguió el orden previsto.
- **Km en línea**: suma de distancias en línea recta entre visitas consecutivas; subestima el recorrido real por calle.

## Gestión de PDVs

- **Días desde la última visita** se agrupa en tramos: hasta 7 días, 8 a 14, 15 a 30, 31 a 60, más de 60, y nunca visitado.
- **Trabaja Espert** y **vende sueltos** son datos del PDV con tres estados: sí, no, sin dato.
- Un PDV sin trade asignado es "huérfano": no está en la cartera de nadie.

## Frescura

- Inteligencia y el Tablero se recalculan como mucho cada 30 y 10 minutos: una visita recién cargada puede tardar en aparecer.
- Antes de la primera visita registrada en la app (la informa `get_cobertura_datos`) no hay datos, y eso no significa que no hubo actividad.
