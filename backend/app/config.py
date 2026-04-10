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
