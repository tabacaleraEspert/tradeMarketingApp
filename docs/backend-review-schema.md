# Revisión backend — Schema SQL, índices, cascadas y migraciones

**Fecha:** 2026-04-21
**Alcance:** `backend/app/models/*.py` (18 modelos SQLAlchemy) + `backend/alembic/versions/*.py` (5 migraciones) + carpeta `backend/migrations/` (sistema paralelo).
**Foco:** integridad de datos, performance de queries, robustez ante deletes, coherencia schema vs lógica, migraciones.
**Método:** lectura archivo/línea de todos los modelos y migraciones.

---

## 0. Resumen ejecutivo

Si tuviera que quedarme con tres cosas del schema:

1. **Casi no hay índices** en las columnas que el código filtra sistemáticamente. `Visit.UserId`, `Visit.PdvId`, `Visit.OpenedAt`, `Visit.Status` — todos aparecen en filtros de `list_visits` y en los reportes mensuales, pero ninguno tiene índice. Lo mismo `User.ManagerUserId` (usado en `hierarchy.py` para resolver la jerarquía en cada request autenticado), `VisitAnswer.VisitId`, `VisitCheck.VisitId`, `PdvNote.CreatedByUserId`. Con 6-20 usuarios piloto esto pasa desapercibido; con datos reales la latencia explota.

2. **No hay cascadas definidas en ninguna FK**. La línea 39 de `user.py` (`UserRole`), la 10-11 de `visit.py` (`Visit.PdvId`, `Visit.UserId`), la 46-47 de `route.py` (`RoutePdv`), el 15 de `pdv_note.py` (`PdvNote.PdvId`)… ninguna declara `ondelete=`. En SQL Server eso se traduce a `NO ACTION` por default: cualquier `DELETE /users/{id}` o `DELETE /pdvs/{id}` falla con FK constraint error si hay hijos. La consecuencia práctica: el endpoint `delete_user` devuelve 500 sin manejar el error, y el frontend muestra un toast críptico al admin.

3. **El baseline de Alembic (`0001_baseline.py`) no es declarativo** — llama a `Base.metadata.create_all()`. Esto significa que la historia del schema vive en el git de `app/models/*.py`, no en alembic. `alembic downgrade` es destructivo (drop all), `alembic revision --autogenerate` no tiene baseline contra el cual comparar. Además convive con la carpeta `backend/migrations/` (ya reportado en el review de backend), lo que suma una fuente de verdad adicional.

Lo demás son piezas de ese puzzle: JSON como String, Status como String sin CHECK, campos legacy que no se migraron, timestamps inconsistentes, y race conditions que la DB podría prevenir con UNIQUE parciales.

A favor: las FKs están todas declaradas, los tipos numéricos coherentes (Numeric(9,6) para coordenadas), los PK compuestos usados donde corresponde (`UserRole`, `RouteForm`, `RoutePdv`, `RouteDayPdv`, `VisitPhoto`), y el patrón `CreatedAt` con `server_default=func.now()` es consistente.

---

## 1. Índices que faltan

Las columnas abajo aparecen en `WHERE`, `JOIN` o `ORDER BY` de queries frecuentes. Sin índice, cada query hace scan completo de la tabla.

### 1.1 Tabla `Visit` — la más crítica
**Archivo:** `backend/app/models/visit.py:6–21`
**Columnas sin índice que debieran tenerlo:**
- `UserId` — filtrado en `list_visits`, en reports vendor ranking, en estadísticas mensuales. En producción con cientos de visitas por usuario, scanning todas es inaceptable.
- `PdvId` — filtrado cada vez que se carga el historial de un PDV (`get_visit_history`, frontend `History.tsx`).
- `OpenedAt` — todos los reports filtran por rango de fechas (`report_summary`, `vendor_ranking`, `channel_coverage`).
- `Status` — `list_visits`, validación de duplicados OPEN/IN_PROGRESS.
- `RouteDayId` — `list_visits` filtra por `route_day_id` opcional.

**Fix sugerido:**
```py
# índice compuesto más usado
Index("ix_visit_user_opened", "UserId", "OpenedAt"),
Index("ix_visit_pdv_opened", "PdvId", "OpenedAt"),
Index("ix_visit_status", "Status"),
Index("ix_visit_routeday", "RouteDayId"),
```

