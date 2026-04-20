#!/usr/bin/env python3
"""
Seed para la DEMO en vivo (presentación de hoy).

Crea (de forma idempotente, podés re-ejecutar sin romper nada):
- 4 TM Reps + 1 Admin (con contraseñas demo)
- Canales: Kiosco, Autoservicio, Mayorista
- Zona: CABA
- 1 Form de Relevamiento "Censo Precios - Kioscos" con frecuencia semanal y 5 preguntas
- 1 Acción obligatoria "Colocar cigarrera mostrador" vinculada al form
- 8 PDVs con coordenadas reales en CABA
- 2 Rutas Foco asignadas a TM Reps distintos:
    - "Ruta Norte - Belgrano" (4 PDVs) → Carlos
    - "Ruta Centro - Microcentro" (4 PDVs) → Lucía
- RouteDay para HOY, MAÑANA y PASADO MAÑANA en cada ruta
- 6 visitas históricas cerradas (últimos 30 días) con respuestas y duraciones realistas
  → para que Reportes / Avg time muestre datos
- 5 PdvNote pendientes (TODOs dejados por reps anteriores) en distintos PDVs
- 1 ruta marcada como Optimizada

Ejecutar:
    cd backend
    python seed_demo.py

Si todavía no corriste la migración de columnas nuevas, este script la corre primero.
"""
from __future__ import annotations

import sys
import json
import random
from pathlib import Path
from datetime import datetime, timedelta, timezone, date

sys.path.insert(0, str(Path(__file__).parent))

import bcrypt
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine, Base
from app.models import (
    Zone, User, Role, UserRole, Channel, SubChannel,
    PDV, Form, FormQuestion, FormOption,
    Route, RoutePdv, RouteDay, RouteDayPdv, RouteForm,
    Visit, VisitAnswer, VisitCheck,
    MandatoryActivity, PdvNote,
)
from app.models.visit_action import VisitAction


# ==========================================================================
# CONFIG: edit me to change demo dates
# ==========================================================================
TODAY = date.today()
TOMORROW = TODAY + timedelta(days=1)
DAY_AFTER = TODAY + timedelta(days=2)


# ==========================================================================
# Helpers
# ==========================================================================
def hashpw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def get_or_create(db: Session, model, defaults: dict | None = None, **filters):
    instance = db.query(model).filter_by(**filters).first()
    if instance:
        return instance, False
    params = {**filters, **(defaults or {})}
    instance = model(**params)
    db.add(instance)
    db.flush()
    return instance, True


# ==========================================================================
# Migración: garantiza columnas nuevas
# ==========================================================================
def run_pending_migration() -> None:
    print("→ Corriendo migración de columnas nuevas (idempotente)...")
    try:
        from migrations.add_business_rules_fields import run as run_brf
        run_brf()
    except Exception as e:
        print(f"  ! Migración falló o ya estaba aplicada: {e}")
    # Asegurar que todas las tablas (incluida PdvNote) existan
    Base.metadata.create_all(bind=engine)
    print("  ✓ Tablas sincronizadas")


# ==========================================================================
# 1. Roles + Zona
# ==========================================================================
def seed_roles_and_zone(db: Session) -> tuple[Zone, dict[str, Role]]:
    print("→ Roles y zona")
    zone, _ = get_or_create(db, Zone, Name="CABA")
    roles: dict[str, Role] = {}
    for name in ["admin", "supervisor", "vendedor"]:
        r, _ = get_or_create(db, Role, Name=name)
        roles[name] = r
    db.commit()
    print(f"  ✓ Zona: {zone.Name}  ·  Roles: {', '.join(roles.keys())}")
    return zone, roles


# ==========================================================================
# 2. Usuarios
# ==========================================================================
USERS = [
    ("admin@demo.com",   "Admin Demo",        "admin",     "Demo123!"),
    ("carlos@demo.com",  "Carlos Rodríguez",  "vendedor",  "Demo123!"),
    ("lucia@demo.com",   "Lucía Fernández",   "vendedor",  "Demo123!"),
    ("martin@demo.com",  "Martín González",   "vendedor",  "Demo123!"),
    ("paula@demo.com",   "Paula Sánchez",     "vendedor",  "Demo123!"),
]


