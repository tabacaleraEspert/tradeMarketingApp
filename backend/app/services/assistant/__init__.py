"""Asistente IA "Puchi" — consultas en lenguaje natural sobre los datos de la app.

Patrón Bachi (MiPileta), portado desde `RRHH/rrhh-novedades` (.NET) a FastAPI.
Solo lectura: el modelo responde llamando herramientas tipadas (`tools.py`) que
reusan las mismas funciones que alimentan Inteligencia, el Tablero TMR y Gestión
de PDV, así los números del chat coinciden con las pantallas.

    provider.py         mensajes y protocolo agnósticos del proveedor
    openai_provider.py  ÚNICO archivo que conoce el SDK de OpenAI
    loop.py             loop de tool-use con cierre forzado
    tools.py            herramientas + registro (nunca lanzan al loop)
    compact.py          compactación columnar de resultados
    prompt.py           prompt estable (cacheado) + volátil; conocimiento/*.md
    turnlog.py          auditoría, rate limit, costo, purga, reporte de uso

Reglas heredadas que NO hay que romper están comentadas en `loop.py`.
"""