### 1.2 Otros casos críticos
**Archivos/columnas:**
- `User.ManagerUserId` (`user.py:16`) — la jerarquía (`hierarchy.py::get_all_subordinate_ids`) hace BFS recursivo sobre esto. Sin índice, cada request autenticado que resuelva visibilidad escanea la tabla `User` completa.
- `User.ZoneId` (`user.py:14`) — filtro por zona en reportes.
- `VisitAnswer.VisitId` (`visit.py:42`) — se filtra por visita cada vez que se muestran las respuestas. Sin índice, scan de `VisitAnswer` entera.
- `VisitCheck.VisitId` (`visit.py:28`) — idem.
- `VisitAction.VisitId` (`visit_action.py:11`) — `visitActionsApi.list` filtra por visita.
- `VisitFormTime.VisitId` (`visit_form_time.py:11`).
- `PDV.ZoneId`, `PDV.ChannelId`, `PDV.IsActive` (`pdv.py:18, 14, 39`) — filtros frecuentes en list_pdvs y reports.
- `Route.AssignedUserId` (`route.py:27`) — filtro principal en list_routes por dueño.
- `Route.ZoneId` (`route.py:12`).
- `RouteDay.WorkDate`, `RouteDay.AssignedUserId` (`route.py:57–58`) — filtrado por día+usuario en el flujo mobile del TM.
- `MandatoryActivity.ChannelId`, `RouteId` (`mandatory_activity.py:18–19`).
- `Incident.PdvId`, `VisitId`, `Status` (`incident.py:10–13`).
- `PdvContact.PdvId` (`pdv_contact.py:11`).
- `Form.CreatedByUserId` (`form.py:19`).

**Los únicos índices explícitos hoy** son los `index=True` que trae el PK autoincremental (redundante, ya viene por ser PK) y el `index=True` en `Holiday.Date` (`holiday.py:16`) + `index=True` en `PdvNote.PdvId` (`pdv_note.py:15`). Y el `UserVacation.UserId` de la migración 0005. Todo lo demás depende del engine.

**Fix integral:** crear una migración `0006_performance_indexes.py` que agregue los 15-20 índices anteriores. Para producción en Azure SQL conviene crearlos con `CREATE INDEX ... WITH (ONLINE = ON)` si hay trafico en vivo.

**Severidad:** Alta en producción.

---

## 2. Cascadas y orphan risk

### 2.1 Ninguna FK declara `ondelete`

**Patrón en toda la base:**
```py
PdvId = Column(Integer, ForeignKey("PDV.PdvId"), nullable=False)
```

**No hay** un solo `ForeignKey(..., ondelete="CASCADE")` ni `ondelete="SET NULL"` en los 18 modelos. Consecuencias:

| Operación | Qué pasa hoy (SQL Server NO ACTION) |
|---|---|
| `DELETE /users/{id}` si tiene visitas | FK error 547 → 500 al cliente |
| `DELETE /users/{id}` si tiene subordinados (ManagerUserId) | FK error → 500 |
| `DELETE /users/{id}` si tiene UserRole | FK error → 500 |
| `DELETE /pdvs/{id}` si tiene visitas | FK error → 500 |
| `DELETE /routes/{id}` si tiene RouteDays | FK error → 500 |
| `DELETE /visits/{id}` si tiene VisitAnswer/VisitCheck/VisitPhoto/VisitAction | FK error → 500 |

El endpoint `delete_user` (`routers/users.py:258–264`) hace `db.delete(user); db.commit()` sin try/except. En prod, eso tira 500. En SQLite con FK enforcement off (default en algunas configs), borra huérfanos silenciosamente.

**El único caso con cascade** es en `Channel ↔ SubChannel` (`channel.py:16`) con `cascade="all, delete-orphan"` — pero eso es cascade de SQLAlchemy (Python-side), no de SQL. Si alguien borra un Channel via SQL directo (seed, script), los SubChannels quedan huérfanos igual.

### 2.2 Fix sugerido por tabla

**Cascade (borrar hijos al borrar padre):**
- `Visit` → `VisitCheck`, `VisitAnswer`, `VisitPhoto`, `VisitAction`, `VisitFormTime`: `ondelete="CASCADE"`. Borrar una visita borra su evidencia.
- `PDV` → `PdvContact`, `PdvDistributor`, `PdvNote`: `ondelete="CASCADE"`. Un PDV borrado se lleva sus datos.
- `Route` → `RouteForm`, `RoutePdv`, `RouteDay`: `ondelete="CASCADE"`. `RouteDay` → `RouteDayPdv`: `ondelete="CASCADE"`.
- `Form` → `FormQuestion` → `FormOption`: `ondelete="CASCADE"`.
- `User` → `UserRole`: `ondelete="CASCADE"`.

