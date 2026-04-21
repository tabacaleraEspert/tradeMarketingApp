# Revisión backend — Seguridad y arquitectura

**Fecha:** 2026-04-21
**Alcance:** `backend/` completo (~10.300 LOC Python, FastAPI + SQLAlchemy + Pydantic + Alembic, apuntando a Azure SQL / MSSQL, con Azure Blob Storage, Sentry y JWT).
**Foco:** seguridad + autorización + calidad de código y arquitectura.
**Método:** lectura estática con verificación archivo/línea directa sobre los módulos sensibles (auth, users, reports, visits, files, incidents, routes, forms) y delegación para breadth en el resto.

Este es el primer informe que mira el backend: si algún hallazgo ya aparecía en los 5 informes del frontend como "hipótesis a validar contra backend", acá queda confirmado o desmentido.

---

## 0. Resumen ejecutivo

### Tres hallazgos críticos que conviene no dejar pasar

1. **CORS totalmente abierto** en producción (`app/main.py:24–31`): `allow_origins=["*"]` + `allow_credentials=True` + `allow_methods=["*"]` + `allow_headers=["*"]`. Cualquier sitio puede invocar la API del TM desde un navegador. En combinación con cookies/tokens en `localStorage` + CSRF potencial, es una superficie enorme.
2. **`require_role("vendedor")` no restringe nada** — el modo `strict=False` por default usa jerarquía, y como vendedor es el nivel 1 (el más bajo), todo rol autenticado pasa. Se usa en endpoints sensibles (`POST/PATCH /routes`, `POST/PATCH /forms`, `POST /route_generator`) dando una falsa sensación de gating. Cualquier usuario autenticado puede crear/editar rutas y formularios, y disparar el generador automático de rutas (costoso en CPU).
3. **Endpoints sin autorización** que filtran datos sensibles entre usuarios:
   - `GET /files/{file_id}` (`files.py:227–243`) — devuelve URL firmada de cualquier archivo por enumeración de ID.
   - `GET /files/photos/visit/{visit_id}` (`files.py:168–185`) — **lista fotos de cualquier visita** sin validar ownership (solo valida que la visita exista).
   - `GET /visits/{visit_id}/answers` (`visits.py:358–365`) — lee respuestas de encuesta de cualquier visita.
   - `GET /visits` (`visits.py:46–65`) — enumera visitas de cualquier usuario/PDV vía query params sin filtro.
   - `GET /reports/*` — todos los reportes sin filtro de zona ni rol (confirma el hallazgo del informe de admin).
   - `GET /users/{id}/stats/monthly`, `GET /users/{id}/role` (`users.py:130, 269`) — sin auth.
   - `GET /incidents`, PATCH, DELETE (`incidents.py` entero) — sin auth.
   - `pdv_notes`, `visit_actions`, `market_news`, `notifications` — mismo patrón.

### Lo bueno

- El núcleo de auth está bien pensado: bcrypt para passwords, JWT con expiración, `access` vs `refresh` separados, `require_role` con jerarquía, y el role se re-lee de la DB en cada request (si te demoten, el siguiente request usa el rol fresco, no el del token).
- El CRUD de `/users/*` (crear, editar, borrar, setear rol) **sí** está bien gateado con `require_role("admin")`. La escalada de privilegios que el informe del frontend flaggeaba como "crítica" está **bloqueada por el backend**. Good news.
- El storage (`app/storage.py`) es una abstracción limpia con fallback local para dev.
- Se usan validators Pydantic en varios sitios (email, password, coordenadas).
- Hay un `RequestIdMiddleware` para tracing y `init_sentry()` integrado.

### Lo que falta (no tan urgente pero sí a plan)

- Sin tests (solo 2 archivos, ~110 líneas). Sin CI/CD en repo. Ningún endpoint tiene tests de autorización.
- Dos sistemas de migraciones conviviendo (`alembic/versions/` + `migrations/` con scripts Python + `add_route_form_table.py` sueltos en la raíz).
- Cuatro seed scripts redundantes (`seed_db.py`, `seed_demo.py`, `seed_azure.py`, `seed_real_users.py`).
- Patrones de N+1 en list endpoints (routes, pdvs, reports).
- Input sin `data: dict` sin tipar en 5 endpoints.
- JWT con `access_token` de 8 HORAS (`config.py:21`) — demasiado para un token que se guarda en cliente. Best practice son 15 min + refresh de 7 días.
- **`JWT_SECRET_KEY` default `"dev-secret-CHANGEME-in-prod-please"`** — si el env var no está seteado en prod, la app arranca igual sin avisar.

---

## 1. Seguridad

### 1.1 CORS abierto con credenciales

**Archivo:** `app/main.py:24–31`
```py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)
```