def seed_users(db: Session, zone: Zone, roles: dict[str, Role]) -> dict[str, User]:
    print("→ Usuarios")
    users: dict[str, User] = {}
    for email, name, role_name, pw in USERS:
        u = db.query(User).filter(User.Email == email).first()
        if not u:
            u = User(
                Email=email,
                PasswordHash=hashpw(pw),
                DisplayName=name,
                ZoneId=zone.ZoneId,
                IsActive=True,
            )
            db.add(u)
            db.flush()
            print(f"  ✓ {name} <{email}>")
        else:
            u.PasswordHash = hashpw(pw)
            u.DisplayName = name
            u.ZoneId = zone.ZoneId
            u.IsActive = True
            print(f"  · {name} (actualizado)")
        # role
        ur = db.query(UserRole).filter(UserRole.UserId == u.UserId).first()
        if not ur:
            db.add(UserRole(UserId=u.UserId, RoleId=roles[role_name].RoleId))
        users[email] = u
    db.commit()
    return users


# ==========================================================================
# 3. Canales
# ==========================================================================
def seed_channels(db: Session) -> dict[str, Channel]:
    print("→ Canales")
    channels: dict[str, Channel] = {}
    for name in ["Kiosco", "Autoservicio", "Mayorista", "Supermercado"]:
        c, created = get_or_create(db, Channel, Name=name, defaults={"IsActive": True})
        channels[name] = c
        if created:
            print(f"  ✓ Canal: {name}")
    db.commit()
    return channels


# ==========================================================================
# 4. PDVs (8) con coords reales en CABA
# ==========================================================================
DEMO_PDVS = [
    # Ruta Norte - Belgrano (índices 0-5)
    {"name": "Kiosco San Martín",        "addr": "Av. Cabildo 2132, Belgrano",        "lat": -34.5614, "lon": -58.4566, "channel": "Kiosco"},
    {"name": "Maxikiosco La Esquina",    "addr": "Juramento 2456, Belgrano",          "lat": -34.5611, "lon": -58.4595, "channel": "Kiosco"},
    {"name": "Autoservicio Belgrano",    "addr": "Av. Cabildo 1875, Belgrano",        "lat": -34.5645, "lon": -58.4541, "channel": "Autoservicio"},
    {"name": "Kiosco 24hs Belgrano",     "addr": "Echeverría 2188, Belgrano",         "lat": -34.5621, "lon": -58.4582, "channel": "Kiosco"},
    {"name": "Kiosco Sucre",             "addr": "Sucre 1735, Belgrano",              "lat": -34.5598, "lon": -58.4519, "channel": "Kiosco"},
    {"name": "Maxikiosco Mendoza",       "addr": "Mendoza 2210, Belgrano",            "lat": -34.5587, "lon": -58.4533, "channel": "Kiosco"},
    # Ruta Centro - Microcentro (índices 6-11)
    {"name": "Kiosco Florida",           "addr": "Florida 537, Microcentro",          "lat": -34.6037, "lon": -58.3754, "channel": "Kiosco"},
    {"name": "Maxikiosco Plaza Mayo",    "addr": "Av. de Mayo 760, Microcentro",      "lat": -34.6086, "lon": -58.3789, "channel": "Kiosco"},
    {"name": "Express Tribunales",       "addr": "Talcahuano 478, Tribunales",        "lat": -34.6014, "lon": -58.3858, "channel": "Autoservicio"},
    {"name": "Kiosco Lavalle",           "addr": "Lavalle 919, Microcentro",          "lat": -34.6020, "lon": -58.3789, "channel": "Kiosco"},
    {"name": "Kiosco Corrientes",        "addr": "Av. Corrientes 1543, Centro",       "lat": -34.6041, "lon": -58.3878, "channel": "Kiosco"},
    {"name": "Mayorista Once",           "addr": "Pueyrredón 234, Once",              "lat": -34.6094, "lon": -58.4060, "channel": "Mayorista"},
]


