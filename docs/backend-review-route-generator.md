# Revisión backend — `route_generator.py`

**Fecha:** 2026-04-21
**Alcance:** `backend/app/routers/route_generator.py` (402 LOC), un único endpoint público `POST /routes/generate-proposal`.
**Foco:** correctitud del algoritmo (clustering + TSP + balanceo), seguridad (DoS, autorización, autorización cruzada de zonas), calidad del código.
**Método:** lectura completa del archivo y razonamiento manual sobre los invariantes del algoritmo.

---

## 0. Resumen ejecutivo

El módulo implementa un generador de propuestas de ruta a partir de una lista de PDVs. Usa K-means (k-means++ init) para cluster geográfico, balanceo manual para respetar min/max PDVs por cluster, y nearest-neighbor TSP con scoring por horario de apertura/cierre. No escribe en DB: devuelve propuestas que el cliente confirma después.

**Tres cosas que conviene ver primero:**

1. **DoS trivial**: el endpoint está gateado con `require_role("vendedor")` que (ya reportado) equivale a "cualquier usuario autenticado". `pdv_ids: list[int]` no tiene límite. Un TM malicioso puede mandar `pdv_ids: [1,2,...,50000]` y disparar ~O(n²·iter) operaciones de CPU (50k puntos en k-means con 50 iteraciones). Sin rate limiting, múltiples workers quedan tomados.

2. **Authorización cruzada de zonas**: el endpoint carga PDVs por ID (`line 317`) **sin validar** que pertenezcan a la zona del TM que está llamando. Un vendedor de Cuyo puede pedir rutas con PDVs de Buenos Aires. Peor todavía, un regional_manager puede armar rutas sobre PDVs de otra región.

3. **Magic numbers de negocio** hardcodeados en el código: 25 km/h, 15 min/PDV, ventana de almuerzo 12:00-14:00, start_hour 8:00, penalizaciones 50/5/3. No son configurables. El cambio de cualquiera requiere una PR, y no se puede calibrar por región ni por rol.

Además hay bugs de algoritmo chicos (el estimador de hora de llegada al primer PDV suma 15 min de visita ficticia previa), inconsistencia entre el "tiempo estimado" que usa el TSP para ordenar vs el que se devuelve en la respuesta, y varias faltas de validación de entrada (`min < max`, k dentro de rango razonable, etc.).

---

## 1. Seguridad

### 1.1 DoS: endpoint caro con `require_role("vendedor")`
**Líneas:** 303–307
**Problema:** el gate es efectivamente "any authenticated user" (ver el informe backend security-architecture 1.2). Combinado con el costo computacional del endpoint:
- K-means: O(n · k · iter) — con n=10k, k=10, iter=50 → 5 millones de operaciones de Haversine, cada una con `sin/cos/asin/sqrt`.
- TSP dentro de cada cluster: O(n²) — con cluster de 1000 puntos, 1M operaciones.
- Haversine recalculada en el scoring TSP sin memoización — es cara (4 trig calls).

**Cálculo rápido:** `pdv_ids` con 10.000 PDVs, k=10, iter=50 + TSP sobre clusters de ~1k → ~50M operaciones Haversine. En Python puro (sin numpy), ~30-60 segundos de CPU por request. Un par de requests concurrentes bloquean los workers FastAPI.

**Fix:**
1. Limitar `pdv_ids` a máx 500 ítems (Pydantic `Field(..., max_length=500)`).
2. Subir el role a `territory_manager` o superior.
3. Agregar rate limiting estricto (p. ej. 5 generations/hora por usuario via `slowapi`).
4. Considerar mover el cálculo a un background worker (Celery/ARQ) y devolver un job_id que el frontend pollea. Así no bloquea el request sync.

**Severidad:** Alta (DoS real + ya expuesto).

### 1.2 Autorización cruzada de zonas
**Líneas:** 316–319
**Problema:**
```py
pdvs = db.query(PDVModel).filter(PDVModel.PdvId.in_(data.pdv_ids), PDVModel.IsActive == True).all()
```
No valida que los `pdv_ids` pertenezcan a la zona del `current_user`. Tampoco filtra por `PDV.AssignedUserId == current_user.UserId` ni usa el helper `get_visible_user_ids` de `hierarchy.py`.

Consecuencia: un TM puede enumerar PDVs de otras zonas y generarles rutas (no persisten pero la respuesta las expone; es leak de dirección, nombre, coordenadas).

