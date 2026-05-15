#!/usr/bin/env python3
"""
Blanquea las contraseñas de usuarios específicos a Espert2026!
y activa MustChangePassword=True.

Uso:
    cd backend
    source venv/bin/activate
    python reset_passwords.py              # contra SQLite local
    python reset_passwords.py --prod       # contra la DB de producción (necesita DATABASE_URL)
"""
from __future__ import annotations

import sys
from pathlib import Path

import bcrypt

# Agregar backend al path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.database import SessionLocal
from app.models.user import User

DEFAULT_PASSWORD = "Espert2026!"

EMAILS_TO_RESET = [
    "sebastian.morales",
    "juampi@espert.com.ar",
]


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def main():
    db = SessionLocal()
    pw_hash = hash_password(DEFAULT_PASSWORD)

    for email in EMAILS_TO_RESET:
        user = db.query(User).filter(User.Email == email).first()
        if not user:
            print(f"  ✗ Usuario no encontrado: {email}")
            continue
        user.PasswordHash = pw_hash
        user.MustChangePassword = True
        print(f"  ✓ {user.DisplayName} ({email}) → contraseña reseteada a {DEFAULT_PASSWORD}")

    db.commit()
    db.close()
    print("\nListo.")


if __name__ == "__main__":
    main()