**SET NULL (preservar hijos pero desreferenciar):**
- `User.ManagerUserId` al eliminar al manager: `ondelete="SET NULL"`. Los subordinados quedan huérfanos en el árbol pero no se borran.
- `Visit.RouteDayId`: `ondelete="SET NULL"`.
- `Route.AssignedUserId`: `ondelete="SET NULL"`.
- `Route.CreatedByUserId`: `ondelete="SET NULL"`.
- `Incident.CreatedBy`, `VisitId`, `PdvId`: `ondelete="SET NULL"` (ya nullable, coherente).
- `MandatoryActivity.ChannelId`, `RouteId`, `FormId`, `CreatedByUserId`: `ondelete="SET NULL"`.
- `PdvNote.CreatedByUserId`, `ResolvedByUserId`, `VisitId`: `ondelete="SET NULL"`.
- `Notification.CreatedBy`: `ondelete="SET NULL"`.

**Restringir (borrar el padre si tiene hijos activos):**
- Algunos casos donde borrar sin limpiar antes sea explícitamente un bug — p. ej. `UserVacation.UserId` ya se cascadearía junto con el User, así que CASCADE es seguro.

**Implementación:** una migración dedicada `0007_fk_cascades.py`. En Azure SQL requiere `ALTER TABLE ... DROP CONSTRAINT ...; ADD CONSTRAINT ... WITH ON DELETE ...`. En SQLite (dev) puede requerir recrear la tabla (batch_alter_table de alembic lo hace).

**Severidad:** Alta.

### 2.3 Bonus: complementar con pre-checks en la app

Las cascadas DB solucionan la integridad, pero la UX requiere avisar. Complementar con el "cascade warning" ya pedido en el informe de admin del frontend (2.2) y en el backend review (3.6): pre-fetch de cuántos hijos hay antes del DELETE, mostrar en el `ConfirmModal`.

---

## 3. JSON guardado como `String`

### 3.1 Campos afectados

| Modelo.Campo | Tipo actual | Uso |
|---|---|---|
| `PDV.TimeSlotsJson` | `String` (sin length) | Franjas horarias `[{from, to, label}, …]` |
| `PDV.AllowsJson` | `String` (sin length) | Flags `{pop, sueltos, acciones, …}` |
| `Route.FrequencyConfig` | `String(200)` | `{days: [1,3,5]}` |
| `Form.FrequencyConfig` | `String(200)` | idem |
| `FormQuestion.RulesJson` | `String` (sin length) | Reglas de validación |
| `VisitAnswer.ValueJson` | `String` (sin length) | Valores estructurados |
| `MandatoryActivity.DetailsJson` | `String` (sin length) | Plantilla de detalles |
| `VisitAction.DetailsJson` | `String` (sin length) | Detalles ejecutados |

### 3.2 Problema

**Representación:**
- `String` sin `length` en SQLAlchemy, compilado contra SQL Server, genera `NVARCHAR(MAX)`. Sin problema funcional pero ineficiente (MSSQL guarda MAX fuera de la página cuando pasa cierto tamaño).
- En SQLite es `TEXT` sin límite.

**Queries:**
- No se pueden hacer queries nativos del tipo `WHERE JSON_VALUE(TimeSlotsJson, '$.from') = '08:00'`. Toda consulta tiene que traer la fila y parsear en Python.

**Validación:**
- Un INSERT/UPDATE con JSON inválido (llave mal escrita, tipo incorrecto) pasa la DB sin error. El bug se manifiesta al leer.

### 3.3 Fix sugerido

Dos opciones:

**Opción A (recomendada en Azure SQL 2016+):** usar tipo `JSON` nativo de SQLAlchemy 2.0:
```py
from sqlalchemy import JSON
TimeSlotsJson = Column(JSON, nullable=True)
```
SQLAlchemy elige el tipo del engine: en MSSQL queda como NVARCHAR(MAX) con CHECK JSON constraint, en PostgreSQL JSONB, etc. La app sigue haciendo `json.loads/dumps` transparente pero agrega la validación.