**Fix:**
```py
from ..hierarchy import get_visible_user_ids
from ..auth import get_user_role as _auth_get_user_role

role = _auth_get_user_role(db, current_user.UserId)
if role not in ("admin", "regional_manager"):
    # filtrar PDVs a los asignados al TM o a su zona
    visible_ids = get_visible_user_ids(db, current_user, role)
    pdvs = db.query(PDVModel).filter(
        PDVModel.PdvId.in_(data.pdv_ids),
        PDVModel.IsActive == True,
        or_(
            PDVModel.AssignedUserId.in_(visible_ids),
            PDVModel.ZoneId == current_user.ZoneId,  # o similar
        )
    ).all()
```
Devolver los `pdv_ids` que se filtraron en el response (`unauthorized_pdv_ids`) para que el cliente muestre info.

**Severidad:** Alta.

### 1.3 Sin rate limiting
Ya mencionado en 1.1. Para este endpoint específicamente, el límite debería ser **mucho más restrictivo** que endpoints normales: 5 generaciones por hora y por usuario.

**Severidad:** Alta.

### 1.4 Input sin validación de rangos
**Líneas:** 27–32 — `GenerateRequest`
```py
class GenerateRequest(BaseModel):
    pdv_ids: list[int]          # sin max_length
    max_routes: int = 10         # sin ge/le
    min_pdvs_per_route: int = 25 # sin ge
    max_pdvs_per_route: int = 35 # sin ge, ni chequeo > min
    route_name_prefix: str = "Ruta"  # sin max_length
```

**Problemas:**
- `pdv_ids` sin límite → DoS (1.1).
- `max_routes` sin tope → cliente puede pedir 10000 rutas (fuerza k grande, k-means inútil).
- `min_pdvs_per_route > max_pdvs_per_route` no se detecta → el balanceo entra en loop de split+merge sin converger.
- `min_pdvs_per_route = 0` permite clusters vacíos.
- `route_name_prefix` sin límite → el cliente puede mandar 10MB de string y el backend lo escribe en cada `name` de ruta.

**Fix:**
```py
from pydantic import Field, field_validator, model_validator

class GenerateRequest(BaseModel):
    pdv_ids: list[int] = Field(..., min_length=1, max_length=500)
    max_routes: int = Field(default=10, ge=1, le=50)
    min_pdvs_per_route: int = Field(default=25, ge=1, le=200)
    max_pdvs_per_route: int = Field(default=35, ge=1, le=200)
    route_name_prefix: str = Field(default="Ruta", max_length=40)

    @model_validator(mode="after")
    def _min_le_max(self):
        if self.min_pdvs_per_route > self.max_pdvs_per_route:
            raise ValueError("min_pdvs_per_route no puede ser mayor que max_pdvs_per_route")
        return self
```

**Severidad:** Media.

### 1.5 `random.randint` en k-means++ sin seed
**Líneas:** 79, 87
**Observación:** para dos llamadas con el mismo input, los resultados varían. Esto es correcto para k-means pero:
- Impide reproducibilidad (QA, bug reports).
- Si dos admins corren la misma generación y comparan, ven rutas distintas y dudan.

**Fix:** aceptar un `seed: int | None = None` opcional en `GenerateRequest` y pasárselo a `random.Random(seed)` local. Sin seed = no determinístico.

**Severidad:** Baja.

---

## 2. Correctitud del algoritmo

### 2.1 Bug en el estimador de hora de llegada al primer PDV
**Línea:** 189
```py
arrival_min = current_time_min + 15 + travel_min  # 15 min en PDV actual + viaje
```

**Problema:** `current_time_min` arranca en `start_hour * 60 = 480` (8:00). La primera iteración del bucle TSP considera `current = order[-1]` = start_idx. El `arrival_min` se calcula para `j` = próximo candidato.

En la primera iteración, el TM ya ha "llegado" al `start_idx` (no viajó) y está decidiendo a dónde ir después. Entonces sumar 15 min de "visita al PDV actual" es correcto solo si el TM empezó el día con una visita ya hecha.

Si el TM empieza el día en el primer PDV (entre en `start_idx` a las 8:00), el tiempo de llegada al segundo PDV debería ser `8:00 + 15 min visita + travel_min = 8:15 + travel_min`. Eso es lo que el código calcula. OK.