def seed_pdvs(db: Session, zone: Zone, channels: dict[str, Channel]) -> list[PDV]:
    print("→ PDVs")
    pdvs: list[PDV] = []
    for spec in DEMO_PDVS:
        p = db.query(PDV).filter(PDV.Name == spec["name"]).first()
        if not p:
            p = PDV(
                Name=spec["name"],
                Address=spec["addr"],
                City="CABA",
                ChannelId=channels[spec["channel"]].ChannelId,
                Channel=spec["channel"],
                ZoneId=zone.ZoneId,
                Lat=spec["lat"],
                Lon=spec["lon"],
                IsActive=True,
            )
            db.add(p)
            db.flush()
            print(f"  ✓ {p.Name}")
        pdvs.append(p)
    db.commit()
    return pdvs


# ==========================================================================
# 5. Form de Relevamiento
# ==========================================================================
FORM_QUESTIONS = [
    {"key": "precio_marlboro", "label": "Precio Marlboro 20s ($)",     "qtype": "number",   "required": True},
    {"key": "precio_philip",   "label": "Precio Philip Morris 20s ($)", "qtype": "number",   "required": True},
    {"key": "stock_visible",   "label": "¿Hay cigarrera visible?",      "qtype": "checkbox", "required": True},
    {"key": "marcas_competencia", "label": "Marcas de competencia presentes", "qtype": "text", "required": False},
    {"key": "observaciones",   "label": "Observaciones generales",      "qtype": "textarea", "required": False},
]


def seed_form(db: Session) -> Form:
    print("→ Form de Relevamiento")
    f = db.query(Form).filter(Form.Name == "Censo Precios - Kioscos").first()
    if not f:
        f = Form(
            Name="Censo Precios - Kioscos",
            Channel="Kiosco",
            Version=1,
            IsActive=True,
            Frequency="weekly",
            FrequencyConfig=None,
        )
        db.add(f)
        db.flush()
        for i, q in enumerate(FORM_QUESTIONS):
            db.add(FormQuestion(
                FormId=f.FormId,
                FormVersion=1,
                SortOrder=i,
                KeyName=q["key"],
                Label=q["label"],
                QType=q["qtype"],
                IsRequired=q["required"],
            ))
        print(f"  ✓ Form '{f.Name}' creado con {len(FORM_QUESTIONS)} preguntas (frecuencia: semanal)")
    else:
        # Asegurar frecuencia
        f.Frequency = "weekly"
        print(f"  · Form '{f.Name}' ya existe")
    db.commit()
    return f


# ==========================================================================
# 6. Acción obligatoria
# ==========================================================================
def seed_mandatory_activity(db: Session, form: Form) -> MandatoryActivity:
    print("→ Acción obligatoria")
    act = db.query(MandatoryActivity).filter(MandatoryActivity.Name == "Colocar cigarrera mostrador").first()
    if not act:
        act = MandatoryActivity(
            Name="Colocar cigarrera mostrador",
            ActionType="pop",
            Description="Verificar/instalar cigarrera de exhibición sobre el mostrador. Sacar foto.",
            PhotoRequired=True,
            FormId=form.FormId,
            IsActive=True,
        )
        db.add(act)
        print(f"  ✓ Acción '{act.Name}' creada (vinculada al form)")
    else:
        act.FormId = form.FormId
        print(f"  · Acción ya existe (vinculación al form actualizada)")
    db.commit()
    return act


