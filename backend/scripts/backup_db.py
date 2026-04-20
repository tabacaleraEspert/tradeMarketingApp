#!/usr/bin/env python3
"""
Backup de la DB de Trade Marketing.

- **SQLite local** (`USE_SQLITE=true`): copia atómica del archivo `.db` a `./backups/`.
  Usa el `BACKUP DATABASE TO ...` interno de SQLite para garantizar consistencia
  incluso con conexiones abiertas. También copia el directorio `uploads/` (fotos
  locales del fallback de storage) para que el backup sea completo.

- **Azure SQL** (cuando hay credenciales): no toca la DB. Imprime un recordatorio
  de que Azure SQL tiene Point-In-Time Restore (PITR) automático con retención
  de 7 días en el tier Basic/S0/S1, y muestra el comando `az sql db export` para
  generar un .bacpac manual a Blob Storage si querés un snapshot adicional.

Uso:

    cd backend
    source .venv/bin/activate
    USE_SQLITE=true python scripts/backup_db.py

    # Limpiar backups viejos (mantiene los últimos 14 días)
    python scripts/backup_db.py --prune-days 14

Cron para correr diario a las 03:00:

    0 3 * * * cd /path/to/backend && /path/to/.venv/bin/python scripts/backup_db.py --prune-days 14 >> /var/log/espert-backup.log 2>&1
"""
from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

# Resolver el path al backend para poder importar la config
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))

from app.config import settings  # noqa: E402


BACKUP_DIR = _BACKEND_DIR / "backups"


def _timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def backup_sqlite(db_path: Path) -> Path:
    """Copia consistente de un archivo SQLite usando el API nativo de backup."""
    if not db_path.exists():
        raise FileNotFoundError(f"DB SQLite no encontrada: {db_path}")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"{db_path.stem}-{_timestamp()}.db"

    # Usamos la API .backup() de sqlite3 que es atómica y segura con escrituras concurrentes
    src = sqlite3.connect(str(db_path))
    dst = sqlite3.connect(str(target))
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close()
        src.close()

    size_mb = target.stat().st_size / (1024 * 1024)
    print(f"  ✓ {target.name} ({size_mb:.2f} MB)")
    return target


def backup_uploads_dir() -> Path | None:
    """Si existe ./uploads (modo storage local), lo copia al backup."""
    uploads = _BACKEND_DIR / "uploads"
    if not uploads.exists() or not any(uploads.iterdir()):
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"uploads-{_timestamp()}.tar.gz"
    # tar.gz para preservar estructura y comprimir
    shutil.make_archive(str(target.with_suffix("").with_suffix("")), "gztar", str(uploads))
    print(f"  ✓ {target.name}")
    return target


def prune_old_backups(days: int) -> int:
    """Elimina backups (.db y .tar.gz) más viejos que `days` días."""
    if not BACKUP_DIR.exists():
        return 0
    cutoff = time.time() - days * 24 * 60 * 60
    removed = 0
    for f in BACKUP_DIR.iterdir():
        if not f.is_file():
            continue
        if f.suffix not in (".db", ".gz"):
            continue
        if f.stat().st_mtime < cutoff:
            f.unlink()
            removed += 1
    return removed


def show_azure_sql_runbook() -> None:
    print()
    print("=" * 70)
    print("Backup en Azure SQL")
    print("=" * 70)
    print()
    print("La DB en Azure SQL ya tiene Point-In-Time Restore (PITR) automático")
    print("con retención de 7 días por default (hasta 35 días configurables).")
    print()
    print("Para hacer un EXPORT manual a un .bacpac en Blob Storage:")
    print()
    print("  az sql db export \\")
    print(f"    --resource-group <RG> \\")
    print(f"    --server {settings.database_server.split('.')[0]} \\")
    print(f"    --name {settings.database_name} \\")
    print(f"    --admin-user <ADMIN_USER> \\")
    print(f"    --admin-password <ADMIN_PASSWORD> \\")
    print(f"    --storage-key <STORAGE_KEY> \\")
    print(f"    --storage-key-type StorageAccessKey \\")
    print(f"    --storage-uri https://<storage-account>.blob.core.windows.net/backups/{settings.database_name}-{_timestamp()}.bacpac")
    print()
    print("Para RESTORE a un punto en el tiempo (PITR):")
    print()
    print("  az sql db restore \\")
    print(f"    --resource-group <RG> \\")
    print(f"    --server {settings.database_server.split('.')[0]} \\")
    print(f"    --name {settings.database_name} \\")
    print(f"    --dest-name {settings.database_name}-restored \\")
    print(f"    --time '2026-04-15T14:30:00'")
    print()
    print("Ver RUNBOOK.md para el procedimiento completo de DR.")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Backup de la DB Trade Marketing")
    parser.add_argument(
        "--prune-days",
        type=int,
        default=0,
        help="Si > 0, elimina backups locales más viejos que N días",
    )
    args = parser.parse_args()

    print("=" * 70)
    print(f"Backup Trade Marketing — {datetime.now().isoformat(timespec='seconds')}")
    print("=" * 70)

    db_url = settings.resolved_database_url
    is_sqlite = "sqlite" in db_url

    if is_sqlite:
        # Extraer path del URL "sqlite:///./trade_marketing.db"
        path_part = db_url.split("///")[-1]
        db_path = (_BACKEND_DIR / path_part) if not Path(path_part).is_absolute() else Path(path_part)
        print(f"→ Backup SQLite local: {db_path}")
        try:
            backup_sqlite(db_path)
        except Exception as e:
            print(f"  ✗ Falló el backup de la DB: {e}")
            sys.exit(1)

        print("→ Backup uploads (fotos locales)")
        try:
            up = backup_uploads_dir()
            if up is None:
                print("  · Sin archivos en ./uploads, salteado")
        except Exception as e:
            print(f"  ✗ Falló el backup de uploads: {e}")
    else:
        print("→ DB es Azure SQL — backup automático via PITR")
        show_azure_sql_runbook()

    if args.prune_days > 0:
        print(f"→ Limpiando backups locales más viejos que {args.prune_days} días")
        removed = prune_old_backups(args.prune_days)
        print(f"  · {removed} archivo(s) eliminado(s)")

    print()
    print("✓ Backup completado")


if __name__ == "__main__":
    main()