Pero para el **primer PDV** (el `start_idx`), no se usa arrival_min — sí, porque se elige por "cierre más temprano", no por hora de llegada. Esto desincroniza la lógica: el primer PDV puede ser uno que cierra a las 13:00, y lo visitamos a las 8:00. Bien. Después vamos a los que cierran más tarde. La lógica es OK, pero el `current_time_min` inicial (8:00) asume que el TM arrancó a tiempo, cosa que el algoritmo no tiene forma de saber.

**Conclusión:** no es un bug per se, pero la lógica es frágil. El comentario "15 min en PDV actual + viaje" (línea 189) es engañoso porque sugiere que es el tiempo de la visita anterior, cuando en realidad es una aproximación global.

**Fix:** documentar o reformular como `arrival_min = current_time_min + TIME_PER_VISIT + travel_min` con una constante nombrada.

**Severidad:** Baja.

### 2.2 Inconsistencia entre tiempo del TSP y tiempo de la respuesta
**Líneas:** 174, 229 (TSP) vs 386–388 (respuesta)

El TSP mantiene un `current_time_min` que se actualiza con cada viaje y visita (líneas 174, 229). Al final del TSP, ese valor refleja la hora estimada de finalización de la última visita.

Pero en `generate_route_proposal` (líneas 386–388), se calcula `estimated_minutes` separado:
```py
drive_min = (total_km / 25) * 60
visit_min = len(ordered_pdvs) * 15
est_minutes = round(drive_min + visit_min)
```

No aprovecha el cálculo del TSP. Los dos deberían dar el mismo número pero pueden divergir (sobre todo si el TSP modificó su camino por penalizaciones de horario, el `total_km` no cambia pero la secuencia sí).

**Fix:** el TSP devuelve tanto `order` como `total_minutes`. Usar ese valor en la respuesta.

**Severidad:** Baja.

### 2.3 El `_balance_clusters` split sequential rompe geografía
**Líneas:** 258–266
```py
while len(clusters[c]) > max_size:
    overflow = clusters[c][max_size:]
    clusters[c] = clusters[c][:max_size]
    clusters[new_cluster_id] = overflow
    ...
```

**Problema:** el overflow se toma como los últimos `N - max_size` elementos de `clusters[c]`, sin considerar posición geográfica. El orden en `clusters[c]` viene de la iteración inicial `for i, c in enumerate(assignments)` (línea 248): es el orden de llegada al cluster, que no tiene relación con la geometría.

Consecuencia: si un cluster de 50 se parte en dos de 25, los 25 del overflow pueden estar dispersos (no formar un cluster natural). El TSP posterior les va a asignar una ruta larga.

**Fix:** al partir, correr un mini-k-means con k=2 sobre los puntos del cluster y armar los dos sub-clusters con geometría. O usar ward linkage / similar. Cualquier cosa mejor que rebanar por índice.

**Severidad:** Media (afecta calidad de las rutas en clusters grandes).

### 2.4 `_balance_clusters` no re-balance después de merge
**Líneas:** 269–296

Después de un merge (líneas 290–295), el target cluster (`best_target`) puede quedar sobredimensionado (si venía con 30 y le sumamos 10 → 40, cuando max=35). El código no vuelve a iterar.

**Fix:** o iterar split + merge en un loop hasta convergencia (con tope de iteraciones), o al menos re-splittar después del merge.

**Severidad:** Media.

### 2.5 K-means no reinicia si hay clusters vacíos
**Líneas:** 109–115
```py
for c in range(k):
    members = [points[i] for i in range(n) if assignments[i] == c]
    if members:
        centroids[c] = (...)
```

Si un cluster pierde todos sus miembros (puede pasar si k es grande comparado con la dispersión), el centroide no se actualiza pero el algoritmo asume que está. El cluster vacío persiste en `active` hasta el balanceo.

**Fix:** reinit empty clusters con el punto más lejano a cualquier centroide (técnica estándar).

**Severidad:** Baja (edge case con datasets adversariales; poco probable con TMs reales).

### 2.6 TSP no considera límite de jornada laboral
**Función:** `_tsp_nn`
**Problema:** el TSP sigue agregando PDVs hasta que no queden, sin cortar si el `current_time_min` excede, digamos, 18:00 (hora de cierre de jornada TM). Una ruta puede terminar con 30 PDVs donde los últimos 5 "se visitan" a las 21:00.

**Fix:** agregar `max_end_hour: int = 18` al `_tsp_nn`. Si `arrival_min > max_end_hour * 60`, cortar y devolver el `order` parcial + señalar los PDVs que no entran.