# ==========================================================================
# 7. Rutas + RoutePdv + RouteDay + RouteForm
# ==========================================================================
def seed_routes(
    db: Session,
    pdvs: list[PDV],
    users: dict[str, User],
    form: Form,
    zone: Zone,
) -> list[Route]:
    print("→ Rutas Foco")
    carlos = users["carlos@demo.com"]
    lucia = users["lucia@demo.com"]

    routes_spec = [
        {
            "name": "Ruta Norte - Belgrano",
            "user": carlos,
            "pdvs": pdvs[0:6],
            "is_optimized": True,
        },
        {
            "name": "Ruta Centro - Microcentro",
            "user": lucia,
            "pdvs": pdvs[6:12],
            "is_optimized": False,
        },
    ]

    routes: list[Route] = []
    for spec in routes_spec:
        r = db.query(Route).filter(Route.Name == spec["name"]).first()
        if not r:
            r = Route(
                Name=spec["name"],
                ZoneId=zone.ZoneId,
                IsActive=True,
                FrequencyType="daily",
                AssignedUserId=spec["user"].UserId,
                IsOptimized=spec["is_optimized"],
                EstimatedMinutes=120,
            )
            db.add(r)
            db.flush()
            print(f"  ✓ {r.Name} → {spec['user'].DisplayName}")
        else:
            r.AssignedUserId = spec["user"].UserId
            r.IsOptimized = spec["is_optimized"]
            print(f"  · {r.Name} (asignación actualizada)")

        # PDVs
        existing_pdv_ids = {rp.PdvId for rp in db.query(RoutePdv).filter(RoutePdv.RouteId == r.RouteId).all()}
        for i, p in enumerate(spec["pdvs"]):
            if p.PdvId not in existing_pdv_ids:
                db.add(RoutePdv(RouteId=r.RouteId, PdvId=p.PdvId, SortOrder=i, Priority=3))
            # Auto-asignar TM Rep al PDV
            p.AssignedUserId = spec["user"].UserId

        # Form vinculado
        rf = db.query(RouteForm).filter(RouteForm.RouteId == r.RouteId, RouteForm.FormId == form.FormId).first()
        if not rf:
            db.add(RouteForm(RouteId=r.RouteId, FormId=form.FormId, SortOrder=0))

        # Días: hoy, mañana, pasado mañana
        # Para cada día creamos el RouteDay + sus RouteDayPdv (planificación concreta del día)
        from datetime import time as dtime
        # Ventanas horarias planificadas (1 PDV cada ~45 min, arrancando 9:00)
        windows = [
            (dtime(9, 0),  dtime(9, 45)),
            (dtime(10, 0), dtime(10, 45)),
            (dtime(11, 0), dtime(11, 45)),
            (dtime(12, 0), dtime(12, 45)),
            (dtime(14, 0), dtime(14, 45)),
            (dtime(15, 0), dtime(15, 45)),
        ]

        for d in [TODAY, TOMORROW, DAY_AFTER]:
            rd = db.query(RouteDay).filter(
                RouteDay.RouteId == r.RouteId,
                RouteDay.WorkDate == d,
            ).first()
            if not rd:
                rd = RouteDay(
                    RouteId=r.RouteId,
                    WorkDate=d,
                    AssignedUserId=spec["user"].UserId,
                    Status="PLANNED" if d != TODAY else "IN_PROGRESS",
                )
                db.add(rd)
                db.flush()

            # Limpiar RouteDayPdv viejos del demo y volver a crearlos
            db.query(RouteDayPdv).filter(RouteDayPdv.RouteDayId == rd.RouteDayId).delete()
            db.flush()

            # Estados variados SOLO para HOY (los otros días: todo PENDING)
            today_statuses_carlos = ["DONE", "DONE", "IN_PROGRESS", "PENDING", "PENDING", "PENDING"]
            today_statuses_lucia  = ["DONE", "PENDING", "PENDING", "PENDING", "PENDING", "PENDING"]
            statuses_today = today_statuses_carlos if spec["user"].UserId == carlos.UserId else today_statuses_lucia

            priorities_pattern = [1, 3, 3, 2, 3, 5]  # alta, normal, normal, alta-media, normal, baja

            for i, p in enumerate(spec["pdvs"]):
                if d == TODAY:
                    exec_status = statuses_today[i] if i < len(statuses_today) else "PENDING"
                else:
                    exec_status = "PENDING"
                w_from, w_to = windows[i] if i < len(windows) else (None, None)
                priority = priorities_pattern[i] if i < len(priorities_pattern) else 3
                db.add(RouteDayPdv(
                    RouteDayId=rd.RouteDayId,
                    PdvId=p.PdvId,
                    PlannedOrder=i,
                    PlannedWindowFrom=w_from,
                    PlannedWindowTo=w_to,
                    Priority=priority,
                    ExecutionStatus=exec_status,
                ))
        routes.append(r)

    db.commit()
    print(f"  ✓ {len(routes)} rutas activas con días {TODAY} / {TOMORROW} / {DAY_AFTER}")
    return routes