**Problema:**
- `allow_origins=["*"]` + `allow_credentials=True` es inconsistente con la spec CORS (el navegador rechaza la combinación). FastAPI igual la acepta y sirve — pero muestra intención de aceptar cualquier origen con credenciales.
- Más importante: combinado con `allow_methods=["*"]` + `allow_headers=["*"]`, **cualquier sitio malicioso puede montar un fetch cross-origin con el JWT del usuario** si el frontend lo pone en `Authorization` header (que es como lo hace hoy, ver `frontend/src/lib/api/client.ts`). Aunque `localStorage` no se envía solo, un ataque XSS en dominio externo → exfil.
- Sin `Content-Security-Policy`, sin CSRF tokens.

**Fix:**
```py
allow_origins = [settings.frontend_origin]  # ej. "https://app.espert.com.ar"
# Nunca "*" con credenciales.
```

Setear `frontend_origin` en config con default seguro. Si hay múltiples dominios (staging + prod), lista explícita.

**Severidad:** **Crítica** en producción. OK en dev local.

### 1.2 Gate "vendedor" que no restringe nada

**Archivos:**
- `routes.py:212, 236` (`POST/PATCH /routes`)
- `forms.py:50, 81` (`POST/PATCH /forms`)
- `route_generator.py:306` (`POST /route-generator/*`)

**Problema:** `require_role(*allowed_roles, strict=False)` con default `strict=False` usa jerarquía (`app/auth.py:184`): permite el rol exacto **o cualquier rol de nivel superior**. Como `vendedor` tiene nivel 1 (el más bajo), `require_role("vendedor")` permite absolutamente a todos los roles. El gate es decorativo.

Esto contradice el informe del frontend que flaggeaba que `FormBuilder` y `RouteManagement` no tienen gating de cliente: **el backend tampoco los gatea realmente**. Un `vendedor` hoy puede:
- Crear rutas y asignárselas a otros usuarios (el endpoint acepta `AssignedUserId` libre).
- Crear formularios que afecten a todos los TMs.
- Disparar el generador automático de rutas (operación costosa, potencial DoS barato).

**Fix corto (cambio de gate):**
```py
# routes.py
@router.post(..., dependencies=[Depends(require_role("territory_manager"))])
@router.patch(..., dependencies=[Depends(require_role("territory_manager"))])
# forms.py
@router.post(..., dependencies=[Depends(require_role("admin"))])  # forms globales = solo admin
@router.patch(..., dependencies=[Depends(require_role("admin"))])  # con excepción de ownership ya en 93
# route_generator.py
@router.post(..., dependencies=[Depends(require_role("territory_manager"))])
```

**Fix largo (más seguro):** hacer el default de `require_role` `strict=True` y exigir `strict=False` explícito cuando se quiere jerarquía. Así los errores de intención se convierten en 403 en vez de puertas abiertas.

**Severidad:** Alta. Impacto concreto:
- Cualquier TM puede crear un formulario que **cambia las preguntas que otros TMs tienen que responder en sus visitas de mañana**.
- Cualquier TM puede editar rutas ajenas.

### 1.3 Endpoints sin auth que filtran datos entre usuarios

Todos estos endpoints **no tienen** `Depends(get_current_user)` como parámetro ni `require_role` — aunque el router general tenga `Depends(get_current_user)` en `main.py` (y sí lo tiene), eso solo asegura que el usuario **está logueado**, no que puede ver esos datos específicos.

| Endpoint | Archivo/línea | Qué filtra | Severidad |
|---|---|---|---|
| `GET /files/{file_id}` | `files.py:227–243` | URL firmada de cualquier File por enumeración de ID | Crítica |
| `GET /files/photos/visit/{visit_id}` | `files.py:168–185` | Fotos de cualquier visita (solo valida que la visita exista) | Crítica |
| `GET /visits/{visit_id}/answers` | `visits.py:358–365` | Respuestas de encuesta de cualquier visita | Crítica |
| `GET /visits` | `visits.py:46–65` | Enumera visitas por `user_id`/`pdv_id`/`route_day_id` sin filtro | Alta |
| `GET /visits/{visit_id}` | `visits.py:68–73` | Detalle de cualquier visita | Alta |
| `GET /reports/summary`, `/vendor-ranking`, `/channel-coverage`, `/gps-alerts`, `/pdv-map` | `reports.py` entero | Métricas nacionales sin filtro de zona/rol | Alta |
| `GET /users/{id}/stats/monthly` | `users.py:130–173` | Stats mensuales de cualquier usuario | Media |
| `GET /users/{id}/role` | `users.py:269–275` | Rol de cualquier usuario | Baja (info pública) |
| `GET /incidents`, `POST`, `PATCH`, `DELETE` | `incidents.py` entero | CRUD de incidencias sin auth | Alta |
| `POST /notifications`, `PATCH`, `DELETE` | `notifications.py` | Cualquier TM puede crear/editar notificaciones globales | Alta |
| `pdv_notes.py`, `visit_actions.py`, `market_news.py` | | Patrón repetido | Media/Alta |

