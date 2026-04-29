#!/usr/bin/env python3
"""
Patch de producción:
  1. Renombra 'Responsable TM' → 'Rodrigo Salinas' (rodrigo.salinas)
  2. Setea password de Sebastian Morales a 'sebastian'
  3. MustChangePassword = False para ambos

Ejecutar contra prod:
    DATABASE_SERVER=... DATABASE_USER=... DATABASE_PASSWORD=... USE_SQLITE=false \
        python migrations/patch_prod_users.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import bcrypt
from app.database import SessionLocal
from app.models import User, Role, UserRole


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def main():
    db = SessionLocal()

    # 1. Rename responsable.tm → rodrigo.salinas
    u = db.query(User).filter(User.Email == "responsable.tm").first()
    if u:
        u.Email = "rodrigo.salinas"
        u.DisplayName = "Rodrigo Salinas"
        u.PasswordHash = _hash("Espert2026!")
        u.MustChangePassword = False
        print(f"  ~ Responsable TM → Rodrigo Salinas (rodrigo.salinas)")
    else:
        # Maybe already renamed or doesn't exist — create if needed
        u2 = db.query(User).filter(User.Email == "rodrigo.salinas").first()
        if not u2:
            admin_role = db.query(Role).filter(Role.Name == "admin").first()
            u2 = User(
                Email="rodrigo.salinas",
                DisplayName="Rodrigo Salinas",
                PasswordHash=_hash("Espert2026!"),
                MustChangePassword=False,
                IsActive=True,
            )
            db.add(u2)
            db.flush()
            if admin_role:
                db.add(UserRole(UserId=u2.UserId, RoleId=admin_role.RoleId))
            print(f"  + Created: Rodrigo Salinas (rodrigo.salinas) — admin")
        else:
            print(f"  - rodrigo.salinas already exists")

    # 2. Fix Sebastian password
    seba = db.query(User).filter(User.Email == "sebastian.morales").first()
    if seba:
        seba.PasswordHash = _hash("sebastian")
        seba.MustChangePassword = False
        print(f"  ~ Sebastian Morales — password set to 'sebastian'")
    else:
        print(f"  ! sebastian.morales not found")

    db.commit()
    db.close()
    print("Done.")


if __name__ == "__main__":
    main()
