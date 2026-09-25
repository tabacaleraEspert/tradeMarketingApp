"""Tests del reporte de comportamiento por mail (`services/behavior_report.py`,
`routers/behavior_reports.py`). Mailer en modo dev (sin ACS): los mails quedan
en `mailer.OUTBOX`.

Los datos se commitean (el envío y los endpoints commitean en su propia sesión),
así que cada test usa emails/usuarios únicos y verifica SOLO sus filas.
"""
import json
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.auth import create_access_token
from app.config import settings
from app.database import engine
from app.main import app
from app.models import (
    PDV as PDVModel,
    BehaviorReport,
    BehaviorReportSubscription,
    Role as RoleModel,
    User as UserModel,
    UserRole as UserRoleModel,
    Visit as VisitModel,
    VisitCheck as VisitCheckModel,
)
from app.services import behavior_report as R
from app.services import mailer

# Semana cerrada lun 13 → dom 19 de abril de 2026; "hoy" = lun 20.
MON, SUN, TODAY = date(2026, 4, 13), date(2026, 4, 19), date(2026, 4, 20)
LAT, LON = -34.6, -58.4


def ar(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hh, mm) + timedelta(hours=3)


@pytest.fixture()
def db():
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


@pytest.fixture(autouse=True)
def _clean_outbox():
    mailer.OUTBOX.clear()
    yield
    mailer.OUTBOX.clear()


def _uid():
    return uuid.uuid4().hex[:8]


def _role(db, name):
    role = db.query(RoleModel).filter(RoleModel.Name == name).first()
    if not role:
        role = RoleModel(Name=name)
        db.add(role)
        db.flush()
    return role


def _user(db, role, name=None, manager=None, active=True):
    u = UserModel(
        Email=f"{role}_{_uid()}@rep.test", DisplayName=name or f"{role} {_uid()}", PasswordHash="x",
        IsActive=active, ManagerUserId=manager.UserId if manager else None,
    )
    db.add(u)
    db.flush()
    db.add(UserRoleModel(UserId=u.UserId, RoleId=_role(db, role).RoleId))
    db.flush()
    return u


def _visit(db, user, d, hh=9, dist=5, gps=True):
    p = PDVModel(Name=f"PDV_{_uid()}", IsActive=True, Lat=LAT, Lon=LON)
    db.add(p)
    db.flush()
    v = VisitModel(PdvId=p.PdvId, UserId=user.UserId, OpenedAt=ar(d, hh), Status="CLOSED",
                   ClosedAt=ar(d, hh, 20))
    db.add(v)
    db.flush()
    if gps:
        db.add(VisitCheckModel(VisitId=v.VisitId, CheckType="IN", Ts=ar(d, hh), Lat=LAT, Lon=LON,
                               AccuracyMeters=10, DistanceToPdvM=dist))
        db.add(VisitCheckModel(VisitId=v.VisitId, CheckType="OUT", Ts=ar(d, hh, 20), Lat=LAT, Lon=LON,
                               AccuracyMeters=10, DistanceToPdvM=dist))
    db.flush()
    return v


def _sub(db, trades, **kw):
    s = BehaviorReportSubscription(
        Email=f"dest_{_uid()}@rep.test", Name="Destinatario", Scope="custom",
        TradeIds=json.dumps([t.UserId for t in trades]), WeeklyEnabled=True, MonthlyEnabled=True,
        IsActive=True, AutoCreated=False, **kw,
    )
    db.add(s)
    db.flush()
    return s


def _mails_to(email):
    return [m for m in mailer.OUTBOX if m["to"] == email]


# ---------------------------------------------------------------------------
# Períodos
# ---------------------------------------------------------------------------

def test_semana_cerrada_y_mes_anterior():
    assert R.last_closed_week(date(2026, 9, 24)) == (date(2026, 9, 14), date(2026, 9, 20))
    assert R.last_closed_week(date(2026, 9, 21)) == (date(2026, 9, 14), date(2026, 9, 20))
    assert R.previous_month(date(2026, 10, 1)) == (date(2026, 9, 1), date(2026, 9, 30))
    assert R.previous_month(date(2026, 1, 1)) == (date(2025, 12, 1), date(2025, 12, 31))


def test_due_kinds():
    assert R.due_kinds(date(2026, 9, 21)) == ["weekly"]            # lunes
    assert R.due_kinds(date(2026, 10, 1)) == ["monthly"]           # jueves 1°
    assert R.due_kinds(date(2026, 6, 1)) == ["weekly", "monthly"]  # lunes 1°
    assert R.due_kinds(date(2026, 9, 24)) == []