**Opción B (más trabajo pero más explícita):** convertir los campos con estructura conocida a relaciones reales. `TimeSlotsJson` → tabla `PdvTimeSlot(PdvId, From, To, Label)`. `AllowsJson` → columnas booleanas o tabla de flags. Pierde flexibilidad, gana queryability e integridad.

Para campos completamente libres (`ValueJson`, `DetailsJson` de acciones/respuestas) la opción A es mejor. Para los más estructurados (`TimeSlotsJson`, `FrequencyConfig`) vale evaluar B a mediano plazo.

**Severidad:** Media.

---

## 4. Status / enum fields como String sin CHECK

### 4.1 Campos afectados

| Modelo.Campo | Valores esperados según código |
|---|---|
| `Visit.Status` (`visit.py:13`) | `OPEN`, `IN_PROGRESS`, `CLOSED`, `COMPLETED` |
| `Visit.FormStatus` (`visit.py:18`) | `DRAFT`, enviado, etc. (no visto en código) |
| `VisitCheck.CheckType` (`visit.py:29`) | `IN`, `OUT` |
| `VisitAction.ActionType` (`visit_action.py:12`) | `cobertura`, `pop`, `canje_sueltos`, `promo`, `otra` |
| `VisitAction.Status` (`visit_action.py:19`) | `PENDING`, `DONE`, `BACKLOG` |
| `VisitPhoto.PhotoType` (`visit.py:57`) | `frente`, `interior`, `exhibidor`, `general`, etc. |
| `RouteDay.Status` (`route.py:59`) | `PLANNED`, `IN_PROGRESS`, ... |
| `RouteDayPdv.ExecutionStatus` (`route.py:72`) | `PENDING`, `IN_PROGRESS`, `DONE` |
| `Route.FrequencyType` (`route.py:21`) | `every_15_days`, `weekly`, `specific_days` |
| `Form.Frequency` (`form.py:15`) | `always`, `weekly`, `biweekly`, `monthly`, `every_x_days`, `specific_days` |
| `Incident.Type` (`incident.py:12`) | tipos libres |
| `Incident.Status` (`incident.py:13`) | `OPEN`, `IN_PROGRESS`, `RESOLVED` |
| `Distributor.DistributorType` (`distributor.py:12`) | `Distribuidor`, `Mayorista`, `Intermediario` |
| `Notification.Type` (`notification.py:13`) | `info`, `warning`, `urgent` |
| `PdvContact.ContactRole`, `DecisionPower` (`pdv_contact.py:14–15`) | `dueño`, `empleado`, `encargado`; `alto`, `medio`, `bajo` |
| `Holiday.Kind` (`holiday.py:19`) | `national`, `regional`, `company` |

### 4.2 Problema

El código Python (p. ej. `visits.py:_VALID_STATUSES`) valida los valores al escribir. Pero:
- Un seed script puede meter valores distintos (`seed_db.py`, `seed_demo.py`, `seed_azure.py`, `seed_real_users.py` — 4 scripts que no revisé a fondo).
- Un SQL manual o un hotfix por ticket puede introducir strings libres.
- El tipado del campo no comunica la intención al DBA ni al desarrollador nuevo que abre el modelo.

### 4.3 Fix sugerido

SQLAlchemy `Enum` con `CHECK CONSTRAINT` generado:
```py
from sqlalchemy import Enum
Status = Column(
    Enum("OPEN", "IN_PROGRESS", "CLOSED", "COMPLETED", name="visit_status"),
    default="OPEN", nullable=False,
)
```

O si querés mantener `String`, agregar constraints explícitos vía `CheckConstraint`:
```py
__table_args__ = (
    CheckConstraint("Status IN ('OPEN','IN_PROGRESS','CLOSED','COMPLETED')", name="ck_visit_status"),
)
```

Esto requiere migración para los valores preexistentes que no cumplan.

**Severidad:** Media.

---

## 5. Campos legacy que no se migraron

**`PDV.Channel` (string, línea 13) vs `PDV.ChannelId` (FK, línea 14):**
Comentario dice "Legacy, usar ChannelId" pero la columna sigue. Si un seed o código viejo escribe `Channel` directo, el dato queda desconectado de la tabla `Channel`. Los reports que usen `ChannelId` no lo ven; los que usen `Channel` sí.

**`PDV.ContactName` + `PDV.ContactPhone` (líneas 22–23) vs tabla `PdvContact`:**
El código nuevo usa la tabla; la columna en PDV queda. En frontend, `PointOfSaleDetail.tsx` mezcla ambos orígenes en distintos lugares (ya reportado tangencialmente en los reviews mobile).