**Fix transversal:** en cada endpoint sensible, agregar `current_user: UserModel = Depends(get_current_user)` y aplicar una de estas reglas:
- **Dueño o admin**: para visits, visit_answers, visit_photos, pdv_notes (ownership via VisitModel.UserId o similar).
- **Rol mínimo**: para notifications, incidents create/patch/delete, market_news.
- **Hierarchy filter**: para reports y list endpoints con filter libres, reusar `get_visible_user_ids` de `hierarchy.py` (ya existe).

Ejemplo para `list_visit_answers`:
```py
@router.get("/{visit_id}/answers", response_model=list[VisitAnswer])
def list_visit_answers(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    v = db.query(VisitModel).filter(VisitModel.VisitId == visit_id).first()
    if not v:
        raise HTTPException(404, "Visita no encontrada")
    _check_visit_ownership(v, current_user, db)   # ya existe
    return db.query(VisitAnswerModel).filter(...).all()
```

**Severidad:** Crítica a Alta según endpoint.

### 1.4 Mass assignment via `data: dict` sin tipar

**Archivos/líneas (verificados):**
- `visits.py:494` — `POST /visits/{visit_id}/checks` — permite setear campos arbitrarios del model VisitCheck.
- `visits.py:559` — `POST /visits/{visit_id}/form-times` — idem VisitFormTime.
- `mandatory_activities.py:48` — `POST /mandatory-activities` — admin-gated (territory_manager+) pero igual sin schema.
- `mandatory_activities.py:73` — `PATCH /mandatory-activities/{id}` — idem.
- `users.py:279` — `PUT /users/{id}/role` — admin-gated, impacto menor, pero igual mala práctica.

**Problema:** `data: dict` desactiva toda validación Pydantic. Lo que llegue del request se procesa tal cual — un atacante puede inyectar campos que el dev no previó (`CreatedByUserId`, `Status`, `IsActive`, timestamps, etc.).

**Caso concreto peligroso** — `incidents.py:37–51`:
```py
@router.post("", response_model=Incident, status_code=201)
def create_incident(data: IncidentCreate, db: Session = Depends(get_db)):
    i = IncidentModel(
        ...
        CreatedBy=data.CreatedBy,   # ← cliente elige quién "creó" la incidencia
    )
```
Acá `IncidentCreate` sí es schema, pero incluye `CreatedBy` como campo libre. Un atacante puede crearse incidencias "en nombre de" otro usuario. Debería autogenerarse desde `current_user`.

**Fix:** pasar todos los endpoints sin tipar a schemas Pydantic con campos mínimos. Los campos "system" (`CreatedBy`, `CreatedAt`, `UserId` del que ejecuta) siempre derivados del `current_user`, nunca del body.

**Severidad:** Alta.

### 1.5 JWT secret con default en código

**Archivo:** `app/config.py:19`
```py
jwt_secret_key: str = "dev-secret-CHANGEME-in-prod-please"
```

**Problema:** si el env var `JWT_SECRET_KEY` no está seteado en el servidor de producción, la app arranca con este secreto público. Quien lo sepa (es decir, cualquiera que clone este repo) puede forjar JWT válidos para cualquier usuario, incluso admin.

**Fix:**
```py
@validator('jwt_secret_key')
def must_not_be_dev_default(cls, v):
    if v == "dev-secret-CHANGEME-in-prod-please" and settings.sentry_environment == "production":
        raise ValueError("JWT_SECRET_KEY no seteado en producción")
    return v
```

O bien al startup de `main.py`:
```py
import os
if os.getenv("SENTRY_ENVIRONMENT") == "production" and settings.jwt_secret_key == "dev-secret-CHANGEME-in-prod-please":
    raise RuntimeError("JWT_SECRET_KEY no configurado en producción")
```

**Severidad:** Alta (catastrófico si se da el caso, pero depende de la configuración del deploy).

### 1.6 Access token de 8 horas

**Archivo:** `app/config.py:21` — `jwt_expire_minutes: int = 60 * 8`

**Problema:** un token interceptado (por XSS, malware, extensión comprometida) sirve 8 horas sin invalidación. Cerrar sesión en el cliente no invalida el token en servidor (no hay lista de revocados).

**Fix:**
- Access token: 15 min.
- Refresh token: 7 días (ya está bien).
- Opcional: lista de revocación en Redis para logout explícito; o `jti` + tabla de revocados.

**Severidad:** Media.

### 1.7 Sin rate limiting

No hay rate limiting en `/auth/login` ni en ningún otro endpoint. La única defensa contra brute force es la complejidad del password (mínimo 8 caracteres en el validator Pydantic, `schemas/user.py:18–23`).

