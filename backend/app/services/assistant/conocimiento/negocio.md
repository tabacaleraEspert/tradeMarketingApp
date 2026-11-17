# El negocio

Tabacalera Espert fabrica y vende cigarrillos y productos afines (tabacos, papelillos, vapes, pouches) en Argentina. El equipo de Trade Marketing recorre puntos de venta (kioscos, autoservicios, cadenas, estaciones de servicio y similares) para relevar qué se vende, colocar producto y material, y registrar la visita en la app.

# Cómo está organizado

- **Zona**: división geográfica (por ejemplo AMBA, Cuyo, La Plata). Cada PDV, ruta y usuario pertenece a una zona.
- **Canal y subcanal**: tipo de comercio del PDV.
- **Equipo**: árbol jerárquico. Roles, de menor a mayor: vendedor (el "trade" o "TM rep" que recorre la calle), ejecutivo, territory manager, regional manager, admin. Cada usuario reporta a un superior.
- **PDV**: punto de venta. Tiene un trade asignado (su "cartera"), zona, canal, coordenadas y dos datos propios: si trabaja productos Espert y si vende cigarrillos sueltos (ambos pueden estar sin dato).
- **Ruta**: lista ordenada de PDVs asignada a un trade. Hay dos clases:
  - **Ruta foco** (regular): el universo sobre el que se miden los objetivos mensuales del trade.
  - **Ruta de campaña**: recorrido temporal con fecha de fin (activaciones, cadenas). No entra en los objetivos.
- **Día de ruta**: una ruta planificada para una fecha, con sus PDVs y el orden previsto.
- **Visita**: registro de un trade en un PDV, con check-in por GPS, fotos, formularios, censo y acciones.
- **Censo**: en la visita el trade releva, producto por producto, si el PDV lo trabaja, a qué precio y con qué disponibilidad. Incluye productos propios y de la competencia.
- **Acciones**: canje de sueltos, promos y juegos que el trade ejecuta en el PDV, con entregas de producto.
- **Material POP**: cartelería y exhibidores; se censa lo presente y se registran las colocaciones.

# Dos miradas sobre los mismos datos

- **Inteligencia**: censo histórico consolidado (la última respuesta conocida de cada PDV para cada producto, sin ventana de tiempo), competencia y oportunidades. Responde "qué trabaja hoy cada PDV".
- **Tablero TMR**: actividad del mes sobre las rutas foco (visitas, cumplimiento del plan, GPS, fotos, acciones, entregas). Responde "cómo trabajó el equipo en el período".

# Qué NO está en el sistema (no lo inventes)

- Ventas, facturación, volumen despachado, stock y cuentas corrientes: viven en el ERP (Bejerman), no acá.
- Sueldos, comisiones liquidadas y datos personales del equipo.
- Precios de lista: los precios que hay son los relevados en el PDV durante el censo.
- Ventas de la competencia: solo sabemos si un PDV trabaja un producto, no cuánto vende.