**`Route.FormId` (route.py:13) vs tabla `RouteForm`:**
Comentario dice "legacy, usar RouteForm". Si una ruta tiene un FormId directo y además RouteForm filas, ¿cuál gana?

### Fix

Decidir para cada caso:
1. **Si nadie los lee ya** → migración que copie al nuevo (para datos existentes) y después `drop_column`.
2. **Si se leen en algún endpoint** → migración one-shot + PR que cierre el código legacy.

Lo peor es dejarlos indefinidamente: cada dev nuevo pregunta "¿cuál uso?" y se pierde media hora. Cada report nuevo tiene que pensar si sumar o solo uno.

**Severidad:** Media (deuda arquitectónica).

---

## 6. Race conditions y uniqueness

### 6.1 Visita duplicada OPEN/IN_PROGRESS

**Archivo:** `routers/visits.py:98–111` (verificación en app) + `models/visit.py` (sin constraint).

**Problema:** el código valida que no haya otra visita abierta del mismo `(UserId, PdvId)` antes de crear una nueva. Pero si dos requests llegan concurrentes (doble tap en mobile, o retry del sync queue), ambos pasan el check y crean dos visitas abiertas. La validación Python es best-effort; la DB debería prevenirlo.

**Fix:** índice único parcial:
```py
Index(
    "ux_visit_open_per_user_pdv",
    "UserId", "PdvId",
    unique=True,
    mssql_where=text("Status IN ('OPEN','IN_PROGRESS')"),
)
```

En SQLite el `WHERE` de índice parcial funciona, en Azure SQL también. Con esto, el segundo INSERT concurrente recibe IntegrityError y el código lo maneja como 409.

**Severidad:** Media (probable en campo con reintentos offline).

### 6.2 `UserRole` como M2M pero el código lee solo el primero

**Archivo:** `models/user.py:37–40` — PK compuesta `(UserId, RoleId)` permite múltiples roles por usuario.
**Uso:** `auth.py:90` — `db.query(UserRoleModel).filter(UserRoleModel.UserId == user_id).first()` devuelve el primero y basta.

**Problema:** el esquema dice "un usuario puede tener muchos roles"; el código dice "solo uno cuenta". Si alguien inserta dos UserRole para el mismo UserId (bug, seed, race), el rol efectivo depende del orden que devuelva la DB (no determinístico). Un admin puede perder sus privilegios silenciosamente si se le asigna un segundo rol por error.

**Fix sugerido:** o convertir a 1-1 (PK solo `UserId`, sola FK `RoleId`), o aceptar múltiples roles y cambiar `get_user_role` a "devuelve el rol de mayor nivel".

**Severidad:** Media.

### 6.3 `Holiday.Date` sí tiene unique + index — ejemplo a seguir

En `holiday.py:16` (más migración 0003) se declara `unique=True, index=True` sobre `Date`. Ese es el patrón que se debería aplicar a otras columnas con uniqueness implícita:
- `Zone.Name` — ya es unique, OK.
- `Role.Name` — ya unique, OK.
- `User.Email` — ya unique, OK.
- `Distributor.Name` — ya unique, OK.
- `Channel.Name` dentro de una misma cuenta — NO es unique. Si un admin crea "Kiosco" dos veces, ambos conviven. Depende del modelo de negocio si se quiere evitar.
- `(Form.Name, Form.Version)` — debería ser unique compuesto. Hoy se pueden crear duplicados.
- `(Channel.Name, IsActive)` + `SubChannel.(Name, ChannelId)` — ¿permiten duplicados? No hay constraint.

**Severidad:** Baja (depende de UX que evite llegar a esa situación).

---

## 7. Timestamps inconsistentes (`UpdatedAt`)

**Con `CreatedAt` y `UpdatedAt`:** `User`, `PDV`.
**Solo `CreatedAt`:** `Form`, `FormQuestion`, `FormOption`, `Incident`, `Notification`, `Visit` (solo `OpenedAt`/`ClosedAt`), `VisitAnswer`, `VisitAction`, `PdvNote`, `PdvContact`, `Distributor` (ni CreatedAt), `Zone` (ninguno), `Route` (solo CreatedAt), `RouteDay` (solo CreatedAt), `MandatoryActivity`, `VisitFormTime` (tiene ambos).

