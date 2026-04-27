#!/usr/bin/env python3
"""
Script para crear datos iniciales y usuarios de prueba.
Ejecutar: python seed_db.py

Usuarios de prueba:
  Admin:      admin@test.com / Admin123!
  Trade Rep:  trade@test.com / TradeRep123!
"""
import sys
from pathlib import Path

# Asegurar que app está en el path
sys.path.insert(0, str(Path(__file__).parent))

import bcrypt
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import engine, SessionLocal, Base
from app.models import Zone, User, Role, UserRole, Distributor, Form, FormQuestion, FormOption, Channel, SubChannel, Product
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

# Usuarios de prueba
ADMIN_USER = {
    "email": "admin@test.com",
    "password": "Admin123!",
    "display_name": "Admin Test",
}

TRADE_REP_USER = {
    "email": "trade@test.com",
    "password": "TradeRep123!",
    "display_name": "Carlos Trade Rep",
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

    # Crear usuario admin
    user = db.query(User).filter(User.Email == ADMIN_USER["email"]).first()
    if not user:
        user = User(
            Email=ADMIN_USER["email"],
            PasswordHash=bcrypt.hashpw(ADMIN_USER["password"].encode(), bcrypt.gensalt()).decode(),
            DisplayName=ADMIN_USER["display_name"],
            ZoneId=zone.ZoneId,
            IsActive=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"  ✓ Usuario admin creado: {user.Email} (ID: {user.UserId})")
    else:
        user.PasswordHash = bcrypt.hashpw(ADMIN_USER["password"].encode(), bcrypt.gensalt()).decode()
        user.DisplayName = ADMIN_USER["display_name"]
        user.ZoneId = zone.ZoneId
        user.IsActive = True
        db.commit()
        print(f"  ✓ Usuario admin actualizado: {user.Email} (contraseña reseteada)")

    # Asignar rol admin
    user_role = db.query(UserRole).filter(
        UserRole.UserId == user.UserId,
        UserRole.RoleId == role.RoleId,
    ).first()
    if not user_role:
        user_role = UserRole(UserId=user.UserId, RoleId=role.RoleId)
        db.add(user_role)
        db.commit()
        print(f"  ✓ Rol 'admin' asignado al usuario")

    # Crear rol vendedor (Trade Rep) si no existe
    role_vendedor = db.query(Role).filter(Role.Name == "vendedor").first()
    if not role_vendedor:
        role_vendedor = Role(Name="vendedor")
        db.add(role_vendedor)
        db.commit()
        db.refresh(role_vendedor)
        print(f"  ✓ Rol creado: {role_vendedor.Name} (ID: {role_vendedor.RoleId})")
    else:
        print(f"  - Rol ya existe: {role_vendedor.Name}")

    # Crear usuario Trade Rep
    user_trade = db.query(User).filter(User.Email == TRADE_REP_USER["email"]).first()
    if not user_trade:
        user_trade = User(
            Email=TRADE_REP_USER["email"],
            PasswordHash=bcrypt.hashpw(TRADE_REP_USER["password"].encode(), bcrypt.gensalt()).decode(),
            DisplayName=TRADE_REP_USER["display_name"],
            ZoneId=zone.ZoneId,
            IsActive=True,
        )
        db.add(user_trade)
        db.commit()
        db.refresh(user_trade)
        print(f"  ✓ Usuario Trade Rep creado: {user_trade.Email} (ID: {user_trade.UserId})")
    else:
        user_trade.PasswordHash = bcrypt.hashpw(TRADE_REP_USER["password"].encode(), bcrypt.gensalt()).decode()
        user_trade.DisplayName = TRADE_REP_USER["display_name"]
        user_trade.ZoneId = zone.ZoneId
        user_trade.IsActive = True
        db.commit()
        print(f"  ✓ Usuario Trade Rep actualizado: {user_trade.Email} (contraseña reseteada)")

    # Asignar rol vendedor al Trade Rep
    ur_trade = db.query(UserRole).filter(
        UserRole.UserId == user_trade.UserId,
        UserRole.RoleId == role_vendedor.RoleId,
    ).first()
    if not ur_trade:
        ur_trade = UserRole(UserId=user_trade.UserId, RoleId=role_vendedor.RoleId)
        db.add(ur_trade)
        db.commit()
        print(f"  ✓ Rol 'vendedor' asignado al Trade Rep")

    # Crear distribuidor de ejemplo
    dist = db.query(Distributor).filter(Distributor.Name == "Distribuidora Norte SA").first()
    if not dist:
        dist = Distributor(Name="Distribuidora Norte SA", IsActive=True)
        db.add(dist)
        db.commit()
        print(f"  ✓ Distribuidor creado: {dist.Name}")

    # Crear canales y subcanales (según doc Categorización de PDVs v1.0)
    channels_data = [
        (
            "Convenience",
            "Puntos de venta pequeños orientados al consumo rápido (quioscos y variantes).",
            [
                ("Quiosco", "Punto de venta pequeño con venta de cigarrillos, golosinas y artículos de consumo rápido."),
                ("Quiosco ventana", "Quiosco con atención exclusivamente desde una ventana, sin acceso al interior del local."),
                ("Maxiquiosco", "Versión ampliada del quiosco, mayor variedad de productos y capacidad de exhibición."),
            ],
        ),
        (
            "Grocery",
            "Comercios de alimentación y consumo básico de barrio.",
            [
                ("Almacén / Despensa", "Comercio de barrio con venta de alimentos y productos de consumo básico."),
                ("Autoservicio / Supermercado independiente", "Mayor escala que el almacén, con góndolas y mayor variedad de categorías."),
            ],
        ),
        (
            "Especializado",
            "Comercios especializados en tabaco y productos relacionados.",
            [
                ("Tabaquería", "Comercio especializado en tabaco, cigarrillos y productos relacionados."),
                ("Growshop", "Local especializado en cultivo y accesorios, con venta de productos de nicotina y tabaco."),
            ],
        ),
        (
            "Estación de Servicio",
            "Estaciones de servicio independientes o de bandera. Se registra categoría, subcategoría y nombre del local o red.",
            [
                ("Independiente", "Estación sin bandera de cadena. Se registra el nombre específico del local."),
                ("De bandera", "Estación perteneciente a una red (YPF, Shell, Axion, otra). Se registra la marca de la cadena."),
            ],
        ),
        (
            "Cadenas de Proximidad",
            "Cadenas con gestión centralizada. Ejecución sujeta a acuerdos negociados a nivel central. Puede requerir un TMR dedicado.",
            [
                ("Chica (menos de 10 PDVs)", "Cadena con estructura de gestión centralizada y menos de 10 puntos de venta."),
                ("Mediana (11 a 30 PDVs)", "Cadena con estructura de gestión centralizada y entre 11 y 30 puntos de venta."),
                ("Grande (más de 30 PDVs)", "Cadena con estructura de gestión centralizada y más de 30 puntos de venta."),
            ],
        ),
    ]
    for ch_name, ch_desc, subs in channels_data:
        ch = db.query(Channel).filter(Channel.Name == ch_name).first()
        if not ch:
            ch = Channel(Name=ch_name, Description=ch_desc, IsActive=True)
            db.add(ch)
            db.commit()
            db.refresh(ch)
            print(f"  ✓ Canal creado: {ch.Name}")
        elif not ch.Description:
            ch.Description = ch_desc
            db.commit()
        for sub_name, sub_desc in subs:
            sub = db.query(SubChannel).filter(
                SubChannel.ChannelId == ch.ChannelId,
                SubChannel.Name == sub_name,
            ).first()
            if not sub:
                sub = SubChannel(ChannelId=ch.ChannelId, Name=sub_name, Description=sub_desc, IsActive=True)
                db.add(sub)
            elif not sub.Description:
                sub.Description = sub_desc
        db.commit()


def seed_forms(db: Session) -> None:
    """Crear formularios de relevamiento tabacalero predefinidos."""
    forms_data = [
        {
            "name": "Cobertura y Precios",
            "channel": "Relevamiento",
            "questions": [
                {"key": "guia_precios", "label": "¿En qué se guía para establecer precios?", "qtype": "radio", "required": False,
                 "options": [
                    ("lista_kiosqueros", "Lista de precios kiosqueros / WhatsApp"),
                    ("margen_fijo", "Margen o porcentaje fijo"),
                    ("competencia", "Precios de la competencia"),
                    ("otros", "Otros"),
                 ]},
                {"key": "cobertura_precios", "label": "Cobertura — tildar las marcas que trabaja (y precio al consumidor si aplica)", "qtype": "checkbox_price", "required": True,
                 "options": [
                    # Línea Milenio
                    ("milenio_red", "Milenio Red"), ("milenio_gold", "Milenio Gold"),
                    ("milenio_mint", "Milenio Mint"), ("milenio_icergy", "Milenio Icergy"),
                    ("milenio_pink", "Milenio Pink"), ("milenio_vid", "Milenio Vid"),
                    # Línea Melbourne
                    ("melbourne_red", "Melbourne Red"), ("melbourne_gold", "Melbourne Gold"),
                    ("melbourne_mint", "Melbourne Mint"),
                    # Mill
                    ("mill_red", "Mill Red"), ("mill_explosion", "Mill Explosion"),
                    # Otros económicos
                    ("bold", "Bold"), ("van_kiff", "Van Kiff"), ("lebonn", "Lebonn"),
                    # Red Point
                    ("red_point_ks", "Red Point KS"), ("red_point_box", "Red Point Box"),
                    ("red_point_on", "Red Point On (cápsula)"),
                    # Master
                    ("master_ks", "Master KS"), ("master_box", "Master Box"),
                    # Kiel
                    ("kiel_ks", "Kiel KS"), ("kiel_box", "Kiel Box"),
                    # Otros
                    ("pier", "Pier"), ("dolchester", "Dolchester"), ("liverpoll", "Liverpoll"),
                    ("golden_king", "Golden King"), ("golden_king_conv", "Golden King Convertible"),
                    ("cj", "CJ"), ("boxer", "Boxer"), ("go_ks", "Go KS"),
                    ("melbo", "Melbo"), ("rodeo", "Rodeo"), ("hills", "Hills"),
                    # Marlboro Craft
                    ("marlboro_craft_ks", "Marlboro Craft KS"),
                    ("marlboro_craft_box", "Marlboro Craft Box"),
                    ("marlboro_craft_fwd", "Marlboro Craft Fordward (cápsula)"),
                    ("marlboro_craft_coral", "Marlboro Craft Coral"),
                    # Lucky Origen
                    ("lucky_origen_red_ks", "Lucky Origen Red KS"),
                    ("lucky_origen_conv_box20", "Lucky Origen Convertible Box 20"),
                    ("lucky_origen_conv_ks", "Lucky Origen Convertible KS"),
                    # Económicos
                    ("philip_morris_select", "Philip Morris Select (económico)"),
                    ("luckies_eco", "Luckies (económico)"),
                 ]},
                {"key": "cobertura_otros", "label": "Otras marcas (especificar)", "qtype": "text", "required": False},
            ],
        },
        {
            "name": "Censo de Materiales",
            "channel": "Relevamiento",
            "questions": [
                {"key": "mat_primarios", "label": "Materiales Primarios (seleccionar presentes)", "qtype": "checkbox", "required": True,
                 "options": [
                    ("cigarrera", "Cigarrera"), ("pantalla", "Pantalla"),
                    ("exhibidor", "Exhibidor"), ("dispensador", "Dispensador"),
                 ]},
                {"key": "mat_secundarios", "label": "Materiales Secundarios (seleccionar presentes)", "qtype": "checkbox", "required": True,
                 "options": [
                    ("movil", "Móvil"), ("stopper", "Stopper"),
                    ("afiche", "Afiche"), ("banderola", "Banderola"),
                    ("cenefas", "Cenefas"), ("otro", "Otro"),
                 ]},
                {"key": "mat_estado", "label": "Estado general del material", "qtype": "scale", "required": False,
                 "rules": '{"scale":{"min":1,"max":5,"minLabel":"Malo","maxLabel":"Excelente"}}'},
            ],
        },
        {
            "name": "Venta de Sueltos",
            "channel": "Relevamiento",
            "questions": [
                {"key": "vende_sueltos", "label": "Vende cigarrillos sueltos?", "qtype": "radio", "required": True,
                 "options": [("si", "Sí"), ("no", "No")]},
                {"key": "sueltos_marcas", "label": "Marcas disponibles en sueltos", "qtype": "text", "required": False},
                {"key": "sueltos_precio", "label": "Precio por unidad (suelto)", "qtype": "number", "required": False},
            ],
        },
        {
            "name": "Censo de Promociones",
            "channel": "Relevamiento",
            "questions": [
                {"key": "promo_propia", "label": "Promociones propias activas", "qtype": "textarea", "required": False},
                {"key": "promo_competencia", "label": "Promociones de competencia activas", "qtype": "textarea", "required": False},
                {"key": "promo_tipo", "label": "Tipo de promoción más relevante", "qtype": "select", "required": False,
                 "options": [
                    ("2x1", "2x1"), ("descuento", "Descuento"), ("regalo", "Regalo con compra"),
                    ("combo", "Combo"), ("otra", "Otra"),
                 ]},
            ],
        },
        {
            "name": "Proveedores",
            "channel": "Relevamiento",
            "questions": [
                {"key": "proveedores", "label": "Proveedores de cigarrillos (seleccionar)", "qtype": "checkbox", "required": True,
                 "options": [
                    ("espert", "Espert"), ("bat", "BAT"), ("tabsa", "TABSA"),
                 ]},
                {"key": "proveedor_otro", "label": "Otro proveedor (especificar)", "qtype": "text", "required": False},
                {"key": "frecuencia_visita_proveedor", "label": "Frecuencia de visita del proveedor principal", "qtype": "select", "required": False,
                 "options": [
                    ("diaria", "Diaria"), ("semanal", "Semanal"),
                    ("quincenal", "Quincenal"), ("mensual", "Mensual"),
                 ]},
            ],
        },
    ]

    for form_data in forms_data:
        existing = db.query(Form).filter(Form.Name == form_data["name"]).first()
        if existing:
            print(f"  - Formulario ya existe: {form_data['name']}")
            continue

        form = Form(Name=form_data["name"], Channel=form_data["channel"], Version=1, IsActive=True)
        db.add(form)
        db.commit()
        db.refresh(form)
        print(f"  + Formulario creado: {form.Name} (ID: {form.FormId})")

        for sort_idx, q_data in enumerate(form_data["questions"]):
            question = FormQuestion(
                FormId=form.FormId,
                FormVersion=1,
                SortOrder=sort_idx + 1,
                KeyName=q_data["key"],
                Label=q_data["label"],
                QType=q_data["qtype"],
                IsRequired=q_data.get("required", False),
                RulesJson=q_data.get("rules"),
            )
            db.add(question)
            db.commit()
            db.refresh(question)

            for opt_idx, (val, label) in enumerate(q_data.get("options", [])):
                option = FormOption(
                    QuestionId=question.QuestionId,
                    Value=val,
                    Label=label,
                    SortOrder=opt_idx + 1,
                )
                db.add(option)
            db.commit()

    print("  Formularios de relevamiento tabacalero listos.")


def seed_products(db: Session) -> None:
    """Seed product catalog from paso-a-paso document v1.5."""
    if db.query(Product).first():
        print("  - Productos ya existen, saltando seed.")
        return

    # (Category, Manufacturer, Name, IsOwn)
    products = [
        # --- CIGARRILLOS ---
        ("Cigarrillos", "Espert", "Milenio Red", True),
        ("Cigarrillos", "Espert", "Milenio Gold", True),
        ("Cigarrillos", "Espert", "Milenio Mint", True),
        ("Cigarrillos", "Espert", "Milenio Icergy", True),
        ("Cigarrillos", "Espert", "Milenio Pink", True),
        ("Cigarrillos", "Espert", "Milenio Vid", True),
        ("Cigarrillos", "Espert", "Mill Red", True),
        ("Cigarrillos", "Espert", "Mill Explosion", True),
        ("Cigarrillos", "Espert", "Melbourne Red", True),
        ("Cigarrillos", "Espert", "Melbourne Gold", True),
        ("Cigarrillos", "Espert", "Melbourne Mint", True),
        ("Cigarrillos", "Espert", "Bold", True),
        ("Cigarrillos", "Real Tabacalera", "Pier Red", False),
        ("Cigarrillos", "Real Tabacalera", "Liverpoll", False),
        ("Cigarrillos", "Real Tabacalera", "Dolchester", False),
        ("Cigarrillos", "Real Tabacalera", "Corona", False),
        ("Cigarrillos", "Massalin", "Marlboro Craft KS", False),
        ("Cigarrillos", "Massalin", "Marlboro Craft Coral", False),
        ("Cigarrillos", "Massalin", "Marlboro Craft Forward", False),
        ("Cigarrillos", "Massalin", "Marlboro Craft Purple", False),
        ("Cigarrillos", "Massalin", "Philip Morris Red Select", False),
        ("Cigarrillos", "BAT", "Lucky LS Origen", False),
        ("Cigarrillos", "BAT", "Lucky LS Origen Caps", False),
        ("Cigarrillos", "BAT", "Luckies Red", False),
        ("Cigarrillos", "Tabacalera Sarandí", "Red Point KS", False),
        ("Cigarrillos", "Tabacalera Sarandí", "Red Point ON", False),
        ("Cigarrillos", "Tabacalera Sarandí", "Red Point Sixt", False),
        ("Cigarrillos", "Tabacalera Sarandí", "Master KS", False),
        ("Cigarrillos", "Tabacalera Sarandí", "Kiel", False),
        ("Cigarrillos", "Todo Tabaco", "Golden King", False),
        ("Cigarrillos", "Todo Tabaco", "Golden King Caps", False),
        ("Cigarrillos", "Cigarrillos y Tabacos", "GO", False),
        ("Cigarrillos", "Cigarrillos y Tabacos", "CJ", False),
        # --- TABACOS ---
        ("Tabacos", "Espert", "Van Kiff", True),
        ("Tabacos", "Espert", "Lebonn", True),
        ("Tabacos", None, "Van Hasenn", False),
        ("Tabacos", "Sairi", "Sairi", False),
        ("Tabacos", "Tabacalera Sarandí", "4 Leguas", False),
        ("Tabacos", None, "Flandria", False),
        ("Tabacos", "Tabes", "Pachamama", False),
        ("Tabacos", "Tabes", "Las Hojas", False),
        # --- PAPELILLOS ---
        ("Papelillos", None, "Smoking", False),
        ("Papelillos", "Espert", "Blank", True),
        ("Papelillos", None, "OCB", False),
        ("Papelillos", None, "Giseh", False),
        ("Papelillos", None, "Zeus", False),
        ("Papelillos", None, "Rizla", False),
        # --- VAPES ---
        ("Vapers", None, "Ignite", False),
        ("Vapers", None, "Elfbar", False),
        ("Vapers", None, "Geek", False),
        ("Vapers", "Espert", "Dito", True),
        # --- POUCHES DE NICOTINA ---
        ("Pouches de nicotina", "Espert", "Fleek", True),
        ("Pouches de nicotina", "Massalin", "Zyn", False),
        ("Pouches de nicotina", "BAT", "Velo", False),
    ]

    for i, (cat, mfr, name, is_own) in enumerate(products):
        db.add(Product(
            Name=name, Category=cat, Manufacturer=mfr,
            IsOwn=is_own, IsActive=True, SortOrder=i,
        ))
    db.commit()
    print(f"  ✓ {len(products)} productos creados")


def main():
    print("Creando tablas...")
    Base.metadata.create_all(bind=engine)

    print("Ejecutando seed...")
    db = SessionLocal()
    try:
        seed(db)
        print("\nCreando formularios de relevamiento...")
        seed_forms(db)
        print("\nCreando catálogo de productos...")
        seed_products(db)
        print("\n" + "=" * 50)
        print("Usuarios de prueba para login:")
        print("  Admin:      {email} / {password}".format(**ADMIN_USER))
        print("  Trade Rep:  {email} / {password}".format(**TRADE_REP_USER))
        print("=" * 50)
    finally:
        db.close()


if __name__ == "__main__":
    main()
