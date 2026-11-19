"""Guardas compartidas por los scripts de cadenas del 2026-11-19 (ddl_chains, migrate_chains,
rollback_chains): a qué base apuntan, que el entorno no sea ambiguo, confirmación tipeada y
LOCK_TIMEOUT. No ejecuta nada por sí solo.

Resolución de la base = la de la app (app.config.settings.resolved_database_url), la MISMA
para los tres scripts:
    DATABASE_URL  >  USE_SQLITE=true  >  DATABASE_USER+DATABASE_PASSWORD (Azure SQL)  >  SQLite local
Como esa precedencia es fácil de leer mal ("tengo las credenciales de prod en .env pero
exporté USE_SQLITE para probar…"), si hay más de una señal a la vez el script NO sigue:
hay que dejar una sola.
"""
from __future__ import annotations

import sys

LOCK_TIMEOUT_MS = 15000


def env_problems(s) -> list[str]:
    """Combinaciones ambiguas de variables de selección de base. [] = ok."""
    problems = []
    has_user, has_pwd = bool(s.database_user), bool(s.database_password)
    if has_user != has_pwd:
        problems.append("DATABASE_USER y DATABASE_PASSWORD: está definida una sola de las dos")
    if s.use_sqlite and (has_user or has_pwd):
        problems.append("USE_SQLITE=true junto con DATABASE_USER/DATABASE_PASSWORD (¿SQLite o Azure SQL?)")
    if s.database_url and s.use_sqlite and not str(s.database_url).startswith("sqlite"):
        problems.append("DATABASE_URL (no SQLite) junto con USE_SQLITE=true")
    if s.database_url and (has_user or has_pwd):
        problems.append("DATABASE_URL junto con DATABASE_USER/DATABASE_PASSWORD (¿cuál de las dos bases?)")
    return problems


def describe_target(s) -> dict:
    """{kind: 'mssql'|'sqlite'|…, server, database, label} de la base a la que se va a pegar."""
    from sqlalchemy.engine import make_url
    url = make_url(s.resolved_database_url)
    kind = url.get_backend_name()
    if kind == "sqlite":
        server, database = "(archivo local)", url.database or ":memory:"
    else:
        server, database = url.host or "?", url.database or "?"
    return {"kind": kind, "server": server, "database": database,
            "label": f"{kind} · servidor {server} · base {database}"}


def resolve_target_or_exit(mode: str) -> dict:
    """Imprime a qué base se va a pegar y en qué modo; corta si el entorno es ambiguo."""
    from app.config import settings
    problems = env_problems(settings)
    if problems:
        print("ABORTO: las variables de selección de base son inconsistentes (env o backend/.env):")
        for p in problems:
            print(f"   - {p}")
        print("Dejá UNA sola señal. Ej. ensayo local: DATABASE_URL=sqlite:///… DATABASE_USER= DATABASE_PASSWORD=")
        sys.exit(2)
    target = describe_target(settings)
    print(f"BASE DESTINO: {target['label']}")
    print(f"MODO: {mode}")
    return target


def confirm_or_exit(target: dict, yes: bool, what: str) -> None:
    """Confirmación tipeada antes de escribir. --yes la saltea (uso no interactivo)."""
    if yes:
        print("--yes: confirmación interactiva salteada.")
        return
    if not sys.stdin.isatty():
        print("ABORTO: no hay terminal para confirmar. Corré de forma interactiva o agregá --yes.")
        sys.exit(2)
    expected = target["database"].rsplit("/", 1)[-1]
    print(f"\nVas a {what} en: {target['label']}")
    typed = input(f"Para confirmar escribí el nombre de la base ({expected}): ").strip()
    if typed != expected:
        print("ABORTO: no coincide. No se escribió nada.")
        sys.exit(2)


def set_lock_timeout(executor, ms: int = LOCK_TIMEOUT_MS) -> bool:
    """SET LOCK_TIMEOUT (solo SQL Server): si otra sesión tiene tomada la tabla, el script
    falla a los `ms` en vez de quedarse colgado bloqueando a la app. executor = Session o
    Connection de SQLAlchemy. Devuelve True si se aplicó."""
    from sqlalchemy import text
    bind = executor.get_bind() if hasattr(executor, "get_bind") else executor
    if bind.dialect.name != "mssql":
        return False
    executor.execute(text(f"SET LOCK_TIMEOUT {int(ms)}"))
    return True
