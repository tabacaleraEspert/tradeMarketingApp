from urllib.parse import quote_plus
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configuración de la aplicación. Para Azure SQL, usar variables de entorno."""
    database_url: str | None = None
    use_sqlite: bool = False  # True = forzar SQLite (útil si Azure falla)

    # Azure SQL - si se definen, se construye DATABASE_URL automáticamente
    database_server: str = "trademarketing.database.windows.net"
    database_name: str = "trademarketingdb"
    database_user: str = ""
    database_password: str = ""
    database_driver: str = "ODBC Driver 18 for SQL Server"
    # Segundos para conectar (Azure detrás de firewall lento: subir a 60–120)
    database_connection_timeout: int = 60
    # Solo si hay errores de certificado TLS en entornos muy restringidos (no recomendado en prod)
    database_trust_server_certificate: bool = False

    @property
    def resolved_database_url(self) -> str:
        """URL de conexión: DATABASE_URL o construida desde variables Azure."""
        if self.database_url:
            return self.database_url
        if self.use_sqlite:
            return "sqlite:///./trade_marketing.db"

        if self.database_user and self.database_password:
            server = self.database_server
            if not server.startswith("tcp:"):
                server = f"tcp:{server},1433"
            trust = "yes" if self.database_trust_server_certificate else "no"
            timeout = max(15, self.database_connection_timeout)
            params = quote_plus(
                f"Driver={{{self.database_driver}}};"
                f"Server={server};"
                f"Database={self.database_name};"
                f"Uid={self.database_user};"
                f"Pwd={self.database_password};"
                f"Encrypt=yes;TrustServerCertificate={trust};"
                f"Connection Timeout={timeout};"
            )
            return f"mssql+pyodbc://?odbc_connect={params}"

        return "sqlite:///./trade_marketing.db"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