# ==========================================================================
# 8. PDV Notes pendientes (TODOs dejados por reps anteriores)
# ==========================================================================
DEMO_NOTES = [
    # Notas en PDVs de la Ruta Norte (Carlos) — los más visibles en demo
    (2, "Hablar con Don Pedro sobre el reposicionamiento de cigarreras. La de la izquierda quedó tapada con productos de la competencia.", 5),
    (2, "El dueño pidió cambiar el horario de visita: ahora prefiere por la tarde después de las 16hs.", 2),
    (3, "Pasar a buscar el material POP que quedó pendiente de la última visita. Está atrás del mostrador.", 3),
    (3, "Verificar precio publicado vs precio en sistema. Hay desfase en Marlboro 20s — el cartel dice $2.450 pero está vendiendo a $2.520.", 1),
    (4, "Reposición de stock pendiente — pedir 5 cartones de Philip Morris.", 1),
    (5, "El kiosquero comentó que la competencia (Lucky Strike) le bajó el precio. Confirmar política comercial.", 4),
    # Notas en PDVs de la Ruta Centro (Lucía)
    (6, "Cumple del dueño la próxima semana — llevar regalo institucional.", 6),
    (8, "El local cerró por reformas hasta el 20/04. Reagendar visita.", 2),
]


def seed_pdv_notes(db: Session, pdvs: list[PDV], users: dict[str, User]) -> None:
    print("→ Notas pendientes (TODOs por PDV)")
    # Limpiar notas demo previas para evitar duplicados
    db.query(PdvNote).filter(
        PdvNote.PdvId.in_([p.PdvId for p in pdvs]),
        PdvNote.Content.like("[DEMO]%"),
    ).delete(synchronize_session=False)

    martin = users["martin@demo.com"]
    paula = users["paula@demo.com"]
    authors = [martin, paula]

    for idx, (pdv_idx, content, days_ago) in enumerate(DEMO_NOTES):
        author = authors[idx % len(authors)]
        n = PdvNote(
            PdvId=pdvs[pdv_idx].PdvId,
            Content=f"[DEMO] {content}",
            CreatedByUserId=author.UserId,
            CreatedAt=datetime.now(timezone.utc) - timedelta(days=days_ago),
            IsResolved=False,
        )
        db.add(n)
    db.commit()
    print(f"  ✓ {len(DEMO_NOTES)} notas pendientes creadas")