**Problema:**
- Distributor y Zone no tienen ningún timestamp. No se puede auditar cuándo se creó/modificó un distribuidor o una zona.
- La falta de `UpdatedAt` en `Form`, `Incident`, `Notification` impide hacer incremental-sync ("dame los cambios desde el último sync") eficiente. Hoy todo pull del frontend trae la lista completa.
- Inconsistencia: si dos endpoints listan recursos parecidos (Incident vs Notification), uno ordena por CreatedAt y el otro no puede ordenar por UpdatedAt si lo necesitara.

**Fix:**
- Agregar `UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)` a `Form`, `Incident`, `Notification`, `Route`, `RouteDay`, `MandatoryActivity`, `PdvNote`, `PdvContact`.
- Agregar `CreatedAt` y `UpdatedAt` a `Distributor` y `Zone`.
- Migración: `ALTER TABLE ADD COLUMN UpdatedAt ... DEFAULT current_timestamp NOT NULL`.

**Severidad:** Baja (no bloqueante, pero es deuda que después cuesta más).

---

## 8. Hallazgos menores

### 8.1 `File.Url 600 chars` puede desbordarse
**Archivo:** `file.py:11`
**Problema:** el campo guarda una URL, potencialmente una SAS firmada de Azure Blob. SAS URLs pueden superar 400–500 chars con el query string de firma. 600 está ajustado pero posible. Si hay truncación silenciosa, la URL guardada no funciona.
**Fix:** subir a `String(1024)` o `nvarchar(max)`, o no almacenar la URL (sólo `BlobKey`) y regenerarla siempre al leer (ya se hace así en `upload_visit_photo` → `storage.get_url(blob_key)`).
**Severidad:** Baja.

### 8.2 `User.PasswordHash` 256 chars
**Archivo:** `user.py:12`
**Observación:** bcrypt produce hashes de ~60 bytes. 256 está sobredimensionado pero es inofensivo. Menciono solo porque si algún día se migra a argon2id (hash más largo, ~100 chars), puede tocar.
**Severidad:** N/A — no es issue.

### 8.3 `PDV.TimeSlotsJson` y `AllowsJson` sin `length`
**Archivo:** `pdv.py:33, 36`
**Problema:** en MSSQL esto compila a `NVARCHAR(MAX)`, que se almacena fuera de la página y es marginalmente más caro de leer. Para JSON chicos (franjas horarias, flags) no hace falta.
**Fix:** `String(1000)` o `String(500)`. O migrar a tipo `JSON` nativo como sugirió la sección 3.
**Severidad:** Baja.

### 8.4 `VisitPhoto.PhotoType` fuera de la PK
**Archivo:** `visit.py:52–59`
**Observación:** la PK es `(VisitId, FileId)`. Dos fotos del mismo `PhotoType` en la misma visita están permitidas (distinto FileId → distinta fila). Puede ser intencional (varias fotos del frente desde ángulos distintos) o un bug (solo debería haber una "general"). El frontend `PhotoCapture.tsx` parece asumir una foto por categoría obligatoria.
**Fix:** si la intención es una sola, agregar UNIQUE en `(VisitId, PhotoType)` para obligatorias y otro schema para opcionales. Caso contrario, documentar.
**Severidad:** Baja.

### 8.5 `SubChannel` cascade delete-orphan vs resto sin cascade
**Archivo:** `channel.py:16`
**Observación:** es el único lugar que usa `cascade="all, delete-orphan"`. Pattern bueno, pero inconsistente con el resto. Si se adopta el plan de la sección 2.2 (cascadas DB), esta cascade de ORM puede simplificarse.
**Severidad:** Baja.

### 8.6 `Device` modelo existe en `app/models/device.py` pero no lo leí
**Archivo:** `device.py` — referenciado en `VisitCheck.DeviceId` (`visit.py:35`). Vale la pena darle una pasada cuando se haga el cleanup.
**Severidad:** N/A.

### 8.7 `audit.py` modelo
**Archivo:** `models/audit.py` — existe pero no lo leí. Si implementa audit log, conviene revisar cómo se pobla y si captura eventos sensibles (login, role changes, deletes).
**Severidad:** N/A.

### 8.8 Convenciones mezcladas `CreatedBy` vs `CreatedByUserId`
**Archivos:**
- `Incident.CreatedBy` (`incident.py:17`)
- `Notification.CreatedBy` (`notification.py:17`)
- `Form.CreatedByUserId` (`form.py:19`)
- `Route.CreatedByUserId` (`route.py:17`)
- `PdvNote.CreatedByUserId` (`pdv_note.py:17`)
- `MandatoryActivity.CreatedByUserId` (`mandatory_activity.py:29`)