def test_period_label():
    assert R.period_label("weekly", date(2026, 9, 14), date(2026, 9, 20)) == \
        "lunes 14 al domingo 20 de septiembre de 2026"
    assert R.period_label("weekly", date(2026, 9, 28), date(2026, 10, 4)) == \
        "lunes 28 de septiembre al domingo 4 de octubre de 2026"
    assert R.period_label("weekly", date(2025, 12, 29), date(2026, 1, 4)) == \
        "lunes 29 de diciembre de 2025 al domingo 4 de enero de 2026"
    assert R.period_label("monthly", date(2026, 9, 1), date(2026, 9, 30)) == "septiembre 2026"


# ---------------------------------------------------------------------------
# Anomalías
# ---------------------------------------------------------------------------

def _row(uid, name, alertas, visitas=10, planificados=10):
    return {"userId": uid, "userName": name, "alertas": alertas, "visitas": visitas, "planificados": planificados}


def test_top_anomalias_orden_tope_y_maximo_por_trade():
    rows = [
        _row(1, "Ana", {"fuera_perimetro": 4, "sin_gps": 3, "on_tarde": 2}),
        _row(2, "Beto", {"plan_sin_visitas": 1}),
        _row(3, "Caro", {"visita_corta": 5, "bateria_baja": 9}),
        _row(4, "Dani", {"orden_distinto": 1}),
    ]
    top = R.top_anomalies(rows)
    assert len(top) == 5
    # Severidad primero (alta > media > baja), después cantidad.
    assert [(a["userName"], a["tipo"]) for a in top] == [
        ("Ana", "fuera_perimetro"), ("Beto", "plan_sin_visitas"), ("Caro", "visita_corta"),
        ("Ana", "sin_gps"), ("Caro", "bateria_baja"),
    ]
    assert sum(a["userName"] == "Ana" for a in top) == 2   # tope por trade
    assert top[0]["dato"] == "4 de 10 visitas"
    assert next(a for a in top if a["tipo"] == "plan_sin_visitas")["dato"] == "1 día"


# ---------------------------------------------------------------------------
# Alcance y auto-alta
# ---------------------------------------------------------------------------

def test_alcance_team_custom_y_auto_alta(db):
    jefe = _user(db, "territory_manager")
    sub_jefe = _user(db, "ejecutivo", manager=jefe)
    v1 = _user(db, "vendedor", manager=sub_jefe)
    v2 = _user(db, "vendedor", manager=jefe)
    _user(db, "vendedor", manager=jefe, active=False)
    sin_equipo = _user(db, "ejecutivo")

    org = R.Org(db)
    assert org.team_trades(jefe.UserId) == sorted([v1.UserId, v2.UserId])
    assert org.team_trades(sub_jefe.UserId) == [v1.UserId]

    custom = BehaviorReportSubscription(Scope="custom", TradeIds=json.dumps([v2.UserId, 999999]))
    assert R.subscription_trades(custom, org) == [v2.UserId]

    R.sync_auto_subscriptions(db)
    autos = db.query(BehaviorReportSubscription).filter(
        BehaviorReportSubscription.UserId.in_([jefe.UserId, sub_jefe.UserId, sin_equipo.UserId])).all()
    assert {a.UserId for a in autos} == {jefe.UserId, sub_jefe.UserId}
    a = next(a for a in autos if a.UserId == jefe.UserId)
    assert (a.Scope, a.ScopeUserId, a.Email, a.IsActive, a.AutoCreated) == ("team", jefe.UserId, jefe.Email, False, True)

    R.sync_auto_subscriptions(db)  # no duplica
    assert db.query(BehaviorReportSubscription).filter(
        BehaviorReportSubscription.UserId == jefe.UserId).count() == 1


# ---------------------------------------------------------------------------
# Payload y envío
# ---------------------------------------------------------------------------

def test_payload_oculta_trades_sin_actividad(db):
    activo = _user(db, "vendedor", name="Activo")
    quieto = _user(db, "vendedor", name="Quieto")
    _visit(db, activo, MON)
    _visit(db, activo, MON, hh=11, dist=900)   # fuera de perímetro
    _visit(db, activo, date(2026, 4, 14), gps=False)
    p = R.build_payload("weekly", MON, SUN, "X", [activo.UserId, quieto.UserId], R._behavior_getter(db))
    assert [t["userName"] for t in p["trades"]] == ["Activo"]
    assert p["kpis"]["trades"] == 1
    assert p["kpis"]["visitas"] == 3
    assert p["kpis"]["gpsPct"] == 67
    assert p["kpis"]["fueraPerimetro"] == 1
    assert p["periodLabel"] == "lunes 13 al domingo 19 de abril de 2026"
    assert "fuera_perimetro" in {a["tipo"] for a in p["anomalias"]}
    assert len(p["anomalias"]) == 2  # tope por trade