**Fix:** `slowapi` (FastAPI) con límite de 5 intentos/minuto por IP en login, 100 req/min por usuario en APIs, 1 req/min en `/route-generator` (operación cara).

**Severidad:** Media.

### 1.8 No hay validación de tipo de archivo real (magic bytes)

**Archivo:** `app/routers/files.py:116–121, 90–165`; `users.py:300–340`
```py
content_type = (file.content_type or "").lower()
if content_type not in ALLOWED_CONTENT_TYPES: ...
```

**Problema:** `file.content_type` viene del cliente — un atacante puede subir un `.exe` etiquetado como `image/jpeg`. Aceptamos la etiqueta y la guardamos en Blob. Si el blob público se sirve con ese content-type, el browser lo baja como imagen pero en realidad tiene payload arbitrario.

**Fix:** usar `python-magic` o Pillow para verificar que los bytes son realmente una imagen antes de guardar:
```py
from PIL import Image
try:
    img = Image.open(io.BytesIO(data))
    img.verify()
except Exception:
    raise HTTPException(400, "Archivo no es una imagen válida")
```

**Severidad:** Media.

### 1.9 URL firmada SAS con TTL 6h

**Archivo:** `app/config.py:44` — `blob_sas_ttl_seconds: int = 60 * 60 * 6`

**Observación:** una URL firmada dura 6 horas. Si la URL se loggea en algún lado o si alguien la comparte, ese contenido queda accesible sin auth por 6h. No es crítico pero es largo para fotos de PDVs.

**Fix:** 15–30 min es razonable. Si el cliente necesita re-acceder, vuelve a pedirla.

**Severidad:** Baja.

### 1.10 No hay validación de ownership cruzada en `create_incident`, `create_notification`, etc.

Ya mencionado en 1.4. Revalidar: los `CreatedBy`/`ByUserId`/`OwnerId` **nunca** deberían venir del body; siempre derivados de `current_user`.

**Severidad:** Alta.

### 1.11 Secrets en logs

**Archivo:** `app/middleware.py` (revisar). No verifiqué directamente pero vale hacer una pasada: el `RequestIdMiddleware` probablemente no loggea bodies, pero vale confirmar que no escriben Authorization headers ni passwords en logs.

**Severidad:** Baja (a verificar).

---

## 2. Arquitectura y calidad de código

### 2.1 Dos sistemas de migraciones coexistiendo

**Archivos:**
- `alembic/versions/0001_baseline.py` … `0005_user_vacations.py` (5 migraciones Alembic ordenadas).
- `migrations/add_business_rules_fields.py`, `add_channel_subchannel_contacts.py`, `add_notifications.py`, `add_route_foco_fields.py`, `add_visit_workflow_fields.py` (5 scripts Python sueltos).
- `migrations/schema_azure.sql` (SQL raw).
- `backend/add_route_form_table.py`, `backend/add_route_formid.py` (2 scripts en la raíz).

**Problema:** no queda claro cuál es la fuente de verdad del schema. Alembic dice "baseline + 5 migraciones", pero la carpeta `migrations/` agrega 5 más que pueden o no estar reflejados en alembic. Un dev nuevo no sabe qué correr. Un deploy a un ambiente limpio puede terminar con schema incompleto o con columnas duplicadas.

**Fix:**
1. Tomar el schema actual de producción como verdad.
2. Regenerar el baseline alembic (`alembic revision --autogenerate`) contra una DB limpia con ese schema.
3. Borrar `migrations/` y los scripts ad-hoc.
4. Documentar en `RUNBOOK.md` que la única migración válida es `alembic upgrade head`.

**Severidad:** Alta (deuda arquitectónica que afecta deploy).

### 2.2 Cuatro seed scripts redundantes

**Archivos:** `seed_db.py` (381 líneas), `seed_demo.py` (658), `seed_azure.py` (315), `seed_real_users.py` (265).

**Problema:** probablemente hay duplicación. No queda claro cuál usar. Algunos pueden estar desactualizados contra el schema actual.

**Fix:** consolidar en `seed.py` con flags (`--minimal`, `--demo`, `--real-users`, `--azure-schema-init`). Borrar los demás. En el RUNBOOK, un solo comando para setup.

**Severidad:** Media.

### 2.3 Scripts ad-hoc en la raíz del backend

**Archivos:** `backend/add_route_form_table.py`, `backend/add_route_formid.py`, `backend/run.py` (este último puede ser el entrypoint).

**Problema:** los dos `add_*` son claramente migraciones manuales. No tienen fecha, número, ni mecanismo de rollback. Si son de una migración ya aplicada, es código muerto; si no, alguien puede dudar al verlos.

**Fix:** borrarlos si ya se aplicaron; o moverlos a alembic si aún no.

**Severidad:** Media.

### 2.4 Routers gigantes