**Problema:** `CreatedBy` es ambiguo (puede ser un User, un nombre, un sistema). `CreatedByUserId` es claro. Cinco a uno a favor del formato largo; pasar los otros dos por consistencia.

**Severidad:** Baja.

### 8.9 `Distributor` sin `CreatedAt` ni `UpdatedAt`
**Archivo:** `distributor.py:5–15`
Sin timestamps. Si un admin edita un distribuidor, no hay forma de saber cuándo.
**Severidad:** Baja (cubierto en sección 7).

### 8.10 `Zone` sin `CreatedAt` ni `IsActive`
**Archivo:** `zone.py:6–9`
Solo `ZoneId` y `Name`. Si se discontinúa una zona, no hay forma de "archivarla" sin borrarla (y borrar rompe FKs).
**Fix:** agregar `IsActive` y `CreatedAt`.
**Severidad:** Baja.

---

## 9. Sistema de migraciones — ya reportado, lo consolido

### 9.1 Alembic baseline non-declarativo

Ya mencionado en sección 0. El `0001_baseline.py` llama `Base.metadata.create_all()`. Consecuencias:
1. Ningún dev puede ver el schema inicial mirando el archivo.
2. `alembic downgrade` es `drop_all` (destructivo).
3. `alembic revision --autogenerate` genera diffs contra modelos actuales, pero como el baseline no tiene nada explícito, el primer autogenerate después de 0005 puede repetir tablas.

**Fix:** después de estabilizar el schema (cerrando los puntos de este informe), regenerar el baseline:
```bash
# contra una DB limpia
alembic revision --autogenerate -m "baseline_v2"
# revisar el archivo generado, que ahora tendrá op.create_table(...) explícitos
# reemplazar 0001_baseline por este
# dar un "alembic stamp baseline_v2" a las DBs existentes
```

### 9.2 Carpeta `backend/migrations/` paralela

5 scripts Python en `migrations/` (add_business_rules_fields.py, add_channel_subchannel_contacts.py, add_notifications.py, add_route_foco_fields.py, add_visit_workflow_fields.py) + 1 `schema_azure.sql`. Además 2 scripts sueltos en la raíz del backend.

Ya reportado en el backend review security-architecture (2.1, 2.3). Fix: consolidar en alembic y borrar los demás.

**Severidad:** Alta (para deploy).

### 9.3 Cuatro seed scripts

Ya reportado. `seed_db.py`, `seed_demo.py`, `seed_azure.py`, `seed_real_users.py`. Consolidar.

**Severidad:** Media.

---

## 10. Tabla consolidada

| # | Hallazgo | Archivo/línea | Sev. | Tipo |
|---|---|---|---|---|
| 1.1 | Sin índices en Visit.UserId/PdvId/OpenedAt/Status/RouteDayId | `visit.py:6–21` | Alta | Perf |
| 1.2 | Sin índices en User.ManagerUserId, ZoneId | `user.py:14, 16` | Alta | Perf |
| 1.2 | Sin índices en VisitAnswer.VisitId, VisitCheck.VisitId, etc. | `visit.py` | Alta | Perf |
| 1.2 | Sin índices en PDV.ZoneId, ChannelId, IsActive | `pdv.py:14, 18, 39` | Alta | Perf |
| 1.2 | Sin índices en Route.AssignedUserId, RouteDay.WorkDate/AssignedUserId | `route.py:27, 57–58` | Alta | Perf |
| 2.1 | Ninguna FK declara `ondelete` | 18 modelos | Alta | Integridad |
| 2.2 | `delete_user` rompe con FK constraint | `users.py:258–264` + schema | Alta | Bug |
| 3.x | JSON guardado como String | varios | Media | Quality |
| 4.x | Status/enum fields sin CHECK constraint | varios | Media | Integridad |
| 5.1 | Campos legacy Channel/ContactName/FormId | `pdv.py`, `route.py` | Media | Arquitectura |
| 6.1 | Race condition en Visit OPEN/IN_PROGRESS duplicadas | `visit.py` | Media | Integridad |
| 6.2 | UserRole como M2M pero código lee 1 | `user.py:37–40` + `auth.py:90` | Media | Consistencia |
| 6.3 | Form.Name + Version sin unique compuesto | `form.py` | Baja | Integridad |
| 7.x | UpdatedAt inconsistente | varios | Baja | Quality |
| 7.x | Distributor, Zone sin timestamps | `distributor.py`, `zone.py` | Baja | Quality |
| 8.1 | File.Url 600 chars puede desbordar con SAS | `file.py:11` | Baja | Bug latente |
| 8.3 | TimeSlotsJson, AllowsJson sin length | `pdv.py:33, 36` | Baja | Perf |
| 8.4 | VisitPhoto.PhotoType fuera de PK | `visit.py:52–59` | Baja | Ambigüedad |
| 8.5 | SubChannel cascade delete-orphan inconsistente | `channel.py:16` | Baja | Consistencia |
| 8.8 | CreatedBy vs CreatedByUserId | varios | Baja | Consistencia |
| 8.10 | Zone sin IsActive | `zone.py` | Baja | Quality |
| 9.1 | Baseline Alembic non-declarativo | `alembic/versions/0001_baseline.py` | Alta | Migraciones |
| 9.2 | Carpeta migrations/ paralela | `backend/migrations/` | Alta | Migraciones |
| 9.3 | 4 seed scripts | `seed_*.py` | Media | Ops |

