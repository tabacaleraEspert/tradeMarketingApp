"""
Script para agregar la columna FormId a la tabla Route.
Ejecutar desde la carpeta backend: python add_route_formid.py
"""
from sqlalchemy import create_engine, text
from app.config import settings

def main():
    url = settings.resolved_database_url
    engine = create_engine(url)
    with engine.connect() as conn:
        try:
            if "sqlite" in url:
                conn.execute(text("ALTER TABLE Route ADD COLUMN FormId INTEGER"))
            else:
                conn.execute(text("ALTER TABLE [Route] ADD FormId INT NULL"))
            conn.commit()
            print("Columna FormId agregada a Route")
        except Exception as e:
            err = str(e).lower()
            if "duplicate" in err or "already exists" in err:
                print("La columna FormId ya existe")
            else:
                raise

if __name__ == "__main__":
    main()
