"""Reporte de comportamiento de los trades por mail (semanal / mensual).

- **Semanal**: los lunes, semana cerrada lun-dom anterior.
- **Mensual**: el día 1, mes anterior cerrado.
- Un mail por suscripción (`BehaviorReportSubscription`) con los trades de su
  alcance; cada mail lleva su propio token → página pública `/r/<token>` que
  vence a los `EXPIRY_DAYS` días. El snapshot (tiles + anomalías + fila por
  trade) queda congelado en `BehaviorReport.Payload`; el detalle de un trade se
  recalcula con `build_behavior` sobre el mismo rango.
- Idempotente: un solo envío por (suscripción, tipo, período) — índice único.
  Si el envío falló (`SendError`), la próxima corrida lo reintenta.

Reusa `services/behavior.py` tal cual: un `build_behavior` por trade (≈5
queries c/u), memoizado dentro de la corrida para no recalcular un trade que
aparece en varias suscripciones.
"""
from __future__ import annotations

import json
import logging
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import BehaviorReport, BehaviorReportSubscription, Role, User, UserRole
from .behavior import _SEVERIDAD, build_behavior
from .kpi_engine import BUSINESS_TZ
from .mailer import MailError, send_mail

log = logging.getLogger(__name__)

KIND_WEEKLY = "weekly"
KIND_MONTHLY = "monthly"
KIND_TEST = "test"
KINDS = (KIND_WEEKLY, KIND_MONTHLY)

EXPIRY_DAYS = 30
TOP_ANOMALIES = 5
MAX_ANOMALIES_PER_TRADE = 2

SCOPES = ("all", "team", "custom")

ALERT_LABELS = {
    "sin_gps": "Sin GPS",
    "fuera_perimetro": "Fuera de perímetro",
    "visita_corta": "Visitas cortas",
    "visita_abierta": "Visitas sin cerrar",
    "plan_sin_visitas": "Plan sin visitas",
    "plan_no_visitado": "Planificados no visitados",
    "orden_distinto": "Orden distinto al plan",
    "on_tarde": "ON tarde",
    "off_temprano": "OFF temprano",
    "bateria_baja": "Batería baja",
}
_SEV_WEIGHT = {"alta": 3, "media": 2, "baja": 1}
_DAY_TIPOS = {"on_tarde", "off_temprano", "plan_sin_visitas", "orden_distinto"}
_VISIT_TIPOS = {"sin_gps", "fuera_perimetro", "visita_corta", "visita_abierta"}

_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
          "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
_DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


# ---------------------------------------------------------------------------
# Períodos
# ---------------------------------------------------------------------------

