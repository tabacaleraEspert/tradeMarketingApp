#!/usr/bin/env python3
"""
Script para crear datos iniciales y usuario de prueba.
Ejecutar: python seed_db.py

Usuario de prueba:
  Email: admin@test.com
  Contraseña: Admin123!
"""
import sys
from pathlib import Path

# Asegurar que app está en el path
sys.path.insert(0, str(Path(__file__).parent))

import bcrypt
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import engine, SessionLocal, Base
from app.models import Zone, User, Role, UserRole, Distributor
from app.config import settings



def ensure_password_column(db: Session) -> None:
    """Añade columna PasswordHash si no existe (para bases ya creadas)."""
    try:
        if "sqlite" in settings.resolved_database_url:
            # SQLite: intentar añadir columna (falla si ya existe)
            db.execute(text(
                "ALTER TABLE User ADD COLUMN PasswordHash VARCHAR(256)"
            ))
        else:
            # SQL Server / Azure SQL
            db.execute(text("""
                IF NOT EXISTS (
                    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME = 'User' AND COLUMN_NAME = 'PasswordHash'
                )
                BEGIN
                    ALTER TABLE [User] ADD [PasswordHash] NVARCHAR(256) NULL
                END
            """))
        db.commit()
    except Exception as e:
        if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
            db.rollback()
            return  # Columna ya existe
        db.rollback()
        raise

# Usuario de prueba
TEST_USER = {
    "email": "admin@test.com",
    "password": "Admin123!",
    "display_name": "Admin Test",
}


def seed(db: Session) -> None:
    ensure_password_column(db)

    # Crear zona si no existe
    zone = db.query(Zone).filter(Zone.Name == "Zona Norte - CABA").first()
    if not zone:
        zone = Zone(Name="Zona Norte - CABA")
        db.add(zone)
        db.commit()
        db.refresh(zone)
        print(f"  ✓ Zona creada: {zone.Name} (ID: {zone.ZoneId})")
    else:
        print(f"  - Zona ya existe: {zone.Name}")

    # Crear rol admin si no existe
    role = db.query(Role).filter(Role.Name == "admin").first()
    if not role:
        role = Role(Name="admin")
        db.add(role)
        db.commit()
        db.refresh(role)
        print(f"  ✓ Rol creado: {role.Name} (ID: {role.RoleId})")
    else:
        print(f"  - Rol ya existe: {role.Name}")

    # Crear usuario de prueba
    user = db.query(User).filter(User.Email == TEST_USER["email"]).first()
    if not user:
        user = User(
            Email=TEST_USER["email"],
            PasswordHash=bcrypt.hashpw(TEST_USER["password"].encode(), bcrypt.gensalt()).decode(),
            DisplayName=TEST_USER["display_name"],
            ZoneId=zone.ZoneId,
            IsActive=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"  ✓ Usuario creado: {user.Email} (ID: {user.UserId})")
    else:
        # Actualizar contraseña si el usuario ya existe
        user.PasswordHash = bcrypt.hashpw(TEST_USER["password"].encode(), bcrypt.gensalt()).decode()
        user.DisplayName = TEST_USER["display_name"]
        user.ZoneId = zone.ZoneId
        user.IsActive = True
        db.commit()
        print(f"  ✓ Usuario actualizado: {user.Email} (contraseña reseteada)")

    # Asignar rol al usuario
    user_role = db.query(UserRole).filter(
        UserRole.UserId == user.UserId,
        UserRole.RoleId == role.RoleId,
    ).first()
    if not user_role:
        user_role = UserRole(UserId=user.UserId, RoleId=role.RoleId)
        db.add(user_role)
        db.commit()
        print(f"  ✓ Rol 'admin' asignado al usuario")

    # Crear distribuidor de ejemplo
    dist = db.query(Distributor).filter(Distributor.Name == "Distribuidora Norte SA").first()
    if not dist:
        dist = Distributor(Name="Distribuidora Norte SA", IsActive=True)
        db.add(dist)
        db.commit()
        print(f"  ✓ Distribuidor creado: {dist.Name}")


def main():
    print("Creando tablas...")
    Base.metadata.create_all(bind=engine)

    print("Ejecutando seed...")
    db = SessionLocal()
    try:
        seed(db)
        print("\n" + "=" * 50)
        print("Usuario de prueba para login:")
        print(f"  Email:      {TEST_USER['email']}")
        print(f"  Contraseña: {TEST_USER['password']}")
        print("=" * 50)
    finally:
        db.close()


if __name__ == "__main__":
    main()
