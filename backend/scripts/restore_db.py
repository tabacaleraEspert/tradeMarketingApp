#!/usr/bin/env python3
"""
Restore de un backup local de SQLite.

Uso:

    cd backend
    source .venv/bin/activate

    # Listar backups disponibles
    USE_SQLITE=true python scripts/restore_db.py --list

    # Restaurar el más reciente
    USE_SQLITE=true python scripts/restore_db.py --latest

    # Restaurar uno específico
    USE_SQLITE=true python scripts/restore_db.py --file backups/trade_marketing-20260410-153000.db

IMPORTANTE: el restore SOBREESCRIBE la DB actual. Antes de hacerlo, este script
crea automáticamente un backup pre-restore para que puedas volver atrás.

Para Azure SQL, este script no aplica. Usá `az sql db restore` (PITR) o importá
un .bacpac. Ver RUNBOOK.md.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))

from app.config import settings  # noqa: E402

BACKUP_DIR = _BACKEND_DIR / "backups"


def list_backups() -> list[Path]:
    if not BACKUP_DIR.exists():
        return []
    return sorted(
        [p for p in BACKUP_DIR.iterdir() if p.is_file() and p.suffix == ".db"],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore SQLite local")
    parser.add_argument("--list", action="store_true", help="Lista los backups disponibles")
    parser.add_argument("--latest", action="store_true", help="Restaura el backup más reciente")
    parser.add_argument("--file", type=str, help="Path al backup a restaurar")
    parser.add_argument("--yes", action="store_true", help="No pedir confirmación")
    args = parser.parse_args()

    db_url = settings.resolved_database_url
    if "sqlite" not in db_url:
        print("✗ Este script sólo funciona con SQLite. Para Azure SQL ver RUNBOOK.md.")
        sys.exit(1)

    backups = list_backups()

    if args.list:
        if not backups:
            print("No hay backups en", BACKUP_DIR)
            return
        print(f"{len(backups)} backup(s) disponibles:")
        for b in backups:
            ts = datetime.fromtimestamp(b.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            size_mb = b.stat().st_size / (1024 * 1024)
            print(f"  · {b.name}  ({size_mb:.2f} MB)  {ts}")
        return

    # Elegir el backup
    if args.file:
        target = Path(args.file)
        if not target.is_absolute():
            target = (_BACKEND_DIR / target).resolve()
        if not target.exists():
            print(f"✗ No existe: {target}")
            sys.exit(1)
    elif args.latest:
        if not backups:
            print("✗ No hay backups disponibles")
            sys.exit(1)
        target = backups[0]
    else:
        parser.print_help()
        sys.exit(1)

    # Resolver path de la DB actual
    path_part = db_url.split("///")[-1]
    current_db = (_BACKEND_DIR / path_part) if not Path(path_part).is_absolute() else Path(path_part)

    print(f"DB actual:    {current_db}")
    print(f"Restaurar:    {target}")

    if not args.yes:
        ans = input("¿Confirmás el restore? Esto SOBREESCRIBE la DB actual [y/N]: ").strip().lower()
        if ans not in ("y", "yes", "s", "si", "sí"):
            print("Cancelado.")
            return

    # Pre-restore backup de la DB actual
    if current_db.exists():
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        pre = BACKUP_DIR / f"{current_db.stem}-prerestore-{ts}.db"
        shutil.copy2(current_db, pre)
        print(f"  ✓ Pre-restore backup: {pre.name}")

    # Restore
    shutil.copy2(target, current_db)
    print(f"  ✓ DB restaurada desde {target.name}")
    print()
    print("Reiniciá uvicorn para que tome los cambios.")


if __name__ == "__main__":
    main()