def utcnow() -> datetime:
    """UTC naive (así se guardan ExpiresAt / SentAt)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def today_ar() -> date:
    return datetime.now(BUSINESS_TZ).date()


def last_closed_week(today: date) -> tuple[date, date]:
    """Lunes a domingo de la semana anterior a la de `today`."""
    monday = today - timedelta(days=today.weekday() + 7)
    return monday, monday + timedelta(days=6)


def previous_month(today: date) -> tuple[date, date]:
    last = today.replace(day=1) - timedelta(days=1)
    return last.replace(day=1), last


def period_for(kind: str, today: date) -> tuple[date, date]:
    return last_closed_week(today) if kind == KIND_WEEKLY else previous_month(today)


def due_kinds(today: date) -> list[str]:
    """Qué reportes tocan hoy: lunes → semanal; día 1 → mensual."""
    kinds = []
    if today.weekday() == 0:
        kinds.append(KIND_WEEKLY)
    if today.day == 1:
        kinds.append(KIND_MONTHLY)
    return kinds


def period_label(kind: str, f: date, t: date) -> str:
    """'lunes 14 al domingo 20 de septiembre de 2026' / 'septiembre 2026'."""
    if kind == KIND_MONTHLY:
        return f"{_MESES[f.month - 1]} {f.year}"
    left = f"{_DIAS[f.weekday()]} {f.day}"
    if f.month != t.month:
        left += f" de {_MESES[f.month - 1]}"
        if f.year != t.year:
            left += f" de {f.year}"
    return f"{left} al {_DIAS[t.weekday()]} {t.day} de {_MESES[t.month - 1]} de {t.year}"


# ---------------------------------------------------------------------------
# Organización: vendedores y sub-árboles
# ---------------------------------------------------------------------------

class Org:
    """Snapshot de usuarios activos: vendedores y árbol de jefes (1 query)."""

    def __init__(self, db: Session):
        rows = (
            db.query(User.UserId, User.DisplayName, User.Email, User.ManagerUserId, Role.Name)
            .outerjoin(UserRole, UserRole.UserId == User.UserId)
            .outerjoin(Role, Role.RoleId == UserRole.RoleId)
            .filter(User.IsActive == True)  # noqa: E712
            .all()
        )
        self.users: dict[int, tuple[str, str]] = {}
        self.vendedores: dict[int, str] = {}
        self.children: dict[int, list[int]] = {}
        for uid, name, email, mid, role in rows:
            if uid not in self.users:
                self.users[uid] = (name, email)
                if mid is not None:
                    self.children.setdefault(mid, []).append(uid)
            if (role or "").lower() == "vendedor":
                self.vendedores[uid] = name

    def subtree(self, root: int) -> set[int]:
        out: set[int] = set()
        frontier = [root]
        while frontier:
            nxt = []
            for u in frontier:
                for c in self.children.get(u, []):
                    if c not in out:
                        out.add(c)
                        nxt.append(c)
            frontier = nxt
        return out

    def team_trades(self, root: int) -> list[int]:
        return sorted(u for u in self.subtree(root) if u in self.vendedores)


def parse_trade_ids(raw: Optional[str]) -> list[int]:
    try:
        return [int(x) for x in json.loads(raw or "[]")]
    except (ValueError, TypeError):
        return []


def subscription_trades(sub: BehaviorReportSubscription, org: Org) -> list[int]:
    if sub.Scope == "all":
        ids = list(org.vendedores)
    elif sub.Scope == "team":
        ids = org.team_trades(sub.ScopeUserId) if sub.ScopeUserId else []
    else:
        ids = [u for u in parse_trade_ids(sub.TradeIds) if u in org.vendedores]
    return sorted(ids, key=lambda u: org.vendedores[u].lower())


def sync_auto_subscriptions(db: Session) -> int:
    """Crea (desactivada) una suscripción `team` para cada jefe activo con
    vendedores a cargo que todavía no tenga la suya. Devuelve cuántas creó."""
    org = Org(db)
    existing = {u for (u,) in db.query(BehaviorReportSubscription.UserId).filter(
        BehaviorReportSubscription.UserId.isnot(None)).all()}
    created = 0
    for uid, (name, email) in org.users.items():
        if uid in existing or uid in org.vendedores or not org.team_trades(uid):
            continue
        db.add(BehaviorReportSubscription(
            Email=email, Name=name, Scope="team", ScopeUserId=uid, UserId=uid,
            WeeklyEnabled=True, MonthlyEnabled=True, IsActive=False, AutoCreated=True,
        ))
        created += 1
    if created:
        db.commit()
    return created


# ---------------------------------------------------------------------------
# Payload
# ---------------------------------------------------------------------------

def _trade_row(beh: dict) -> dict:
    r = beh["resumen"]
    counts: dict[str, int] = {}
    alta = 0
    for a in beh["alertas"]:
        counts[a["tipo"]] = counts.get(a["tipo"], 0) + 1
        alta += a["severidad"] == "alta"
    visitas = r["visitas"]
    return {
        "userId": beh["userId"],
        "userName": beh["userName"],
        "dias": r["dias"],
        "visitas": visitas,
        "pdvs": r["pdvs"],
        "pdvsPorDia": r["pdvsPorDia"],
        "planificados": r["planificados"],
        "planVisitados": r["planVisitados"],
        "planPct": r["planPct"],
        "gpsPct": round(100 * (visitas - r["visitasSinGps"]) / visitas) if visitas else None,
        "visitasSinGps": r["visitasSinGps"],
        "fueraPerimetro": r["fueraPerimetro"],
        "diasConPlanSinVisitas": r["diasConPlanSinVisitas"],
        "onProm": r["onProm"],
        "offProm": r["offProm"],
        "durPromMin": r["durPromMin"],
        "kmLinea": r["kmLinea"],
        "ordenRespetadoPct": r["ordenRespetadoPct"],
        "alertas": counts,
        "alertasTotal": len(beh["alertas"]),
        "alertasAlta": alta,
    }


def _anomaly_dato(tipo: str, n: int, row: dict) -> str:
    if tipo in _DAY_TIPOS:
        return f"{n} día{'s' if n != 1 else ''}"
    if tipo in _VISIT_TIPOS:
        return f"{n} de {row['visitas']} visitas"
    if tipo == "plan_no_visitado":
        return f"{n} de {row['planificados']} PDVs"
    return f"{n} registro{'s' if n != 1 else ''}"


def top_anomalies(rows: list[dict], limit: int = TOP_ANOMALIES) -> list[dict]:
    """Las `limit` anomalías más relevantes (trade + tipo + dato): primero por
    severidad, después por cantidad; a lo sumo `MAX_ANOMALIES_PER_TRADE` por
    trade para que no se lo coma uno solo."""
    cands = []
    for row in rows:
        for tipo, n in row["alertas"].items():
            sev = _SEVERIDAD[tipo]
            cands.append((_SEV_WEIGHT[sev], n, row, tipo, sev))
    cands.sort(key=lambda c: (-c[0], -c[1], c[2]["userName"]))
    out, per_trade = [], {}
    for _, n, row, tipo, sev in cands:
        if per_trade.get(row["userId"], 0) >= MAX_ANOMALIES_PER_TRADE:
            continue
        per_trade[row["userId"]] = per_trade.get(row["userId"], 0) + 1
        out.append({
            "userId": row["userId"], "userName": row["userName"], "tipo": tipo,
            "label": ALERT_LABELS.get(tipo, tipo), "dato": _anomaly_dato(tipo, n, row), "severidad": sev,
        })
        if len(out) >= limit:
            break
    return out


def build_payload(kind: str, f: date, t: date, recipient_name: str, trade_ids: list[int],
                  get_behavior: Callable[[int], dict]) -> dict[str, Any]:
    rows = [_trade_row(get_behavior(uid)) for uid in trade_ids]
    # Sin actividad en el período (vacaciones, licencia, baja): no aparecen.
    rows = [r for r in rows if r["visitas"] or r["planificados"]]
    rows.sort(key=lambda r: (-r["alertasAlta"], -r["alertasTotal"], r["userName"].lower()))

    visitas = sum(r["visitas"] for r in rows)
    dias = sum(r["dias"] for r in rows)
    plan = sum(r["planificados"] for r in rows)
    plan_ok = sum(r["planVisitados"] for r in rows)
    sin_gps = sum(r["visitasSinGps"] for r in rows)
    kpis = {
        "trades": len(rows),
        "visitas": visitas,
        "diasTrabajados": dias,
        "pdvsPorDia": round(sum(r["pdvsPorDia"] * r["dias"] for r in rows) / dias, 1) if dias else 0.0,
        "planPct": round(100 * plan_ok / plan) if plan else None,
        "gpsPct": round(100 * (visitas - sin_gps) / visitas) if visitas else None,
        "fueraPerimetro": sum(r["fueraPerimetro"] for r in rows),
        "diasConPlanSinVisitas": sum(r["diasConPlanSinVisitas"] for r in rows),
        "alertasAlta": sum(r["alertasAlta"] for r in rows),
        "alertasTotal": sum(r["alertasTotal"] for r in rows),
        "kmLinea": round(sum(r["kmLinea"] for r in rows), 1),
    }
    return {
        "kind": kind,
        "from": f.isoformat(),
        "to": t.isoformat(),
        "periodLabel": period_label(kind, f, t),
        "recipientName": recipient_name,
        "kpis": kpis,
        "anomalias": top_anomalies(rows),
        "trades": rows,
    }


# ---------------------------------------------------------------------------
# Envío
# ---------------------------------------------------------------------------

def report_url(token: str) -> str:
    from ..config import settings
    return f"{settings.public_app_url.rstrip('/')}/r/{token}"


def _deliver(db: Session, report: BehaviorReport, payload: dict, sub_name: str, test: bool) -> bool:
    from .behavior_report_mail import render_mail

    subject, html, plain = render_mail(payload, report_url(report.Token), report.ExpiresAt.date(), test)
    try:
        send_mail(report.Email, subject, html, plain, to_name=sub_name)
        report.SentAt = utcnow()
        report.SendError = None
        ok = True
    except MailError as e:
        log.error("Reporte %s a %s falló: %s", report.ReportId, report.Email, e)
        report.SendError = str(e)[:1000]
        ok = False
    db.commit()
    return ok


def _new_report(sub: BehaviorReportSubscription, kind: str, f: date, t: date, payload: dict,
                email: Optional[str] = None) -> BehaviorReport:
    return BehaviorReport(
        Token=secrets.token_hex(32), SubscriptionId=sub.SubscriptionId, Kind=kind,
        PeriodFrom=f, PeriodTo=t, Email=email or sub.Email, Payload=json.dumps(payload, ensure_ascii=False),
        ExpiresAt=utcnow() + timedelta(days=EXPIRY_DAYS),
    )


def _behavior_getter(db: Session, f: date, t: date) -> Callable[[int], dict]:
    memo: dict[int, dict] = {}

    def get(uid: int) -> dict:
        if uid not in memo:
            memo[uid] = build_behavior(db, uid, f, t)
        return memo[uid]
    return get


def send_period(db: Session, kind: str, f: date, t: date) -> dict:
    """Envía el reporte `kind` de [f, t] a cada suscripción activa que lo tenga
    habilitado. Salta las ya enviadas; reintenta las que fallaron."""
    enabled_col = BehaviorReportSubscription.WeeklyEnabled if kind == KIND_WEEKLY else BehaviorReportSubscription.MonthlyEnabled
    subs = db.query(BehaviorReportSubscription).filter(
        BehaviorReportSubscription.IsActive == True, enabled_col == True,  # noqa: E712
    ).order_by(BehaviorReportSubscription.SubscriptionId).all()
    org = Org(db)
    get_behavior = _behavior_getter(db, f, t)
    stats = {"kind": kind, "from": f.isoformat(), "to": t.isoformat(), "sent": 0, "skipped": 0, "failed": 0}

    for sub in subs:
        report = db.query(BehaviorReport).filter(
            BehaviorReport.SubscriptionId == sub.SubscriptionId,
            BehaviorReport.Kind == kind, BehaviorReport.PeriodFrom == f,
        ).first()
        # Ya enviado, o en curso (otra corrida lo creó y todavía no terminó):
        # solo se reintenta lo que falló explícitamente.
        if report is not None and (report.SentAt is not None or report.SendError is None):
            stats["skipped"] += 1
            continue
        if report is None:
            payload = build_payload(kind, f, t, sub.Name, subscription_trades(sub, org), get_behavior)
            report = _new_report(sub, kind, f, t, payload)
            db.add(report)
            try:
                db.commit()
            except IntegrityError:
                # Otra corrida concurrente ya lo creó.
                db.rollback()
                stats["skipped"] += 1
                continue
        else:
            payload = json.loads(report.Payload)
        ok = _deliver(db, report, payload, sub.Name, test=False)
        stats["sent" if ok else "failed"] += 1
    return stats


def run_scheduled(db: Session, today: Optional[date] = None) -> list[dict]:
    """Lo que dispara el cron diario: sincroniza las suscripciones automáticas
    y manda los reportes que tocan hoy (ninguno, semanal, mensual o ambos)."""
    today = today or today_ar()
    sync_auto_subscriptions(db)
    return [send_period(db, kind, *period_for(kind, today)) for kind in due_kinds(today)]


def send_test(db: Session, sub: BehaviorReportSubscription, kind: str, to: Optional[str] = None,
              today: Optional[date] = None) -> BehaviorReport:
    """"Resumen de prueba": el último período cerrado de `kind`, repetible."""
    f, t = period_for(kind, today or today_ar())
    payload = build_payload(kind, f, t, sub.Name, subscription_trades(sub, Org(db)), _behavior_getter(db, f, t))
    report = _new_report(sub, KIND_TEST, f, t, payload, email=to)
    db.add(report)
    db.commit()
    _deliver(db, report, payload, sub.Name, test=True)
    return report


def preview_payload(db: Session, sub: BehaviorReportSubscription, kind: str,
                    today: Optional[date] = None) -> dict:
    f, t = period_for(kind, today or today_ar())
    return build_payload(kind, f, t, sub.Name, subscription_trades(sub, Org(db)), _behavior_getter(db, f, t))