def test_envio_semanal_idempotente_y_reintento(db, monkeypatch):
    v = _user(db, "vendedor", name="Trade Uno")
    _visit(db, v, MON, dist=900)
    sub = _sub(db, [v])
    inactiva = _sub(db, [v], )
    inactiva.IsActive = False
    db.commit()

    # 1° intento: ACS falla → queda el reporte con SendError, sin SentAt.
    def boom(*a, **k):
        raise mailer.MailError("ACS caído")
    monkeypatch.setattr(R, "send_mail", boom)
    R.send_period(db, "weekly", MON, SUN)
    rep = db.query(BehaviorReport).filter(BehaviorReport.SubscriptionId == sub.SubscriptionId).one()
    assert rep.SentAt is None and "ACS caído" in rep.SendError
    token = rep.Token

    # 2° corrida: reintenta el MISMO reporte (mismo token) y lo envía.
    monkeypatch.setattr(R, "send_mail", mailer.send_mail)
    R.send_period(db, "weekly", MON, SUN)
    db.refresh(rep)
    assert rep.SentAt is not None and rep.SendError is None and rep.Token == token
    mails = _mails_to(sub.Email)
    assert len(mails) == 1
    assert mails[0]["subject"] == "Resumen semanal de comportamiento de trades — lunes 13 al domingo 19 de abril de 2026"
    assert f"/r/{token}" in mails[0]["html"] and "Trade Uno" in mails[0]["html"]
    assert (rep.ExpiresAt - R.utcnow()).days in (29, 30)

    # 3° corrida: ya enviado → no manda de nuevo.
    R.send_period(db, "weekly", MON, SUN)
    assert len(_mails_to(sub.Email)) == 1
    assert _mails_to(inactiva.Email) == []


def test_run_scheduled_decide_por_fecha(db):
    v = _user(db, "vendedor")
    _visit(db, v, MON)
    sub = _sub(db, [v])
    sub.MonthlyEnabled = False
    db.commit()
    assert R.run_scheduled(db, date(2026, 4, 21)) == []  # martes: nada
    runs = R.run_scheduled(db, TODAY)
    assert [r["kind"] for r in runs] == ["weekly"]
    assert len(_mails_to(sub.Email)) == 1


def test_envio_de_prueba_repetible(db):
    v = _user(db, "vendedor")
    _visit(db, v, MON)
    sub = _sub(db, [v])
    db.commit()
    R.send_test(db, sub, "weekly", today=TODAY)
    R.send_test(db, sub, "weekly", to="otro@rep.test", today=TODAY)
    assert _mails_to(sub.Email)[0]["subject"].startswith("Resumen semanal de prueba")
    assert len(_mails_to("otro@rep.test")) == 1
    assert db.query(BehaviorReport).filter(BehaviorReport.SubscriptionId == sub.SubscriptionId,
                                           BehaviorReport.Kind == "test").count() == 2


# ---------------------------------------------------------------------------
# Endpoints públicos (sin JWT)
# ---------------------------------------------------------------------------

@pytest.fixture()
def anon():
    from app.routers import behavior_reports as BR
    BR._hits.clear()
    BR._DETAIL_CACHE.clear()
    with TestClient(app) as c:
        yield c


def _sent_report(db):
    v = _user(db, "vendedor", name="Trade Público")
    otro = _user(db, "vendedor")
    _visit(db, v, MON)
    sub = _sub(db, [v])
    db.commit()
    R.send_period(db, "weekly", MON, SUN)
    rep = db.query(BehaviorReport).filter(BehaviorReport.SubscriptionId == sub.SubscriptionId).one()
    return rep, v, otro


def test_publico_reporte_y_detalle(db, anon):
    rep, v, otro = _sent_report(db)
    r = anon.get(f"/public/reports/{rep.Token}")
    assert r.status_code == 200
    body = r.json()
    assert body["trades"][0]["userName"] == "Trade Público" and body["expiresAt"]
    d = anon.get(f"/public/reports/{rep.Token}/trades/{v.UserId}")
    assert d.status_code == 200
    assert d.json()["from"] == MON.isoformat() and d.json()["resumen"]["visitas"] == 1
    assert anon.get(f"/public/reports/{rep.Token}/trades/{otro.UserId}").status_code == 404