# ==========================================================================
# 9. Visitas históricas cerradas (para que reportes muestren datos)
# ==========================================================================
def seed_historical_visits(
    db: Session,
    pdvs: list[PDV],
    users: dict[str, User],
    form: Form,
) -> None:
    print("→ Visitas históricas (últimos 30 días)")
    # Limpiar visitas demo previas
    demo_visits = db.query(Visit).filter(Visit.CloseReason.like("[DEMO]%")).all()
    for v in demo_visits:
        db.query(VisitAnswer).filter(VisitAnswer.VisitId == v.VisitId).delete()
        db.query(VisitCheck).filter(VisitCheck.VisitId == v.VisitId).delete()
        db.delete(v)
    db.flush()

    questions = db.query(FormQuestion).filter(FormQuestion.FormId == form.FormId).order_by(FormQuestion.SortOrder).all()
    rng = random.Random(42)

    carlos = users["carlos@demo.com"]
    lucia = users["lucia@demo.com"]

    rep_pdv_pairs = [
        (carlos, pdvs[0]), (carlos, pdvs[1]), (carlos, pdvs[2]),
        (carlos, pdvs[3]), (carlos, pdvs[4]), (carlos, pdvs[5]),
        (lucia, pdvs[6]), (lucia, pdvs[7]), (lucia, pdvs[8]),
        (lucia, pdvs[9]), (lucia, pdvs[10]), (lucia, pdvs[11]),
    ]

    visit_count = 0
    for rep, pdv in rep_pdv_pairs:
        # 3-5 visitas por par para tener buen histórico
        for n_visit in range(rng.randint(3, 5)):
            days_ago = rng.randint(1, 25)
            opened = datetime.now(timezone.utc) - timedelta(days=days_ago, hours=rng.randint(9, 17), minutes=rng.randint(0, 59))
            duration_min = rng.randint(8, 35)
            closed = opened + timedelta(minutes=duration_min)
            v = Visit(
                PdvId=pdv.PdvId,
                UserId=rep.UserId,
                Status="CLOSED",
                OpenedAt=opened,
                ClosedAt=closed,
                FormId=form.FormId,
                FormVersion=1,
                FormStatus="SUBMITTED",
                SubmittedAt=closed,
                CloseReason=f"[DEMO] Visita {n_visit+1} histórica",
            )
            db.add(v)
            db.flush()

            # Respuestas
            for q in questions:
                ans = VisitAnswer(VisitId=v.VisitId, QuestionId=q.QuestionId)
                if q.QType == "number":
                    if "marlboro" in q.KeyName:
                        ans.ValueNumber = round(rng.uniform(2400, 2600), 2)
                    elif "philip" in q.KeyName:
                        ans.ValueNumber = round(rng.uniform(2300, 2500), 2)
                    else:
                        ans.ValueNumber = round(rng.uniform(100, 1000), 2)
                elif q.QType == "checkbox":
                    ans.ValueBool = rng.random() > 0.2
                elif q.QType == "text":
                    ans.ValueText = rng.choice(["Lucky Strike, Camel", "Philip Morris", "—", "Marlboro, Lucky"])
                else:
                    ans.ValueText = rng.choice([
                        "PDV en buen estado, sin novedades.",
                        "Stock alto. Dueño pide más cigarreras.",
                        "Tránsito normal. Sin incidencias.",
                        "El dueño preguntó por nueva campaña.",
                    ])
                db.add(ans)

            # GPS check IN/OUT
            db.add(VisitCheck(VisitId=v.VisitId, CheckType="IN", Ts=opened, Lat=pdv.Lat, Lon=pdv.Lon, AccuracyMeters=10))
            db.add(VisitCheck(VisitId=v.VisitId, CheckType="OUT", Ts=closed, Lat=pdv.Lat, Lon=pdv.Lon, AccuracyMeters=10))
            visit_count += 1

    db.commit()
    print(f"  ✓ {visit_count} visitas históricas creadas con respuestas + GPS")

    # ----- Visitas de HOY (1 cerrada + 1 en progreso para Carlos) -----
    today_morning = datetime.now(timezone.utc).replace(hour=9, minute=15, second=0, microsecond=0)

    # Visita 1: ya cerrada (PDV índice 0)
    v_done = Visit(
        PdvId=pdvs[0].PdvId,
        UserId=carlos.UserId,
        Status="CLOSED",
        OpenedAt=today_morning,
        ClosedAt=today_morning + timedelta(minutes=22),
        FormId=form.FormId,
        FormVersion=1,
        FormStatus="SUBMITTED",
        SubmittedAt=today_morning + timedelta(minutes=22),
        CloseReason="[DEMO] Visita HOY cerrada",
    )
    db.add(v_done)
    db.flush()
    for q in questions:
        ans = VisitAnswer(VisitId=v_done.VisitId, QuestionId=q.QuestionId)
        if q.QType == "number":
            ans.ValueNumber = round(rng.uniform(2400, 2600), 2)
        elif q.QType == "checkbox":
            ans.ValueBool = True
        else:
            ans.ValueText = "Visita normal, sin novedades."
        db.add(ans)
    db.add(VisitCheck(VisitId=v_done.VisitId, CheckType="IN", Ts=today_morning, Lat=pdvs[0].Lat, Lon=pdvs[0].Lon, AccuracyMeters=8))
    db.add(VisitCheck(VisitId=v_done.VisitId, CheckType="OUT", Ts=today_morning + timedelta(minutes=22), Lat=pdvs[0].Lat, Lon=pdvs[0].Lon, AccuracyMeters=10))

    # Visita 2: ya cerrada también (PDV índice 1)
    v_done2_open = today_morning + timedelta(minutes=35)
    v_done2 = Visit(
        PdvId=pdvs[1].PdvId,
        UserId=carlos.UserId,
        Status="CLOSED",
        OpenedAt=v_done2_open,
        ClosedAt=v_done2_open + timedelta(minutes=18),
        FormId=form.FormId,
        FormVersion=1,
        FormStatus="SUBMITTED",
        SubmittedAt=v_done2_open + timedelta(minutes=18),
        CloseReason="[DEMO] Visita HOY 2 cerrada",
    )
    db.add(v_done2)
    db.flush()
    for q in questions:
        ans = VisitAnswer(VisitId=v_done2.VisitId, QuestionId=q.QuestionId)
        if q.QType == "number":
            ans.ValueNumber = round(rng.uniform(2400, 2600), 2)
        elif q.QType == "checkbox":
            ans.ValueBool = True
        else:
            ans.ValueText = "Stock OK. Cigarrera bien posicionada."
        db.add(ans)
    db.add(VisitCheck(VisitId=v_done2.VisitId, CheckType="IN", Ts=v_done2_open, Lat=pdvs[1].Lat, Lon=pdvs[1].Lon, AccuracyMeters=8))
    db.add(VisitCheck(VisitId=v_done2.VisitId, CheckType="OUT", Ts=v_done2_open + timedelta(minutes=18), Lat=pdvs[1].Lat, Lon=pdvs[1].Lon, AccuracyMeters=10))

    # Visita 3: en progreso AHORA (PDV índice 2 = Autoservicio Belgrano)
    v_inprog_open = datetime.now(timezone.utc) - timedelta(minutes=12)
    v_inprog = Visit(
        PdvId=pdvs[2].PdvId,
        UserId=carlos.UserId,
        Status="OPEN",
        OpenedAt=v_inprog_open,
        ClosedAt=None,
        FormId=form.FormId,
        FormVersion=1,
        FormStatus="DRAFT",
        CloseReason="[DEMO] Visita HOY en curso",
    )
    db.add(v_inprog)
    db.flush()
    db.add(VisitCheck(VisitId=v_inprog.VisitId, CheckType="IN", Ts=v_inprog_open, Lat=pdvs[2].Lat, Lon=pdvs[2].Lon, AccuracyMeters=12))

    db.commit()
    print(f"  ✓ Visitas de HOY: 2 cerradas + 1 en progreso (Carlos)")