---

## 11. Plan de ataque sugerido

**Tanda 1 — índices (1 día, bajo riesgo, gran impacto en perf):**

1. Migración `0006_performance_indexes.py` con los 15–20 índices de la sección 1.
2. Aplicar en staging, medir query time antes/después con `EXPLAIN` o query store de Azure.
3. Deploy en prod con `CREATE INDEX ... WITH (ONLINE = ON)` para no bloquear escrituras.

**Tanda 2 — cascadas y constraints (1–2 días):**

4. Migración `0007_fk_cascades.py` con `ondelete` de la sección 2.2.
5. UNIQUE parcial de la sección 6.1 (`ux_visit_open_per_user_pdv`).
6. CHECK constraints de los principales enums (sección 4).
7. Actualizar `delete_user`, `delete_pdv`, etc. para envolver en try/except y devolver 409 con mensaje claro si hay hijos que bloquean (además del cascade donde aplique).

**Tanda 3 — limpieza schema (sprint):**

8. Migración + PR para retirar campos legacy (`PDV.Channel`, `PDV.ContactName/Phone`, `Route.FormId`).
9. Agregar `UpdatedAt` a tablas que no lo tienen.
10. `Distributor`, `Zone`: timestamps + `IsActive`.
11. `Form`: UNIQUE compuesto `(Name, Version)`.
12. `UserRole`: decidir M2M real vs 1-1 y alinear código.

**Tanda 4 — migraciones y ops (sprint):**

13. Consolidar migraciones: regenerar baseline alembic declarativo, borrar `migrations/` y scripts ad-hoc.
14. Consolidar seed scripts en uno solo con flags.
15. Migrar JSON fields a tipo `JSON` nativo (SQLAlchemy 2.0).

**Tanda 5 — auditoría y observabilidad (a plan):**

16. Revisar `audit.py`: qué loguea, qué no, agregar eventos sensibles (role change, user delete, login failed).
17. Enable Query Store en Azure SQL para detectar queries lentas en prod.
18. CloudWatch/Azure Monitor alerts sobre connection pool exhaustion.

---

## 12. Referencias cruzadas

- **Backend security review (hallazgo 3.6)**: "`delete_user` sin warning de cascada" — confirmado acá con la explicación SQL (las FKs no tienen `ondelete`). Fix integral requiere ambos: cascadas DB (sección 2) + pre-check app (backend review 2.2).
- **Frontend admin review (hallazgo 1.1)**: "cascada de borrado de usuario sin info" — el fix UX del frontend (mostrar cuántos subordinados, etc.) depende de que el backend pueda responder rápido, lo cual requiere los índices de la sección 1.
- **Backend security review (hallazgo 2.1)**: "dos sistemas de migraciones" — elaborado acá (sección 9).
- **Backend security review (performance / N+1 en routers)**: mitigación parcial con índices (sección 1); el fix full sigue siendo `joinedload` en el código.

---

*Revisión generada leyendo los 18 modelos + 5 migraciones alembic + carpeta migrations/. Los campos afectados por el plan (especialmente cascadas) requieren pruebas en staging con datos reales: convertir FKs existentes en CASCADE puede ser destructivo si hay filas huérfanas ya presentes.*