**Archivos/líneas:**
- `reports.py` (973 LOC)
- `visits.py` (581 LOC)
- `routes.py` (532 LOC)
- `route_generator.py` (402 LOC)
- `users.py` (395 LOC)

**Problema:** cuando un módulo llega a 500+ líneas, la probabilidad de que conviva código con distintos estándares de seguridad y validación es alta. Ejemplo: `reports.py` tiene endpoints sin `current_user` + endpoints con filtro, y es difícil ver todos de un vistazo.

**Fix:** separar por subdominio. `reports.py` → `reports/summary.py`, `reports/rankings.py`, `reports/coverage.py`. Cada uno con el mismo router prefix.

**Severidad:** Media (no es bug, es mantenibilidad).

### 2.5 N+1 queries en list endpoints

**Archivos:**
- `routes.py:39–64` — `_route_to_response(r, db)` consulta User y Channel por cada ruta.
- `pdvs.py:34–89` — `_pdv_to_response` consulta Channel, SubChannel y PdvContacts por cada PDV.
- Varios endpoints de reports listan visits y para cada una hacen sub-queries.

**Problema:** listar 100 rutas = 100+ queries. En prod con Azure SQL (latencia ~20ms/query), 100 queries = 2 segundos mínimo.

**Fix:** SQLAlchemy `joinedload`/`selectinload` para cargar relaciones en 1 query. O bulk-fetch con dict mapping.

Ejemplo en `routes.py`:
```py
routes = db.query(RouteModel).options(
    joinedload(RouteModel.assignedUser),
    joinedload(RouteModel.channel),
).all()
```

**Severidad:** Media (perf; se nota cuando hay datos).

### 2.6 `setattr` genérico en PATCH handlers

**Archivos múltiples:** `pdvs.py:215`, `forms.py:95`, `notifications.py:59`, `visit_actions.py:41`, `market_news.py:44`, `mandatory_activities.py:83`, `incidents.py:59`.

**Patrón:**
```py
for k, v in data.model_dump(exclude_unset=True).items():
    setattr(obj, k, v)
```

**Problema:** acepta cualquier campo que el schema Pydantic tenga definido. Si mañana alguien agrega un campo al schema que no debería ser editable desde afuera (p. ej. `CreatedByUserId`, `IsActive` en un PDV), queda expuesto sin darse cuenta.

**Fix:** whitelist explícita por endpoint:
```py
EDITABLE = {"Name", "Address", "ChannelId"}
for k, v in data.model_dump(exclude_unset=True).items():
    if k in EDITABLE:
        setattr(obj, k, v)
```

**Severidad:** Media.

### 2.7 Tests casi inexistentes

**Archivos:** `tests/test_crud.py` (110 líneas), `tests/test_health.py`, `tests/conftest.py`.

**Problema:** con ~10k LOC de backend y ~110 LOC de tests, cobertura efectiva está muy por debajo del 10%. No hay tests de autorización (¿el endpoint devuelve 403 al rol equivocado?). Una refactorización rompe cosas silenciosamente.

**Fix (plan):**
1. Crear `tests/test_auth.py` con matriz rol × endpoint × resultado esperado (403/200).
2. `tests/test_visits.py`: ownership checks, state transitions.
3. `tests/test_reports.py`: filtro por zona.
4. CI con GitHub Actions corriendo pytest en cada PR.

**Severidad:** Alta a largo plazo (ausencia de tests habilita regresiones).

### 2.8 Sin CI/CD en repo

No existe `.github/workflows/` ni `.gitlab-ci.yml` ni nada similar. Toda validación se hace a mano.

**Fix:** pipeline básico:
```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  backend:
    - pip install -r requirements.txt
    - pytest
    - mypy app/
    - ruff check app/
```

**Severidad:** Alta a plan.

### 2.9 Tipos Pydantic con campos "sistema" como opcionales del request

**Schemas afectados:** `IncidentCreate`, `NotificationCreate`, otros.

**Problema:** `CreatedBy`, `CreatedByUserId`, `Status`, `CreatedAt` aparecen como campos de los `*Create` schemas. Deberían ser:
- **Excluidos** del schema de entrada.
- **Poblados internamente** en el handler a partir de `current_user` y `datetime.now()`.

**Fix:** separar `IncidentCreateInput` (lo que llega del cliente) y `IncidentCreateData` (lo que se pasa al ORM). Best practice: nunca exponer campos sistema en el input.

**Severidad:** Media.

### 2.10 Falta de transacciones explícitas en operaciones multi-paso

**Archivos:** `visits.py:create_visit` (crea visita + dispara `_create_mandatory_actions` + `_carry_over_backlog`), `forms.py`, `routes.py`.

**Problema:** si uno de los pasos falla, los anteriores ya están committeados. La DB queda en estado parcial.

