"""
Migración: crea tabla RouteForm y migra FormId existente desde Route.
Ejecutar desde backend: python add_route_form_table.py
"""
from sqlalchemy import create_engine, text
from app.config import settings

def main():
    url = settings.resolved_database_url
    engine = create_engine(url)
    is_sqlite = "sqlite" in url

    with engine.connect() as conn:
        # Crear tabla RouteForm si no existe
        if is_sqlite:
            create_sql = """
                CREATE TABLE IF NOT EXISTS RouteForm (
                    RouteId INTEGER NOT NULL,
                    FormId INTEGER NOT NULL,
                    SortOrder INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (RouteId, FormId),
                    FOREIGN KEY (RouteId) REFERENCES Route(RouteId),
                    FOREIGN KEY (FormId) REFERENCES Form(FormId)
                )
            """
        else:
            create_sql = """
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RouteForm')
                CREATE TABLE RouteForm (
                    RouteId INT NOT NULL,
                    FormId INT NOT NULL,
                    SortOrder INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (RouteId, FormId),
                    FOREIGN KEY (RouteId) REFERENCES [Route](RouteId),
                    FOREIGN KEY (FormId) REFERENCES [Form](FormId)
                )
            """
        try:
            conn.execute(text(create_sql))
            conn.commit()
            print("Tabla RouteForm creada/verificada")
        except Exception as e:
            if "already exists" not in str(e).lower() and "duplicate" not in str(e).lower():
                raise

        # Migrar Route.FormId a RouteForm
        route_table = "Route" if is_sqlite else "[Route]"
        try:
            conn.execute(text(f"""
                INSERT INTO RouteForm (RouteId, FormId, SortOrder)
                SELECT r.RouteId, r.FormId, 0
                FROM {route_table} r
                WHERE r.FormId IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM RouteForm rf WHERE rf.RouteId = r.RouteId AND rf.FormId = r.FormId)
            """))
            conn.commit()
            print("FormIds migrados a RouteForm")
        except Exception as e:
            print(f"Migración FormId: {e}")

if __name__ == "__main__":
    main()