# ==========================================================================
# Main
# ==========================================================================
def main() -> None:
    print("=" * 70)
    print("SEED DEMO — Trade Marketing")
    print(f"Hoy: {TODAY}  ·  Mañana: {TOMORROW}  ·  Pasado mañana: {DAY_AFTER}")
    print("=" * 70)

    run_pending_migration()

    db: Session = SessionLocal()
    try:
        zone, roles = seed_roles_and_zone(db)
        users = seed_users(db, zone, roles)
        channels = seed_channels(db)
        pdvs = seed_pdvs(db, zone, channels)
        form = seed_form(db)
        seed_mandatory_activity(db, form)
        seed_routes(db, pdvs, users, form, zone)
        seed_pdv_notes(db, pdvs, users)
        seed_historical_visits(db, pdvs, users, form)

        print()
        print("=" * 70)
        print("DEMO LISTA ✓")
        print("=" * 70)
        print()
        print("USUARIOS PARA EL LOGIN:")
        for email, name, role, pw in USERS:
            print(f"  {role:10s}  {email:25s}  {pw}")
        print()
        print("FECHAS:")
        print(f"  Hoy:           {TODAY}")
        print(f"  Mañana:        {TOMORROW}")
        print(f"  Pasado mañana: {DAY_AFTER}")
        print()
        print("Tip: Logueate como `carlos@demo.com` para ver Ruta Norte (4 PDVs, optimizada)")
        print("     o como `lucia@demo.com` para ver Ruta Centro (4 PDVs).")
        print("     Logueate como `admin@demo.com` para ver el panel admin con reportes.")
        print()
    finally:
        db.close()


if __name__ == "__main__":
    main()
