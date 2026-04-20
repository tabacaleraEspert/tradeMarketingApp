#!/usr/bin/env python3
"""
Carga los usuarios REALES de Espert (Territory Managers + Ejecutivos + Admins).

Idempotente: podés correrlo cuantas veces quieras. Si el email ya existe,
actualiza nombre/rol/manager/IsActive sin pisar la contraseña (a menos que
le pases --reset-passwords).

Uso:
    cd backend
    source venv/bin/activate
    USE_SQLITE=true python seed_real_users.py
    USE_SQLITE=true python seed_real_users.py --reset-passwords   # fuerza la pass por defecto

Política:
- Email: nombre.apellido@espert.com.ar (lowercase, sin tildes, sin espacios).
  Para los admins sin apellido, sólo nombre@espert.com.ar.
- Password inicial: Espert2026!
- MustChangePassword=True → cada uno debe cambiarla al primer login.

Para corregir un usuario después de creado, lo más fácil es editar este archivo
y volver a correrlo (los UserId se mantienen porque el lookup es por email).
"""
from __future__ import annotations

import argparse
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import bcrypt
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import User as UserModel, Role as RoleModel, UserRole as UserRoleModel


DEFAULT_PASSWORD = "Espert2026!"
EMAIL_DOMAIN = "espert.com.ar"


# ============================================================================
# Datos
# ============================================================================
# Cada tupla: (display_name, role, area, manager_email, custom_email_local)
#
# - display_name: nombre completo a mostrar
# - role: admin / regional_manager / territory_manager / ejecutivo / vendedor
# - area: la región/zona que cubre (informativo, no se guarda en DB)
# - manager_email: email del manager directo (None = top-level)
# - custom_email_local: si querés un email distinto al auto-generado
USERS: list[dict] = [
    # ───────── ADMINS ─────────
    # Juampi como root del árbol cosmético entre admins (los 5 ven todo igual)
    {"name": "Juampi",            "role": "admin",        "area": "PAIS",       "manager": None,                     "email_local": "juampi"},
    {"name": "Flama",             "role": "admin",        "area": "PAIS",       "manager": "juampi@espert.com.ar",   "email_local": "flama"},
    {"name": "Diego Boniotti",    "role": "admin",        "area": "PAIS",       "manager": "juampi@espert.com.ar",   "email_local": None},
    {"name": "Esteban",           "role": "admin",        "area": "PAIS",       "manager": "diego.boniotti@espert.com.ar", "email_local": "esteban"},
    {"name": "Ezequiel",          "role": "admin",        "area": "PAIS",       "manager": "diego.boniotti@espert.com.ar", "email_local": "ezequiel"},
    {"name": "Rodrigo Salinas",   "role": "admin",        "area": "PAIS",       "manager": "diego.boniotti@espert.com.ar", "email_local": None},

    # ───────── REGIONAL MANAGER ─────────
    {"name": "Martin Lescano",    "role": "regional_manager", "area": "REGION BS AS", "manager": "diego.boniotti@espert.com.ar", "email_local": None},

    # ───────── TERRITORY MANAGERS — PROVINCIAS (reportan directo a Diego) ─────────
    {"name": "Emmanuel Anzorena", "role": "territory_manager", "area": "CUYO",            "manager": "diego.boniotti@espert.com.ar", "email_local": None},
    {"name": "Amaya Duilio",      "role": "territory_manager", "area": "NOA",             "manager": "diego.boniotti@espert.com.ar", "email_local": None},
    {"name": "Andres Spagnolo",   "role": "territory_manager", "area": "NEA",             "manager": "diego.boniotti@espert.com.ar", "email_local": None},
    {"name": "Pablo Bruscoli",    "role": "territory_manager", "area": "CORDOBA",         "manager": "diego.boniotti@espert.com.ar", "email_local": None},
    {"name": "Fabrizio Faini",    "role": "territory_manager", "area": "LITORAL",         "manager": "diego.boniotti@espert.com.ar", "email_local": None},
    {"name": "Javier Martin",     "role": "territory_manager", "area": "PATAGONIA COSTA", "manager": "diego.boniotti@espert.com.ar", "email_local": None},
    {"name": "Juan San Miguel",   "role": "territory_manager", "area": "PATAGONIA ANDINA","manager": "diego.boniotti@espert.com.ar", "email_local": None},

    # ───────── TERRITORY MANAGERS — BS AS (reportan a Martin Lescano) ─────────
    {"name": "Matias Sapia",      "role": "territory_manager", "area": "BS AS NUCLEO",    "manager": "martin.lescano@espert.com.ar", "email_local": None},
    {"name": "Franco Garcia",     "role": "territory_manager", "area": "BS AS COSTA",     "manager": "martin.lescano@espert.com.ar", "email_local": None},

    # ───────── EJECUTIVOS DE CUENTA — GBA (reportan a Martin Lescano) ─────────
    {"name": "Lilian Noguera",    "role": "ejecutivo",         "area": "GBA SUR",         "manager": "martin.lescano@espert.com.ar", "email_local": None},
    {"name": "Nahuel Seoane",     "role": "ejecutivo",         "area": "GBA RIVERA SUR",  "manager": "martin.lescano@espert.com.ar", "email_local": None},
    {"name": "Juan Albornoz",     "role": "ejecutivo",         "area": "GBA OESTE",       "manager": "martin.lescano@espert.com.ar", "email_local": None},
    {"name": "Mariette Curvelo",  "role": "ejecutivo",         "area": "GBA NORTE",       "manager": "martin.lescano@espert.com.ar", "email_local": None},
]