def test_publico_token_invalido_inexistente_y_vencido(db, anon):
    assert anon.get("/public/reports/nope").status_code == 404
    assert anon.get(f"/public/reports/{'a' * 64}").status_code == 404
    rep, _, _ = _sent_report(db)
    rep.ExpiresAt = R.utcnow() - timedelta(minutes=1)
    db.commit()
    assert anon.get(f"/public/reports/{rep.Token}").status_code == 410


def test_publico_rate_limit(anon):
    codes = [anon.get(f"/public/reports/{'b' * 64}").status_code for _ in range(31)]
    assert codes[:30] == [404] * 30 and codes[30] == 429


def test_cron_key(anon, monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "")
    assert anon.post("/internal/behavior-reports/run").status_code == 503
    monkeypatch.setattr(settings, "cron_secret", "s3cr3t")
    assert anon.post("/internal/behavior-reports/run", headers={"X-Cron-Key": "mal"}).status_code == 401
    r = anon.post("/internal/behavior-reports/run?date=2026-04-22", headers={"X-Cron-Key": "s3cr3t"})
    assert r.status_code == 202 and r.json() == {"date": "2026-04-22", "kinds": []}


def test_cron_envia_en_background(db, anon, monkeypatch):
    v = _user(db, "vendedor")
    _visit(db, v, MON)
    sub = _sub(db, [v])
    db.commit()
    monkeypatch.setattr(settings, "cron_secret", "s3cr3t")
    r = anon.post(f"/internal/behavior-reports/run?date={TODAY}", headers={"X-Cron-Key": "s3cr3t"})
    assert r.status_code == 202 and r.json()["kinds"] == ["weekly"]
    # TestClient ejecuta las background tasks antes de devolver.
    assert len(_mails_to(sub.Email)) == 1


# ---------------------------------------------------------------------------
# ABM admin
# ---------------------------------------------------------------------------