**Severidad:** Media (importante para el usuario: saber que esta ruta es inviable por tiempo).

### 2.7 TSP no considera punto de partida del TM
**Función:** `_tsp_nn`
**Problema:** elige el `start_idx` como "PDV que cierra antes" (línea 165). Pero el TM tiene un origen (su casa, la oficina). El primer PDV debería ser el más cercano al origen, no el que cierra antes — salvo que el que cierra antes esté también cerca del origen.

**Fix:** aceptar `start_coords: tuple[lat, lon] | None` en `_tsp_nn` y usar para el scoring del primer PDV.

**Severidad:** Media (afecta calidad de ruta en el mundo real).

### 2.8 No se considera retorno
El `total_distance_km` es la suma de hops consecutivos. No incluye el retorno desde el último PDV a la base. Si la ruta es un ida y vuelta, los km subestiman.

**Fix:** agregar parámetro opcional `return_to_start: bool` y sumar haversine del último al primero si está activo.

**Severidad:** Baja (depende del modelo operativo real).

### 2.9 Silently ignores PDVs sin coordenadas
**Líneas:** 322–326
**Observación:** los PDVs sin lat/lon se devuelven en `unassigned_pdv_ids`. Eso está bien pero:
- El frontend muestra esa lista como "estos quedaron afuera".
- No sugiere un fix ("dale de alta con coordenadas").
- Si TODOS los PDVs sin coord son obligatorios, el TM arma una ruta incompleta sin saberlo.

**Fix:** en la respuesta, agregar `reason_unassigned: str` por PDV ("missing coordinates", "outside zone", etc.).

**Severidad:** Baja.

### 2.10 No hay test unitario del algoritmo
No hay `tests/test_route_generator.py`. Los bugs sutiles del algoritmo (ordenamiento incorrecto, clusters desbalanceados, divergencias de tiempos) solo saldrán a la luz con datos reales en prod.

**Fix:** crear fixtures mínimos:
- Test 1: 10 PDVs en línea recta, max_routes=2 → 2 clusters de 5, TSP en orden.
- Test 2: 30 PDVs en 3 esquinas → k=3 clusters, balanceados.
- Test 3: duplicados en coordenadas → no crash.
- Test 4: PDV con close_time 10:00, otro con close_time 14:00 → primero se visita antes.

**Severidad:** Alta a plan.

---

## 3. Calidad de código

### 3.1 Magic numbers de negocio
**Líneas:** 188 (25 km/h, ya reportado en backend review 2.4), 189 (15 min/visita), 200 (50 penalty), 205 (60 min threshold, 5 bonus), 210 (10 penalty), 214 (12:00 lunch start), 215 (14:00 lunch end), 218 (3 penalty), 386-387 (25, 15 otra vez).

**Problema:**
- Duplicación: `25` y `15` aparecen 2-3 veces cada uno. Si cambia el supuesto de velocidad, hay que cambiarlos en 3 lugares.
- No configurable: si una zona tiene 40 km/h promedio (Patagonia) y otra 15 km/h (GBA con tráfico), no se puede setear distinto.

**Fix:**
```py
# Al tope del archivo
DEFAULT_SPEED_KMH = 25
DEFAULT_VISIT_MINUTES = 15
DEFAULT_START_HOUR = 8
LUNCH_WINDOW = (12 * 60, 14 * 60)
SCORE_PENALTY_AFTER_CLOSE = 50
SCORE_BONUS_URGENT_THRESHOLD = 60
SCORE_BONUS_URGENT = -5
SCORE_PENALTY_BEFORE_OPEN = 10
SCORE_PENALTY_LUNCH = 3
```

Y eventualmente exponer los primeros cuatro como parámetros del endpoint (`GenerateRequest`) para calibrar por zona o por rol.

**Severidad:** Media.

### 3.2 `from collections import defaultdict` dos veces
**Líneas:** 245 (dentro de `_balance_clusters`) y 345 (dentro del endpoint).
**Fix:** mover el import al top del archivo (ya hay otros imports ahí).
**Severidad:** Baja (higiene).