**Fix:**
```py
try:
    v = VisitModel(...)
    db.add(v)
    db.flush()
    _create_mandatory_actions(...)
    _carry_over_backlog(...)
    db.commit()
except Exception:
    db.rollback()
    raise
```

**Severidad:** Media.

### 2.11 Paginación sin tope

**Varios routers:** `list_*` aceptan `limit: int = 100` pero sin `min/max`. Cliente puede pedir `limit=100000`.

**Fix:** `limit: int = Query(100, ge=1, le=500)`.

**Severidad:** Baja.

### 2.12 No hay `mypy` ni `ruff`/`black` configurados

No vi `pyproject.toml` ni `.ruff.toml` ni similar. Código sin lint/format automático.

**Fix:** `pyproject.toml` con `ruff`, `black`, `mypy` strict, y pre-commit hooks.

**Severidad:** Baja.

---

## 3. Bugs encontrados incidentalmente

### 3.1 `hash_password` sin límite de longitud

`routers/users.py:16`:
```py
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
```

**Problema:** bcrypt trunca a 72 bytes silenciosamente. Dos passwords que difieren después del byte 72 producen el mismo hash. Si un admin setea un password de 100 caracteres, los últimos 28 son ignorados.

**Fix:** `if len(password.encode()) > 72: raise HTTPException(400, "Contraseña demasiado larga (máx 72 bytes)")`.

**Severidad:** Baja.

### 3.2 `change_password` permite el mismo password que el actual

`main.py:197–217` — valida que el actual coincide, y que el nuevo tiene ≥8 caracteres. NO valida que el nuevo sea distinto del actual.

**Fix:** comparar hashes nuevo y viejo antes de aceptar.

**Severidad:** Baja.

### 3.3 `IncidentCreate.CreatedBy` es libre

Ya flaggeado en 1.4 pero merece finding propio: un atacante puede crear incidencias en nombre de otro usuario.

**Severidad:** Alta.

### 3.4 `VisitCheck` sin validar que Lat y Lon van juntos

`visits.py:518–524` (approx): se valida `-90 ≤ Lat ≤ 90` y `-180 ≤ Lon ≤ 180` por separado, pero no que ambos estén presentes o ausentes juntos.

**Severidad:** Baja.

### 3.5 Visit `create` permite crear directamente `COMPLETED`

`visits.py:create_visit` valida que `Status` esté en `_VALID_STATUSES` pero el diccionario `_TRANSITIONS` solo se chequea en `update_visit`. Alguien puede crear una visita en `COMPLETED` directamente.

**Fix:** en `create_visit`, restringir `Status` inicial a `{OPEN, IN_PROGRESS}` (o None → default OPEN).

**Severidad:** Media (afecta integridad de datos, no seguridad directa).

### 3.6 `delete_user` sin warning de cascada

`users.py:258–264`: borra al usuario sin contar subordinados, visitas abiertas, rutas asignadas. Dependiendo de las foreign keys, puede orphanar o fallar.

**Severidad:** Media (mencionado en el informe admin del frontend, confirmado acá).

### 3.7 `require_role` calcula `min_level` con `default=0`

`auth.py:169`: `min_level = min((_role_level(r) for r in allowed), default=0)`. Si `allowed_roles` está vacío, `min_level=0` y TODOS pasan (level 0 no es de ningún rol, pero `_role_level("foo")` también da 0). Es un edge case improbable pero demuestra que el default silencioso es peligroso.

**Fix:** si no hay roles listados, levantar error en la factory.

**Severidad:** Baja.

---

## 4. Observaciones positivas

- **Núcleo de auth sólido**: bcrypt con salt random, JWT con `type` distinto para access/refresh, refresh token NO incluye el rol (el rol se lee de DB en cada request), `access` validado con `type=="access"` (`auth.py:109–113`).
- **`require_role` con jerarquía** bien pensada como concepto (solo que el default debería ser `strict=True`).
- **CRUD de usuarios bien gateado** con `require_role("admin")` — cierra la preocupación de escalada del informe frontend.
- **Pydantic validators** usados correctamente en email, password, coordenadas, horarios (`pdv.py`, `user.py`).
- **`_check_visit_ownership`** como helper limpio (`visits.py:33–43`). Pattern a seguir para el resto.
- **`get_visible_user_ids`** en `hierarchy.py` es un buen helper — solo falta usarlo en reports y list endpoints.
- **Storage abstracto** con fallback local para dev.
- **Request ID middleware** para tracing.
- **Integración Sentry** y `observability.py` ya pensada para producción.
- **Lazy import de Azure** en storage (permite dev sin la SDK).
- **Schemas separados** para Create/Update/Read (patrón correcto), aunque con ruido (campos "sistema" en Create).
- **Login no leak de existencia**: mismo error 401 "Credenciales inválidas" para email inexistente o password incorrecto.
- **Ciclos en hierarchy chequeados** al editar `ManagerUserId` (`users.py:228–242`).