# ============================================================================
# TM REPS — 3 por cada zona, reportando al Territory Manager o Ejecutivo
# de cuenta correspondiente. Nombre: "TM Cuyo 1", email: tmcuyo1@espert.com.ar
# ============================================================================
TM_REP_ZONES = [
    # (zone_label, email_prefix, manager_email)
    ("Cuyo",            "tmcuyo",       "emmanuel.anzorena@espert.com.ar"),
    ("NOA",             "tmnoa",        "amaya.duilio@espert.com.ar"),
    ("NEA",             "tmnea",        "andres.spagnolo@espert.com.ar"),
    ("Córdoba",         "tmcordoba",    "pablo.bruscoli@espert.com.ar"),
    ("Litoral",         "tmlitoral",    "fabrizio.faini@espert.com.ar"),
    ("Patagonia Costa", "tmpatcosta",   "javier.martin@espert.com.ar"),
    ("Patagonia Andina","tmpatandina",  "juan.san.miguel@espert.com.ar"),
    ("BS AS Núcleo",    "tmbsnucleo",   "matias.sapia@espert.com.ar"),
    ("BS AS Costa",     "tmbscosta",    "franco.garcia@espert.com.ar"),
    ("GBA Sur",         "tmgbasur",     "lilian.noguera@espert.com.ar"),
    ("GBA Rivera Sur",  "tmgbarivera",  "nahuel.seoane@espert.com.ar"),
    ("GBA Oeste",       "tmgbaoeste",   "juan.albornoz@espert.com.ar"),
    ("GBA Norte",       "tmgbanorte",   "mariette.curvelo@espert.com.ar"),
]

for _zone_label, _prefix, _mgr_email in TM_REP_ZONES:
    for _i in range(1, 4):  # 3 TM Reps por zona
        USERS.append({
            "name": f"TM {_zone_label} {_i}",
            "role": "vendedor",
            "area": _zone_label,
            "manager": _mgr_email,
            "email_local": f"{_prefix}{_i}",
        })


# ============================================================================
# Helpers
# ============================================================================
def slugify(s: str) -> str:
    """convierte 'María Pérez' → 'maria.perez'"""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return s.lower().strip().replace(" ", ".")