### 3.3 Función `generate_route_proposal` de 95 líneas
**Líneas:** 308–402
**Problema:** una función hace todo: validación, load, cluster, balance, TSP, build response. Difícil de testear unitariamente.
**Fix:** extraer:
- `_validate_and_adjust_k(n, data) -> int`
- `_load_pdvs_for_user(db, pdv_ids, current_user) -> tuple[with_coords, without_coords]`
- `_cluster_pdvs(points, k, min_size, max_size) -> dict[int, list[int]]`
- `_build_proposals(clusters, pdvs, points, prefix) -> list[RouteProposal]`

Luego `generate_route_proposal` es 15 líneas encadenadas.

**Severidad:** Media.

### 3.4 `float(p.Lat)` pierde precisión
**Líneas:** 322, 376–377
**Observación:** `PDV.Lat` es `Numeric(9, 6)` → Decimal en Python. Castear a float convierte a IEEE 754 doble precisión, que para coordenadas sobra (precisión > 1 cm). No es un bug práctico pero conceptualmente pierde precisión.
**Fix:** dejar como está o usar `Decimal` en haversine (marginalmente más lento, casi idéntico resultado).
**Severidad:** N/A.

### 3.5 `response_model` no incluye `unauthorized_pdv_ids`
Ya mencionado en 1.2: si el fix de autorización filtra PDVs, el response debería comunicárselo al cliente.
**Severidad:** Media.

### 3.6 `RoutePdvProposal.SortOrder` arranca en 0
**Líneas:** 378
**Observación:** SortOrder 0-indexed en la propuesta, pero `RoutePdv` model usa `SortOrder` sin documentar si es 0 o 1 indexed. Si el frontend muestra "PDV #1" y guarda con SortOrder=1, la conversión hay que hacerla en algún lado. Fácil fuente de off-by-one.
**Fix:** explicitar en el docstring y estandarizar.
**Severidad:** Baja.

### 3.7 Sin métricas / instrumentación
El endpoint es CPU-intensive pero no hay logging de:
- Tamaño del input (n).
- Tiempo de cada fase (kmeans, balance, tsp).
- k final vs k solicitado.

Sin eso, cuando alguien reporta "fue lento" o "me dio cualquier cosa", no hay forma de reproducir.

**Fix:** envolver cada fase en un block timer y loguear con el request_id ya disponible (`middleware.RequestIdMiddleware`).

**Severidad:** Baja.

---

## 4. Observaciones positivas

- **K-means++ init** bien implementado (líneas 78–95): usa el patrón de probabilidades proporcionales a distancia². Mejor que k-means vanilla aleatorio.
- **Separa PDVs sin coords** (líneas 322–326) y los devuelve explícitos, sin silenciosamente ignorarlos.
- **Scoring TSP con horarios** (líneas 194–218) es una buena heurística para un TSP real, más allá de la distancia pura. Priorizar cierres tempranos y penalizar almuerzo son reglas correctas.
- **Early return en casos chicos** (`n <= k` en línea 75) evita división por cero.
- **Balanceo considera max_size antes de merge** (línea 279) — no crea clusters sobredimensionados con el merge.
- **No tiene dependencia de numpy/scipy** — se implementa con math puro. Ventaja: menos peso en requirements, deployable en ambientes restrictivos. Desventaja: lento en Python puro vs numpy (mitigable con límites de input).
- **El router no persiste nada** — devuelve una propuesta y el cliente decide. Patrón seguro: el cálculo es idempotente, si falla no queda estado a medias.

---

## 5. Tabla consolidada

| # | Hallazgo | Línea(s) | Sev. | Tipo |
|---|---|---|---|---|
| 1.1 | DoS: endpoint caro con gate "vendedor" efectivo abierto | 303–307 | Alta | Seguridad |
| 1.2 | Autorización cruzada de zonas | 316–319 | Alta | Seguridad |
| 1.3 | Sin rate limiting | global | Alta | Seguridad |
| 1.4 | Input sin validación de rangos | 27–32 | Media | Seguridad |
| 1.5 | `random` sin seed opcional | 79, 87 | Baja | Quality |
| 2.1 | Comentario del estimador de arrival_min confuso | 189 | Baja | Quality |
| 2.2 | Doble cálculo inconsistente del tiempo | 174, 229, 386–388 | Baja | Bug |
| 2.3 | Split sequential rompe geografía | 258–266 | Media | Correctness |
| 2.4 | No re-balance después de merge | 269–296 | Media | Correctness |
| 2.5 | K-means no reinicia clusters vacíos | 109–115 | Baja | Correctness |
| 2.6 | TSP no corta por jornada laboral | 134–231 | Media | Correctness |
| 2.7 | TSP no considera punto de partida | 161–167 | Media | Correctness |
| 2.8 | total_distance_km no incluye retorno | 380–383 | Baja | Correctness |
| 2.9 | unassigned_pdv_ids sin razón | 401 | Baja | UX |
| 2.10 | Sin tests unitarios | — | Alta a plan | Quality |
| 3.1 | Magic numbers 25/15/50/etc | varias | Media | Quality |
| 3.2 | `from collections` importado 2 veces | 245, 345 | Baja | Quality |
| 3.3 | Función de 95 líneas | 308–402 | Media | Quality |
| 3.4 | `float(p.Lat)` pierde precisión | 322, 376–377 | N/A | — |
| 3.5 | Response sin `unauthorized_pdv_ids` | 399–402 | Media | Quality |
| 3.6 | SortOrder 0 vs 1 indexed ambiguo | 378 | Baja | Quality |
| 3.7 | Sin métricas / logging | global | Baja | Observability |

