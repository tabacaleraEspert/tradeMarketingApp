# Backend Trade Marketing

API REST en Python con FastAPI y SQLAlchemy para la aplicación de Trade Marketing.

## Requisitos

- Python 3.11+
- Base de datos: SQLite (desarrollo) o Azure SQL / SQL Server (producción)

## Instalación

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Configuración

Copia `.env.example` a `.env` y configura la conexión a la base de datos:

### Azure SQL (trademarketing.database.windows.net)

```env
DATABASE_SERVER=trademarketing.database.windows.net
DATABASE_NAME=TradeMarketing
DATABASE_USER=tu_usuario
DATABASE_PASSWORD=tu_contraseña
```

**Requisitos:**
- [ODBC Driver 18 for SQL Server](https://docs.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server) instalado en el sistema
- Base de datos creada en Azure SQL
- Firewall de Azure configurado para permitir tu IP (o "Allow Azure services")

### Desarrollo local (SQLite)

Si no defines `DATABASE_USER` y `DATABASE_PASSWORD`, usa SQLite automáticamente.

## Migraciones

Si actualizas desde una versión anterior:

1. **FormId en Rutas:** `python add_route_formid.py`
2. **Tabla RouteForm (múltiples formularios por ruta):** `python add_route_form_table.py`

## Ejecución

```bash
python run.py
# o
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Documentación interactiva: http://localhost:8000/docs

## Usuario de prueba (Login)

Para crear un usuario de prueba y probar el login:

```bash
python seed_db.py
```

Credenciales:
- **Email:** admin@test.com
- **Contraseña:** Admin123!

## Endpoints CRUD

| Recurso | Base Path | Operaciones |
|---------|-----------|-------------|
| Zonas | `/zones` | GET, POST, PATCH, DELETE |
| Usuarios | `/users` | GET, POST, PATCH, DELETE |
| Roles | `/roles` | GET, POST, PATCH, DELETE |
| Distribuidores | `/distributors` | GET, POST, PATCH, DELETE |
| PDVs | `/pdvs` | GET, POST, PATCH, DELETE |
| Rutas | `/routes` | GET, POST, PATCH, DELETE |
| Rutas - PDVs | `/routes/{id}/pdvs` | GET, POST, DELETE |
| Días de ruta | `/routes/{id}/days` | GET, POST |
| Días de ruta - PDVs | `/routes/days/{id}/pdvs` | GET, POST, PATCH |
| Formularios | `/forms` | GET, POST, PATCH, DELETE |
| Preguntas | `/forms/{id}/questions` | GET, POST |
| Opciones | `/forms/questions/{id}/options` | GET, POST, PATCH, DELETE |
| Visitas | `/visits` | GET, POST, PATCH, DELETE |
| Incidencias | `/incidents` | GET, POST, PATCH, DELETE |

## Filtros de consulta

- **PDVs**: `?zone_id=1&distributor_id=2`
- **Visitas**: `?user_id=1&pdv_id=2&status=OPEN`
- **Incidencias**: `?pdv_id=1&visit_id=2&status=OPEN`