def test_abm_solo_admin(db, anon):
    v = _user(db, "vendedor")
    db.commit()
    tok = create_access_token(subject=v.UserId, role="vendedor")
    r = anon.get("/behavior-reports/subscriptions", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403
    assert anon.get("/behavior-reports/subscriptions").status_code == 401


def test_abm_crear_editar_preview_test_borrar(db, client):
    v = _user(db, "vendedor", name="Trade ABM")
    _visit(db, v, MON)
    db.commit()
    email = f"abm_{_uid()}@rep.test"
    base = {"Email": email, "Name": "Gerencia", "Scope": "custom", "TradeIds": [],
            "WeeklyEnabled": True, "MonthlyEnabled": False, "IsActive": True}
    assert client.post("/behavior-reports/subscriptions", json=base).status_code == 400
    assert client.post("/behavior-reports/subscriptions", json={**base, "Email": "x"}).status_code == 422
    r = client.post("/behavior-reports/subscriptions", json={**base, "TradeIds": [v.UserId]})
    assert r.status_code == 201
    sid = r.json()["subscriptionId"]
    assert r.json()["tradeIds"] == [v.UserId]

    r = client.put(f"/behavior-reports/subscriptions/{sid}", json={**base, "Scope": "all"})
    assert r.status_code == 200 and v.UserId in r.json()["tradeIds"]
    assert any(s["subscriptionId"] == sid for s in client.get("/behavior-reports/subscriptions").json())

    opts = client.get("/behavior-reports/options").json()
    assert any(t["userId"] == v.UserId for t in opts["trades"])

    html = client.get(f"/behavior-reports/subscriptions/{sid}/preview?kind=weekly")
    assert html.status_code == 200 and "Ver reporte completo" in html.text

    r = client.post(f"/behavior-reports/subscriptions/{sid}/test", json={"kind": "weekly"})
    assert r.status_code == 200 and r.json()["kind"] == "test" and r.json()["sentAt"]
    hist = client.get(f"/behavior-reports/subscriptions/{sid}/history").json()
    assert len(hist) == 1 and "/r/" in hist[0]["url"]

    assert client.delete(f"/behavior-reports/subscriptions/{sid}").status_code == 204
    assert db.query(BehaviorReport).filter(BehaviorReport.SubscriptionId == sid).count() == 0


def test_abm_no_borra_automaticas(db, client):
    s = BehaviorReportSubscription(Email=f"a_{_uid()}@rep.test", Name="Auto", Scope="all",
                                   WeeklyEnabled=True, MonthlyEnabled=True, IsActive=False, AutoCreated=True)
    db.add(s)
    db.commit()
    assert client.delete(f"/behavior-reports/subscriptions/{s.SubscriptionId}").status_code == 409


def test_rate_limit_no_se_evade_con_x_forwarded_for(anon):
    codes = [
        anon.get(f"/public/reports/{'c' * 64}", headers={"X-Forwarded-For": f"10.0.0.{i}, 200.1.1.1:5555"}).status_code
        for i in range(31)
    ]
    assert codes[30] == 429


# ---------------------------------------------------------------------------
# Comparativas (vs semana anterior / promedio semanal del mes pasado)
# ---------------------------------------------------------------------------

def test_kpi_delta():
    assert R.kpi_delta(110, 100, "count", True) == {"base": 100, "diff": 10, "pct": 10, "unit": "", "better": True}
    assert R.kpi_delta(3, 5, "count", False)["better"] is True        # menos alertas = mejor
    assert R.kpi_delta(40, 46, "pct", True) == {"base": 46, "diff": -6, "pct": None, "unit": "pp", "better": False}
    assert R.kpi_delta(5, 5, "count", True)["better"] is None
    assert R.kpi_delta(5, 0, "count", True)["pct"] is None            # sin base no hay desvío %
    assert R.kpi_delta(None, 5, "count", True) is None
    assert R.kpi_delta(8, 6, "count", None)["better"] is None         # neutro (trades)


def test_periodos_de_comparacion():
    w = R.comparison_periods("weekly", date(2026, 9, 14), date(2026, 9, 20))
    assert [(c["key"], c["from"], c["to"]) for c in w] == [
        ("prev", date(2026, 9, 7), date(2026, 9, 13)),
        ("monthAvg", date(2026, 8, 1), date(2026, 8, 31)),
    ]
    assert w[1]["label"] == "vs promedio semanal de agosto" and abs(w[1]["scale"] - 7 / 31) < 1e-9
    m = R.comparison_periods("monthly", date(2026, 9, 1), date(2026, 9, 30))
    assert [(c["key"], c["from"], c["to"], c["label"]) for c in m] == [
        ("prev", date(2026, 8, 1), date(2026, 8, 31), "vs agosto")]


def test_payload_con_comparativas(db):
    """Semana 13-19/04: 3 visitas. Semana anterior (6-12/04): 2. Marzo: 31 visitas
    → promedio semanal 31 × 7/31 = 7."""
    v = _user(db, "vendedor", name="Comparado")
    for d in (MON, date(2026, 4, 14), date(2026, 4, 15)):
        _visit(db, v, d)
    for d in (date(2026, 4, 6), date(2026, 4, 7)):
        _visit(db, v, d)
    for day in range(1, 32):
        _visit(db, v, date(2026, 3, day))
    p = R.build_payload("weekly", MON, SUN, "X", [v.UserId], R._behavior_getter(db))
    prev, avg = p["comparativas"]
    assert prev["deltas"]["visitas"] == {"base": 2, "diff": 1, "pct": 50, "unit": "", "better": True}
    assert avg["deltas"]["visitas"]["base"] == 7.0 and avg["deltas"]["visitas"]["diff"] == -4
    assert avg["deltas"]["trades"] is None                 # no escalable
    assert prev["deltas"]["gpsPct"]["unit"] == "pp"
    assert p["trades"][0]["prev"]["visitas"]["diff"] == 1


def test_mail_muestra_comparativas():
    from app.services.behavior_report_mail import fmt_delta, render_mail
    assert fmt_delta({"diff": 32, "pct": 4, "unit": "", "better": True}) == "▲ +32 (+4%)"
    assert fmt_delta({"diff": -3, "pct": None, "unit": "pp", "better": False}) == "▼ −3 pp"
    assert fmt_delta(None) == "—"
    kpis = {"trades": 1, "visitas": 3, "diasTrabajados": 3, "pdvsPorDia": 1.0, "planPct": None, "gpsPct": 100,
            "fueraPerimetro": 0, "diasConPlanSinVisitas": 0, "alertasAlta": 0, "alertasTotal": 0, "kmLinea": 0}
    d = {"base": 2, "diff": 1, "pct": 50, "unit": "", "better": True}
    payload = {"kind": "weekly", "periodLabel": "x", "kpis": kpis, "anomalias": [], "trades": [],
               "comparativas": [{"key": "prev", "label": "vs semana anterior", "short": "vs sem. ant.",
                                 "from": "2026-04-06", "to": "2026-04-12", "deltas": {"visitas": d}}]}
    _, html, plain = render_mail(payload, "https://x/r/t", date(2026, 5, 1), False)
    assert "▲ +1 (+50%)" in html and "vs sem. ant." in html and "06/04–12/04" in html
    assert "Visitas: 3 (▲ +1 (+50%) vs sem. ant.)" in plain
    # Reporte viejo sin comparativas: no rompe.
    payload.pop("comparativas")
    render_mail(payload, "https://x/r/t", date(2026, 5, 1), False)
