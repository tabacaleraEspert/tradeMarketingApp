#!/usr/bin/env python3
"""
Seed de producción v0 — Tabacalera Espert Trade Marketing.

Carga:
  1. Zonas reales (14 del organigrama + AMBA como zona paraguas)
  2. Usuarios reales con jerarquía (organigrama completo)
  3. Canales y subcanales (doc categorización v1.0)
  4. Catálogo de productos (54 del paso-a-paso v1.5)
  5. PDVs desde Excel (Clientes Sebastian APP.xlsx)
  6. Rutas por día para Sebastián Morales

Ejecutar: python seed_production.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import bcrypt
from sqlalchemy.orm import Session

from app.database import engine, SessionLocal, Base
from app.models import (
    Zone, User, Role, UserRole, Channel, SubChannel, Product,
    PDV, PdvContact, Route, RoutePdv, Distributor,
)
from app.models.pdv import PdvDistributor

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
DEFAULT_PASSWORD = "Espert2026!"  # Todos con MustChangePassword=True


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


# --------------------------------------------------------------------------
# 1. Zonas
# --------------------------------------------------------------------------
ZONES = [
    # AMBA
    "BS AS Costa", "BS AS Medley", "Zona Oeste", "Zona Norte",
    "GBA", "Zona Sur 3", "Zona Sur 1",
    # Interior
    "Litoral", "Cuyo", "NEA", "Córdoba",
    "Patagonia Costa", "Patagonia Andina", "NOA",
]


def seed_zones(db: Session) -> dict[str, int]:
    zone_map = {}
    for name in ZONES:
        z = db.query(Zone).filter(Zone.Name == name).first()
        if not z:
            z = Zone(Name=name)
            db.add(z)
            db.flush()
            print(f"  + Zona: {name}")
        zone_map[name] = z.ZoneId
    db.commit()
    return zone_map


# --------------------------------------------------------------------------
# 2. Roles
# --------------------------------------------------------------------------
ROLES = ["admin", "regional_manager", "territory_manager", "ejecutivo", "vendedor"]


def seed_roles(db: Session) -> dict[str, int]:
    role_map = {}
    for name in ROLES:
        r = db.query(Role).filter(Role.Name == name).first()
        if not r:
            r = Role(Name=name)
            db.add(r)
            db.flush()
        role_map[name] = r.RoleId
    db.commit()
    return role_map


# --------------------------------------------------------------------------
# 3. Usuarios — Organigrama completo
# --------------------------------------------------------------------------
# (display_name, email_username, role, zone_name_or_None, manager_username_or_None)
USERS = [
    # Dirección
    ("Equipo País", "equipo.pais", "admin", None, None),
    ("Rodrigo Salinas", "rodrigo.salinas", "admin", None, None),

    # Gte Regional BA
    ("Martín Lezcano", "martin.lezcano", "regional_manager", None, "rodrigo.salinas"),

    # Territory Managers AMBA
    ("Franco García", "franco.garcia", "territory_manager", "BS AS Costa", "martin.lezcano"),
    ("Matías Sapia", "matias.sapia", "territory_manager", "BS AS Medley", "martin.lezcano"),
    ("Juan Albornoz", "juan.albornoz", "territory_manager", "Zona Oeste", "martin.lezcano"),
    ("Mariette Curvelo", "mariette.curvelo", "territory_manager", "Zona Norte", "martin.lezcano"),
    ("Ariel Muñoz", "ariel.munoz", "territory_manager", "GBA", "martin.lezcano"),
    ("Lilián Noguera", "lilian.noguera", "territory_manager", "Zona Sur 3", "martin.lezcano"),
    ("Nahuel Segare", "nahuel.segare", "territory_manager", "Zona Sur 1", "martin.lezcano"),

    # Territory Managers Interior
    ("Fabrizio Faini", "fabrizio.faini", "territory_manager", "Litoral", "rodrigo.salinas"),
    ("Emmanuel Andurena", "emmanuel.andurena", "territory_manager", "Cuyo", "rodrigo.salinas"),
    ("Andrés Spagnolo", "andres.spagnolo", "territory_manager", "NEA", "rodrigo.salinas"),
    ("Pablo Bruscoli", "pablo.bruscoli", "territory_manager", "Córdoba", "rodrigo.salinas"),
    ("Martín Martín", "martin.martin", "territory_manager", "Patagonia Costa", "rodrigo.salinas"),
    ("Juan San Miguel", "juan.sanmiguel", "territory_manager", "Patagonia Andina", "rodrigo.salinas"),
    ("Duilio Anaya", "duilio.anaya", "territory_manager", "NOA", "rodrigo.salinas"),

    # TM Reps AMBA
    ("Claudio Pagani", "claudio.pagani", "vendedor", "BS AS Costa", "franco.garcia"),
    ("María Sol Alevatto", "mariasol.alevatto", "vendedor", "BS AS Costa", "franco.garcia"),
    ("Sebastián Morales", "sebastian.morales", "vendedor", "GBA", "ariel.munoz"),
    ("Germán Jaretchi", "german.jaretchi", "vendedor", "Zona Sur 1", "nahuel.segare"),

    # TM Reps / Ejec Interior
    ("Agustín Calarretta", "agustin.calarretta", "vendedor", "Litoral", "fabrizio.faini"),
    ("Matías Avila", "matias.avila", "vendedor", "Litoral", "fabrizio.faini"),
    ("Carlos Guardia", "carlos.guardia", "vendedor", "Cuyo", "emmanuel.andurena"),
    ("Sergio Loyola", "sergio.loyola", "vendedor", "Córdoba", "pablo.bruscoli"),
]


def seed_users(db: Session, role_map: dict[str, int], zone_map: dict[str, int]) -> dict[str, User]:
    pw_hash = _hash(DEFAULT_PASSWORD)
    user_map: dict[str, User] = {}

    for display, username, role_name, zone_name, manager_username in USERS:
        u = db.query(User).filter(User.Email == username).first()
        if not u:
            u = User(
                Email=username,
                DisplayName=display,
                PasswordHash=pw_hash,
                ZoneId=zone_map.get(zone_name) if zone_name else None,
                MustChangePassword=True,
                IsActive=True,
            )
            db.add(u)
            db.flush()
            print(f"  + Usuario: {display} ({username}) — {role_name}")

            # Assign role
            db.add(UserRole(UserId=u.UserId, RoleId=role_map[role_name]))
        user_map[username] = u

    # Set manager relationships (second pass)
    for display, username, role_name, zone_name, manager_username in USERS:
        if manager_username and manager_username in user_map:
            u = user_map[username]
            mgr = user_map[manager_username]
            if u.ManagerUserId != mgr.UserId:
                u.ManagerUserId = mgr.UserId

    db.commit()
    return user_map


# --------------------------------------------------------------------------
# 4. Canales y subcanales (from categorizacion doc)
# --------------------------------------------------------------------------
def seed_channels(db: Session):
    """Seed channels — same as seed_db.py but idempotent."""
    from seed_db import seed  # reuse channel part
    # Only create channels if none exist yet
    if db.query(Channel).count() == 0:
        channels_data = [
            ("Convenience", "Puntos de venta pequeños orientados al consumo rápido.",
             [("Quiosco", "Punto de venta pequeño con venta de cigarrillos, golosinas y artículos de consumo rápido."),
              ("Quiosco ventana", "Quiosco con atención exclusivamente desde una ventana."),
              ("Maxiquiosco", "Versión ampliada del quiosco, mayor variedad de productos.")]),
            ("Grocery", "Comercios de alimentación y consumo básico de barrio.",
             [("Almacén / Despensa", "Comercio de barrio con venta de alimentos y productos de consumo básico."),
              ("Autoservicio / Supermercado independiente", "Mayor escala que el almacén, con góndolas.")]),
            ("Especializado", "Comercios especializados en tabaco y productos relacionados.",
             [("Tabaquería", "Comercio especializado en tabaco, cigarrillos y productos relacionados."),
              ("Growshop", "Local especializado en cultivo y accesorios.")]),
            ("Estación de Servicio", "Estaciones de servicio independientes o de bandera.",
             [("Independiente", "Estación sin bandera de cadena."),
              ("De bandera", "Estación perteneciente a una red (YPF, Shell, Axion, otra).")]),
            ("Cadenas de Proximidad", "Cadenas con gestión centralizada.",
             [("Chica (menos de 10 PDVs)", "Cadena con menos de 10 puntos de venta."),
              ("Mediana (11 a 30 PDVs)", "Cadena con entre 11 y 30 puntos de venta."),
              ("Grande (más de 30 PDVs)", "Cadena con más de 30 puntos de venta.")]),
        ]
        for ch_name, ch_desc, subs in channels_data:
            ch = Channel(Name=ch_name, Description=ch_desc, IsActive=True)
            db.add(ch)
            db.flush()
            for sub_name, sub_desc in subs:
                db.add(SubChannel(ChannelId=ch.ChannelId, Name=sub_name, Description=sub_desc, IsActive=True))
        db.commit()
        print("  + Canales y subcanales creados")
    else:
        print("  - Canales ya existen")

    # Return default channel for PDV import (Convenience > Quiosco)
    convenience = db.query(Channel).filter(Channel.Name == "Convenience").first()
    quiosco = None
    if convenience:
        quiosco = db.query(SubChannel).filter(
            SubChannel.ChannelId == convenience.ChannelId, SubChannel.Name == "Quiosco"
        ).first()
    return convenience, quiosco


# --------------------------------------------------------------------------
# 5. Productos
# --------------------------------------------------------------------------
def seed_products(db: Session):
    if db.query(Product).count() > 0:
        print("  - Productos ya existen")
        return
    from seed_db import seed_products as _sp
    _sp(db)


# --------------------------------------------------------------------------
# 6. PDVs desde Excel
# --------------------------------------------------------------------------
def seed_pdvs_from_excel(
    db: Session,
    user_map: dict[str, User],
    zone_map: dict[str, int],
    default_channel,
    default_subchannel,
):
    """Import PDVs from the Excel file, deduplicating by address."""
    try:
        import openpyxl
    except ImportError:
        print("  ! openpyxl no instalado — saltando importación de PDVs")
        return

    xlsx_path = Path(__file__).parent / "docs" / "Clientes Sebastian APP.xlsx"
    if not xlsx_path.exists():
        # Try parent directory
        xlsx_path = Path(__file__).parent.parent / "docs" / "Clientes Sebastian APP.xlsx"
    if not xlsx_path.exists():
        print(f"  ! Archivo no encontrado: {xlsx_path}")
        return

    wb = openpyxl.load_workbook(str(xlsx_path), read_only=True)
    ws = wb.active

    # TM Rep name → user
    tm_user = user_map.get("sebastian.morales")
    tm_zone_id = zone_map.get("GBA")

    channel_id = default_channel.ChannelId if default_channel else None
    subchannel_id = default_subchannel.SubChannelId if default_subchannel else None

    # Cadenas channel
    cadena_channel = db.query(Channel).filter(Channel.Name == "Cadenas de Proximidad").first()
    cadena_sub = None
    if cadena_channel:
        cadena_sub = db.query(SubChannel).filter(
            SubChannel.ChannelId == cadena_channel.ChannelId,
            SubChannel.Name.like("Chica%"),
        ).first()

    # Track addresses to deduplicate
    seen_addresses: dict[str, int] = {}  # normalized_address → PdvId
    created = 0
    skipped = 0
    route_pdvs: dict[str, list[int]] = {}  # "semana_dia" → [PdvId, ...]

    rows = list(ws.iter_rows(values_only=True))
    for row in rows[1:]:  # skip header
        if not row or len(row) < 9:
            continue

        zona, tm_rep, semana, frecuencia, dia, nombre_negocio, direccion, ciudad, provincia, *rest = row
        contacto = rest[0] if len(rest) > 0 else None
        telefono = rest[1] if len(rest) > 1 else None

        if not direccion or not str(direccion).strip():
            continue

        direccion = str(direccion).strip()
        ciudad = str(ciudad).strip() if ciudad else ""
        provincia = str(provincia).strip() if provincia else "Buenos Aires"
        nombre_negocio = str(nombre_negocio).strip() if nombre_negocio else ""
        contacto = str(contacto).strip() if contacto else ""
        telefono = str(telefono).strip() if telefono else ""
        dia = str(dia).strip().upper() if dia else ""
        semana = int(semana) if semana else 1

        # Deduplicate by normalized address
        addr_key = f"{direccion.lower()}|{ciudad.lower()}"
        if addr_key in seen_addresses:
            pdv_id = seen_addresses[addr_key]
            skipped += 1
        else:
            # Determine channel
            is_cadena = bool(nombre_negocio) and "cadena" in nombre_negocio.lower()
            pdv_channel_id = cadena_channel.ChannelId if is_cadena and cadena_channel else channel_id
            pdv_subchannel_id = cadena_sub.SubChannelId if is_cadena and cadena_sub else subchannel_id

            # Generate PDV name
            pdv_name = nombre_negocio if nombre_negocio else f"PDV {direccion}, {ciudad}"

            pdv = PDV(
                Name=pdv_name,
                Address=direccion,
                City=ciudad,
                Channel="Convenience" if not is_cadena else "Cadenas de Proximidad",
                ChannelId=pdv_channel_id,
                SubChannelId=pdv_subchannel_id,
                ZoneId=tm_zone_id,
                AssignedUserId=tm_user.UserId if tm_user else None,
                IsActive=True,
            )
            db.add(pdv)
            db.flush()
            seen_addresses[addr_key] = pdv.PdvId
            created += 1

            # Add contact if available
            if contacto:
                pc = PdvContact(
                    PdvId=pdv.PdvId,
                    ContactName=contacto,
                    ContactPhone=telefono if telefono and telefono not in ("", "0") else None,
                    ContactRole="dueño",
                )
                db.add(pc)

            pdv_id = pdv.PdvId

        # Track for route creation
        if dia:
            route_key = f"S{semana}_{dia}"
            if route_key not in route_pdvs:
                route_pdvs[route_key] = []
            if pdv_id not in route_pdvs[route_key]:
                route_pdvs[route_key].append(pdv_id)

    db.commit()
    print(f"  + {created} PDVs creados ({skipped} duplicados descartados)")

    # Create routes per day
    day_names = {"LUNES": 1, "MARTES": 2, "MIERCOLES": 3, "JUEVES": 4, "VIERNES": 5}
    routes_created = 0
    for route_key, pdv_ids in sorted(route_pdvs.items()):
        semana_str, dia_str = route_key.split("_", 1)
        route_name = f"Sebastián - {dia_str.title()} ({semana_str})"

        existing = db.query(Route).filter(Route.Name == route_name).first()
        if existing:
            continue

        visit_day = day_names.get(dia_str, None)
        route = Route(
            Name=route_name,
            ZoneId=tm_zone_id,
            AssignedUserId=tm_user.UserId if tm_user else None,
            FrequencyType="every_15_days",
            FrequencyConfig=f'{{"startWeek": {semana_str[1:]}}}',
            IsActive=True,
        )
        db.add(route)
        db.flush()

        for i, pid in enumerate(pdv_ids):
            db.add(RoutePdv(RouteId=route.RouteId, PdvId=pid, SortOrder=i + 1, Priority=3))

        routes_created += 1

    db.commit()
    print(f"  + {routes_created} rutas creadas")


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    print("=" * 60)
    print("SEED DE PRODUCCIÓN v0 — Tabacalera Espert Trade Marketing")
    print("=" * 60)

    print("\nCreando tablas...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        print("\n1. Zonas...")
        zone_map = seed_zones(db)

        print("\n2. Roles...")
        role_map = seed_roles(db)

        print("\n3. Usuarios (organigrama)...")
        user_map = seed_users(db, role_map, zone_map)

        print("\n4. Canales y subcanales...")
        default_channel, default_subchannel = seed_channels(db)

        print("\n5. Catálogo de productos...")
        seed_products(db)

        print("\n6. PDVs desde Excel + Rutas...")
        seed_pdvs_from_excel(db, user_map, zone_map, default_channel, default_subchannel)

        print("\n" + "=" * 60)
        print("SEED COMPLETADO")
        print("=" * 60)
        print(f"\nUsuarios creados: {len(USERS)}")
        print(f"Zonas: {len(ZONES)}")
        print(f"Password inicial: {DEFAULT_PASSWORD}")
        print("(Todos los usuarios deben cambiar la contraseña en el primer login)")
        print("\nUsuarios clave:")
        for display, username, role, *_ in USERS[:7]:
            print(f"  {username:30s} {role:20s} {display}")
        print(f"  ... y {len(USERS) - 7} más")
        print("=" * 60)

    finally:
        db.close()


if __name__ == "__main__":
    main()
