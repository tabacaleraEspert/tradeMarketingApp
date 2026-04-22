from urllib.parse import quote_plus
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configuración de la aplicación. Para Azure SQL, usar variables de entorno."""
    database_url: str | None = None
    use_sqlite: bool = False

    # Azure SQL
    database_server: str = "trade-mkt-sql.database.windows.net"
    database_name: str = "trademktdb"
    database_user: str = ""
    database_password: str = ""
    database_connection_timeout: int = 60

    # --- CORS ---
    frontend_origin: str = "http://localhost:5173"

    # --- Auth / JWT ---
    # IMPORTANT: override JWT_SECRET_KEY via env var en producción
    jwt_secret_key: str = "dev-secret-CHANGEME-in-prod-please"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 8  # 8 horas
    jwt_refresh_expire_minutes: int = 60 * 24 * 7  # 7 días

    # --- Observability / Sentry ---
    # Si está vacío, no se activa Sentry. La app sigue logueando localmente.
    sentry_dsn: str = ""
    # Identificador del entorno para diferenciar errores por stage
    sentry_environment: str = "development"
    # Sample rate de errores (0.0 a 1.0). En prod usar 1.0.
    sentry_traces_sample_rate: float = 0.0  # 0 = no APM, sólo errores
    # Versión de la app (auto-completar en CI/CD via git sha o tag)
    app_release: str = "dev"

    # --- Azure Monitor / Application Insights ---
    # Connection string de App Insights (obtener de Azure Portal > App Insights > Overview)
    # Si está vacío, no se activa. App Service puede auto-inyectarlo via APPLICATIONINSIGHTS_CONNECTION_STRING.
    applicationinsights_connection_string: str = ""

    # --- Storage (Azure Blob / fallback disco local) ---
    # Si `azure_storage_connection_string` está seteado, usamos Azure Blob.
    # Si no, caemos a disco local en `./uploads/`.
    azure_storage_connection_string: str = ""
    azure_storage_container: str = "visit-photos"
    local_upload_dir: str = "./uploads"
    # URL pública base para servir archivos locales (sólo modo fallback).
    # En dev: http://localhost:8001
    public_base_url: str = "http://localhost:8001"
    # TTL en segundos para URLs firmadas de Azure (no aplica al fallback local).
    blob_sas_ttl_seconds: int = 60 * 60 * 6  # 6 horas

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        if self.use_sqlite:
            return "sqlite:///./trade_marketing.db"

        if self.database_user and self.database_password:
            user = quote_plus(self.database_user)
            pwd = quote_plus(self.database_password)
            server = self.database_server
            db = self.database_name
            # Use pymssql (no ODBC driver needed)
            return f"mssql+pymssql://{user}:{pwd}@{server}/{db}"

        return "sqlite:///./trade_marketing.db"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