---

## 6. Plan de ataque sugerido

**Tanda 1 — blindar el endpoint (1 día, alto retorno en seguridad):**

1. **1.1 DoS**: subir role a `territory_manager`, limitar `pdv_ids` a 500, agregar rate limit 5/hora por usuario.
2. **1.2 Authorización cruzada**: filtrar PDVs por zona/jerarquía del current_user usando `get_visible_user_ids`.
3. **1.4 Input validation**: Pydantic Field + validators para todos los rangos.

**Tanda 2 — mejorar calidad del output (2–3 días):**

4. **3.1 Magic numbers**: constantes nombradas al tope del archivo.
5. **2.3 Split geográfico**: usar mini-kmeans en split de clusters oversized.
6. **2.4 Re-balance iterativo**: loop split/merge hasta convergencia con tope.
7. **2.6 Cortar por jornada**: respetar `max_end_hour` en TSP.
8. **2.7 Start point opcional**: aceptar origen del TM para primer PDV.

**Tanda 3 — mantenibilidad (1 sprint):**

9. **3.3 Extraer helpers**: partir la función grande en 4 privadas testeables.
10. **2.10 Tests**: crear `tests/test_route_generator.py` con casos de borde.
11. **3.7 Métricas**: log de tiempos por fase, log del tamaño de input y k final.
12. **1.5 Seed opcional** para reproducibilidad.
13. **2.1/2.2 Consolidación de tiempos**: que el TSP devuelva `(order, total_minutes)` y el endpoint lo use.

**Tanda 4 — producto (a plan):**

14. **Exponer speed y visit_minutes por zona** en admin (para calibrar Patagonia vs GBA).
15. **Background job**: mover el cálculo a worker async, poll del frontend con job_id.
16. **Presentar `estimated_minutes` como rango** (min-max) en vez de valor puntual.
17. **2.9 Razones de unassigned** con códigos explícitos.

---

## 7. Referencias cruzadas

- **Backend security-architecture (1.2 `require_role("vendedor")`)**: directamente aplicable acá — el generador es uno de los endpoints afectados por esa falsa sensación de gating.
- **Backend security-architecture (1.4 `data: dict` mass assignment)**: el generador NO usa `data: dict`, sino `GenerateRequest` Pydantic → positivo. Solo falta completar con validators (sección 1.4).
- **Backend security-architecture (2.4 magic numbers)**: elaborado acá en detalle (3.1).
- **Backend security-architecture (2.7 tests casi inexistentes)**: este módulo es uno de los que más lo sufriría — un bug sutil en el algoritmo puede deteriorar la calidad de rutas sin que nadie lo note hasta que un TM lo reporte.
- **Backend schema (1.2 Visit perf sin índice)**: no aplica directo al generador (que no escribe en Visit), pero si se persiste la propuesta después, los índices de Route/RoutePdv importan — no auditados en ese informe, vale mirar.
- **Frontend ux-journey (2.6 RouteGenerator sin progreso ni cancel)**: fix complementa al 16 de este plan (background job + polling).
- **Frontend TM mobile rest (3.4 RouteGenerator sin progreso ni cancel)**: mismo hallazgo desde el lado cliente.

---

*Revisión generada con lectura completa del archivo (402 LOC) y razonamiento manual sobre los invariantes del algoritmo. Los bugs de correctitud (sección 2) son hipótesis basadas en código; conviene confirmar con datasets reales o tests unitarios antes de asignar prioridad productiva.*