---

## 5. Tabla consolidada

| # | Hallazgo | Archivo/línea | Sev. | Tipo |
|---|---|---|---|---|
| 1.1 | CORS abierto con credentials | `main.py:24–31` | Crítica | Seguridad |
| 1.2 | `require_role("vendedor")` = todos | `routes.py:212,236`, `forms.py:50,81`, `route_generator.py:306` | Alta | Seguridad |
| 1.3 | `GET /files/{id}` sin auth | `files.py:227–243` | Crítica | Seguridad |
| 1.3 | `GET /files/photos/visit/{id}` sin ownership | `files.py:168–185` | Crítica | Seguridad |
| 1.3 | `GET /visits/{id}/answers` sin auth | `visits.py:358–365` | Crítica | Seguridad |
| 1.3 | `GET /visits` sin filtro | `visits.py:46–65` | Alta | Seguridad |
| 1.3 | `/reports/*` sin filtro zona/rol | `reports.py` entero | Alta | Seguridad |
| 1.3 | `GET /users/{id}/stats/monthly` sin auth | `users.py:130` | Media | Seguridad |
| 1.3 | `incidents` CRUD sin auth | `incidents.py` entero | Alta | Seguridad |
| 1.3 | `notifications` mutations sin auth | `notifications.py` | Alta | Seguridad |
| 1.3 | `pdv_notes`, `visit_actions`, `market_news` sin auth | varios | Media–Alta | Seguridad |
| 1.4 | Mass assignment `data: dict` | `visits.py:494,559`, `mandatory_activities.py:48,73`, `users.py:279` | Alta | Seguridad |
| 1.4 | `IncidentCreate.CreatedBy` libre | `incidents.py:38–51` | Alta | Seguridad |
| 1.5 | JWT secret default en código | `config.py:19` | Alta | Seguridad |
| 1.6 | Access token 8h | `config.py:21` | Media | Seguridad |
| 1.7 | Sin rate limiting | global | Media | Seguridad |
| 1.8 | No valida magic bytes de archivos | `files.py:116`, `users.py:326` | Media | Seguridad |
| 1.9 | SAS TTL 6h | `config.py:44` | Baja | Seguridad |
| 2.1 | Dos sistemas de migraciones | `alembic/` + `migrations/` + root scripts | Alta | Arquitectura |
| 2.2 | 4 seed scripts redundantes | `seed_*.py` | Media | Arquitectura |
| 2.3 | Scripts ad-hoc en raíz | `backend/add_route_*.py` | Media | Arquitectura |
| 2.4 | Routers gigantes | `reports.py`, `visits.py`, `routes.py` | Media | Arquitectura |
| 2.5 | N+1 queries | `routes.py:39–64`, `pdvs.py:34–89` | Media | Perf |
| 2.6 | `setattr` genérico en PATCH | 7 archivos | Media | Seguridad/Quality |
| 2.7 | Tests casi inexistentes | `tests/` (2 archivos) | Alta | Quality |
| 2.8 | Sin CI/CD | — | Alta | Ops |
| 2.9 | Campos "sistema" en *Create schemas | varios | Media | Quality |
| 2.10 | Sin transacciones explícitas | `visits.py`, `forms.py`, `routes.py` | Media | Quality |
| 2.11 | `limit` sin tope | varios list endpoints | Baja | Quality |
| 2.12 | Sin lint/format configurado | — | Baja | Quality |
| 3.1 | bcrypt trunca 72 bytes silenciosamente | `users.py:16` | Baja | Bug |
| 3.2 | `change_password` no valida new != old | `main.py:197` | Baja | Bug |
| 3.4 | VisitCheck Lat/Lon inconsistentes | `visits.py:518` | Baja | Bug |
| 3.5 | `create_visit` permite Status=COMPLETED | `visits.py:114` | Media | Bug |
| 3.6 | `delete_user` sin warning de cascada | `users.py:258–264` | Media | Bug |
| 3.7 | `require_role` con list vacía pasa todo | `auth.py:169` | Baja | Bug |

---

## 6. Plan de ataque sugerido

**Tanda 0 — hotfix en producción (máxima prioridad, 1 día):**

1. **1.1 CORS**: cerrar a dominio explícito. Si no está seteado, que la app no levante.
2. **1.5 JWT secret**: fallar al startup si el default está en producción (detectar por env `SENTRY_ENVIRONMENT=production` u otra señal).
3. **1.3 Auth checks** en los más críticos:
   - `GET /files/{id}` → validar ownership o admin.
   - `GET /files/photos/visit/{id}` → `_check_visit_ownership`.
   - `GET /visits/{id}/answers` → idem.
   - `GET /visits`, `GET /visits/{id}` → filtrar o exigir ownership.