def email_for(user: dict) -> str:
    if user["email_local"]:
        local = user["email_local"]
    else:
        local = slugify(user["name"])
    return f"{local}@{EMAIL_DOMAIN}"


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def get_or_create_role(db: Session, name: str) -> RoleModel:
    r = db.query(RoleModel).filter(RoleModel.Name == name).first()
    if not r:
        r = RoleModel(Name=name)
        db.add(r)
        db.flush()
    return r


def upsert_user_role(db: Session, user_id: int, role_id: int) -> None:
    ur = db.query(UserRoleModel).filter(UserRoleModel.UserId == user_id).first()
    if ur:
        if ur.RoleId != role_id:
            ur.RoleId = role_id
    else:
        db.add(UserRoleModel(UserId=user_id, RoleId=role_id))


# ============================================================================
# Main
# ============================================================================
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--reset-passwords",
        action="store_true",
        help="Si se setea, fuerza la password por defecto en TODOS los usuarios (peligroso si ya estaban en uso).",
    )
    args = parser.parse_args()

    print("=" * 70)
    print("SEED USUARIOS REALES — Espert")
    print("=" * 70)

    db: Session = SessionLocal()
    try:
        # Pase 1 — crear/actualizar todos los users (sin manager todavía)
        roles_cache: dict[str, RoleModel] = {}
        users_by_email: dict[str, UserModel] = {}

        for spec in USERS:
            email = email_for(spec)
            role_name = spec["role"]
            display = spec["name"]

            # Cache de roles
            if role_name not in roles_cache:
                roles_cache[role_name] = get_or_create_role(db, role_name)
            role = roles_cache[role_name]

            user = db.query(UserModel).filter(UserModel.Email == email).first()
            if user:
                # Update
                user.DisplayName = display
                user.IsActive = True
                if args.reset_passwords:
                    user.PasswordHash = hash_password(DEFAULT_PASSWORD)
                    user.MustChangePassword = True
                action = "actualizado"
            else:
                # Create
                user = UserModel(
                    Email=email,
                    DisplayName=display,
                    PasswordHash=hash_password(DEFAULT_PASSWORD),
                    MustChangePassword=True,
                    IsActive=True,
                )
                db.add(user)
                db.flush()
                action = "creado"
            users_by_email[email] = user
            db.flush()

            upsert_user_role(db, user.UserId, role.RoleId)
            print(f"  ✓ [{role_name:18s}] {display:25s} <{email}> {action}")

        db.flush()

        # Pase 2 — asignar managers (ahora que todos los UserId existen)
        print()
        print("→ Asignando jerarquía (ManagerUserId)")
        for spec in USERS:
            email = email_for(spec)
            user = users_by_email[email]
            mgr_email = spec["manager"]
            if not mgr_email:
                user.ManagerUserId = None
                continue
            mgr = users_by_email.get(mgr_email)
            if not mgr:
                # Buscar en DB por si fue creado en una corrida anterior
                mgr = db.query(UserModel).filter(UserModel.Email == mgr_email).first()
            if not mgr:
                print(f"  ! Manager '{mgr_email}' no encontrado para {user.Email} — queda sin asignar")
                continue
            user.ManagerUserId = mgr.UserId

        db.commit()

        # Resumen
        print()
        print("=" * 70)
        print(f"DONE — {len(USERS)} usuarios procesados")
        print("=" * 70)
        print()
        print("Credenciales iniciales (todos):")
        print(f"  Password: {DEFAULT_PASSWORD}")
        print(f"  Cada usuario debe cambiarla al primer login (MustChangePassword=true)")
        print()
        print("Algunos emails para login rápido:")
        for s in USERS[:3]:
            print(f"  · {email_for(s):45s} ({s['role']})")
        print(f"  · martin.lescano@espert.com.ar          (regional_manager)")
        print(f"  · matias.sapia@espert.com.ar            (territory_manager)")
        print(f"  · lilian.noguera@espert.com.ar          (ejecutivo)")
        print()
        print("Tip: editá USERS[] en este archivo y volvé a correr para corregir cualquier dato.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