4. **1.4 `create_incident`**: ignorar `data.CreatedBy`, usar `current_user.UserId`.

Mientras se prepara el hotfix, **monitorear Sentry** si los endpoints están siendo llamados con patrones sospechosos (muchos 404 en IDs consecutivos = enumeración).

**Tanda 1 — una semana:**

5. **1.2 Fix de `require_role`**: o cambiar los gates a roles correctos (territory_manager / admin), o cambiar default a `strict=True`. Lo primero es más seguro en el corto; lo segundo más sostenible.
6. **1.3 Resto de endpoints sin auth**: `incidents`, `notifications`, `pdv_notes`, `visit_actions`, `market_news`. Usar `require_role` o `_check_visit_ownership`/helper equivalente.
7. **1.3 Reports**: aplicar `get_visible_user_ids` en `summary`, `vendor-ranking`, `channel-coverage`, `gps-alerts`, etc.
8. **1.4 Schemas** para los 5 endpoints con `data: dict`. Script que grep `data: dict` y falle en CI si aparece uno nuevo.
9. **1.6 Access token** bajar a 15 min.
10. **3.3 `create_incident`** y similares: campos sistema no aceptados del body.
11. **3.5 `create_visit`**: restringir Status inicial.
12. **3.6 `delete_user`**: pre-check de cascada.

**Tanda 2 — sprint completo:**

13. **2.1 Migraciones**: consolidar en Alembic. Eliminar `migrations/` y scripts ad-hoc.
14. **2.2 Seed scripts**: consolidar en `seed.py` con flags.
15. **2.7 Tests**: matriz rol × endpoint × resultado. Al menos 60% cobertura en `routers/`.
16. **2.8 CI/CD**: GitHub Actions con pytest + ruff + mypy.
17. **2.5 N+1**: joinedload en los listados grandes.
18. **2.6 `setattr` whitelist**: refactorizar PATCH handlers.
19. **1.7 Rate limiting** en login y endpoints caros.
20. **1.8 Validar magic bytes** de archivos subidos con Pillow.

**Tanda 3 — a plan:**

21. **2.4 Partir routers gigantes** por subdominio.
22. **2.10 Transacciones** con context manager.
23. **2.11 Límite max en `limit`**.
24. **2.12 Lint/format** con pyproject.toml + pre-commit.
25. **1.6 Revocación explícita** con Redis si se necesita.

---

## 7. Referencias cruzadas

- **Frontend — admin**: la sospecha de "regional_manager escala a admin" (`UserManagement.tsx:160`) **está cubierta por backend** (1.2 no aplica a `/users/*`). La sospecha de "reports sin filtro de zona" (1.6 admin) **está confirmada por backend** (1.3 acá).
- **Frontend — TM mobile**: `confirm()` destructivos y `window.location.reload()` del `/sync` mentiroso no son backend issues; pero los endpoints que ese `/sync` debería llamar (para contar operaciones pendientes reales) ya existen en `lib/offline/queue.ts` frontend — no requiere backend adicional.
- **Frontend — planta**: el módulo `/plant` está 100% mockeado en frontend. Si se avanza a backend real, los endpoints a construir (`/plant/orders/today`, `/plant/supplies`, `/plant/alerts`) deben seguir los mismos principios de auth que se corrijan acá.
- **Frontend — ux/journey**: el bug crítico `visit.VisitId` offline no es backend. Pero el endpoint `POST /visits/{id}/answers` (`visits.py:368`) ya tiene ownership y está bien; solo falta que el frontend lo use correctamente.

---

## 8. Qué NO está en este informe

- **Modelo de datos y esquema SQL en detalle** (foreign keys, indices, constraints). Un DBA debería mirar `app/models/*` + `alembic/versions/0001_baseline.py`. Especialmente índices faltantes en columnas filtradas (`VisitModel.UserId`, `VisitModel.OpenedAt`, `VisitModel.PdvId`) — no los revisé.
- **Performance real** con datos de producción. Los N+1 flagueados son análisis estático; el impacto real depende del tamaño de tablas.
- **`route_generator.py`** en profundidad. Es un módulo con lógica de optimización que merece review propio (TSP, clustering, métricas, DoS surface).
- **Observability / Sentry config** — solo verifiqué que estuviera integrado.
- **Deploy infrastructure** — hay `Dockerfile`, `DEPLOY.md`, `RUNBOOK.md` pero no los revisé a fondo.
- **Secrets management** — si se usa KeyVault, env vars, `.env` en prod. Solo vi `.env.example`.

Cualquiera de esos son candidatos a informe separado si te interesa.

---

*Revisión generada con lectura estática y verificación archivo/línea en los archivos críticos. Los hallazgos de seguridad de severidad "Crítica" y "Alta" conviene validarlos contra un pentest real; esto es suficiente para un plan de hardening pero no reemplaza audit profesional.*
