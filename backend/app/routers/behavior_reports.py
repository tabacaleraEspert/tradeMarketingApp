"""Reporte de comportamiento por mail — ver `services/behavior_report.py`.

Tres routers con distinta autenticación (se registran por separado en main.py):

- `router` (admin): ABM de destinatarios, envío de prueba, preview, historial.
- `internal_router`: `POST /internal/behavior-reports/run`, lo dispara el cron
  (GitHub Actions) con header `X-Cron-Key` = `CRON_SECRET`. Sin JWT.
- `public_router`: `GET /public/reports/{token}[/trades/{user_id}]`, la página
  `/r/<token>` del mail. Sin JWT: el token (256 bits, vence a los 30 días) ES
  la credencial. Rate limit por IP.
"""
from __future__ import annotations

import hmac
import json
import logging
import re
import threading
import time
from collections import deque
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import require_role
from ..config import settings
from ..database import SessionLocal, get_db
from ..models import BehaviorReport, BehaviorReportSubscription
from ..services import behavior_report as R
from ..services.behavior import build_behavior
from ..services.behavior_report_mail import render_mail
from ..utils.ttl_cache import TTLCache

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/behavior-reports",
    tags=["Reporte comportamiento (mail)"],
    dependencies=[Depends(require_role("admin"))],
)
internal_router = APIRouter(prefix="/internal/behavior-reports", tags=["Reporte comportamiento (mail)"])
public_router = APIRouter(prefix="/public/reports", tags=["Reporte comportamiento (público)"])


# ---------------------------------------------------------------------------
# Admin: destinatarios
# ---------------------------------------------------------------------------

# Sin `EmailStr` para no sumar email-validator: chequeo básico de forma.
_EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class SubscriptionIn(BaseModel):
    Email: str = Field(pattern=_EMAIL, max_length=256)
    Name: str = Field(min_length=1, max_length=120)
    Scope: Literal["all", "team", "custom"] = "custom"
    ScopeUserId: Optional[int] = None
    TradeIds: list[int] = []
    WeeklyEnabled: bool = True
    MonthlyEnabled: bool = True
    IsActive: bool = True


class TestIn(BaseModel):
    kind: Literal["weekly", "monthly"] = "weekly"
    to: Optional[str] = Field(default=None, pattern=_EMAIL, max_length=256)


def _validate(data: SubscriptionIn, org: R.Org) -> None:
    if data.Scope == "team" and (data.ScopeUserId is None or data.ScopeUserId not in org.users):
        raise HTTPException(400, "Elegí de qué jefe es el equipo")
    if data.Scope == "custom" and not data.TradeIds:
        raise HTTPException(400, "Elegí al menos un trade")


def _apply(sub: BehaviorReportSubscription, data: SubscriptionIn) -> None:
    sub.Email = data.Email.strip()
    sub.Name = data.Name.strip()
    sub.Scope = data.Scope
    sub.ScopeUserId = data.ScopeUserId if data.Scope == "team" else None
    sub.TradeIds = json.dumps(sorted(set(data.TradeIds))) if data.Scope == "custom" else None
    sub.WeeklyEnabled = data.WeeklyEnabled
    sub.MonthlyEnabled = data.MonthlyEnabled
    sub.IsActive = data.IsActive


def _last_reports(db: Session) -> dict[int, BehaviorReport]:
    out: dict[int, BehaviorReport] = {}
    for r in db.query(BehaviorReport).order_by(BehaviorReport.ReportId.desc()).limit(2000):
        if r.SubscriptionId is not None and r.SubscriptionId not in out:
            out[r.SubscriptionId] = r
    return out


def _serialize(sub: BehaviorReportSubscription, org: R.Org, last: Optional[BehaviorReport]) -> dict:
    trades = R.subscription_trades(sub, org)
    return {
        "subscriptionId": sub.SubscriptionId,
        "email": sub.Email,
        "name": sub.Name,
        "scope": sub.Scope,
        "scopeUserId": sub.ScopeUserId,
        "scopeUserName": org.users.get(sub.ScopeUserId, ("", ""))[0] if sub.ScopeUserId else None,
        "tradeIds": trades,
        "weeklyEnabled": sub.WeeklyEnabled,
        "monthlyEnabled": sub.MonthlyEnabled,
        "isActive": sub.IsActive,
        "autoCreated": sub.AutoCreated,
        "lastReport": _report_row(last) if last else None,
    }


def _report_row(r: BehaviorReport) -> dict:
    return {
        "reportId": r.ReportId,
        "kind": r.Kind,
        "from": r.PeriodFrom.isoformat(),
        "to": r.PeriodTo.isoformat(),
        "email": r.Email,
        "sentAt": r.SentAt.isoformat() if r.SentAt else None,
        "sendError": r.SendError,
        "expiresAt": r.ExpiresAt.isoformat(),
        "url": R.report_url(r.Token),
    }


def _get_sub(db: Session, sub_id: int) -> BehaviorReportSubscription:
    sub = db.get(BehaviorReportSubscription, sub_id)
    if sub is None:
        raise HTTPException(404, "Destinatario no encontrado")
    return sub


@router.get("/subscriptions")
def list_subscriptions(db: Session = Depends(get_db)):
    """Lista los destinatarios. Antes, da de alta (desactivada) la suscripción
    de cada jefe con vendedores a cargo que todavía no la tenga."""
    R.sync_auto_subscriptions(db)
    org = R.Org(db)
    last = _last_reports(db)
    subs = db.query(BehaviorReportSubscription).order_by(BehaviorReportSubscription.Name).all()
    return [_serialize(s, org, last.get(s.SubscriptionId)) for s in subs]


@router.get("/options")
def get_options(db: Session = Depends(get_db)):
    """Trades elegibles (vendedores activos) y jefes con equipo, para el ABM."""
    org = R.Org(db)
    trades = sorted(({"userId": u, "name": n} for u, n in org.vendedores.items()), key=lambda x: x["name"].lower())
    managers = []
    for uid, (name, email) in org.users.items():
        team = org.team_trades(uid)
        if team and uid not in org.vendedores:
            managers.append({"userId": uid, "name": name, "email": email, "tradeIds": team})
    managers.sort(key=lambda x: x["name"].lower())
    return {"trades": trades, "managers": managers}


@router.post("/subscriptions", status_code=201)
def create_subscription(data: SubscriptionIn, db: Session = Depends(get_db)):
    org = R.Org(db)
    _validate(data, org)
    sub = BehaviorReportSubscription(AutoCreated=False)
    _apply(sub, data)
    db.add(sub)
    db.commit()
    return _serialize(sub, org, None)


@router.put("/subscriptions/{sub_id}")
def update_subscription(sub_id: int, data: SubscriptionIn, db: Session = Depends(get_db)):
    sub = _get_sub(db, sub_id)
    org = R.Org(db)
    _validate(data, org)
    _apply(sub, data)
    db.commit()
    return _serialize(sub, org, _last_reports(db).get(sub.SubscriptionId))


@router.delete("/subscriptions/{sub_id}", status_code=204)
def delete_subscription(sub_id: int, db: Session = Depends(get_db)):
    """Borra el destinatario y sus reportes (los links enviados dejan de andar).
    Las automáticas no se borran (se volverían a crear): se desactivan."""
    sub = _get_sub(db, sub_id)
    if sub.AutoCreated:
        raise HTTPException(409, "Es automática (jefe con equipo): desactivala en vez de borrarla")
    db.query(BehaviorReport).filter(BehaviorReport.SubscriptionId == sub_id).delete()
    db.delete(sub)
    db.commit()


@router.post("/subscriptions/{sub_id}/test")
def send_test(sub_id: int, data: TestIn, db: Session = Depends(get_db)):
    """Manda ya un "Resumen de prueba" del último período cerrado (repetible)."""
    sub = _get_sub(db, sub_id)
    report = R.send_test(db, sub, data.kind, to=data.to)
    return _report_row(report)


@router.get("/subscriptions/{sub_id}/preview", response_class=HTMLResponse)
def preview(sub_id: int, kind: Literal["weekly", "monthly"] = "weekly", db: Session = Depends(get_db)):
    """HTML del mail tal como se enviaría hoy (no envía ni guarda nada)."""
    sub = _get_sub(db, sub_id)
    payload = R.preview_payload(db, sub, kind)
    _, html, _ = render_mail(payload, R.report_url("0" * 64), date.today(), test=True)
    return HTMLResponse(html)


@router.get("/subscriptions/{sub_id}/history")
def history(sub_id: int, db: Session = Depends(get_db)):
    _get_sub(db, sub_id)
    rows = (
        db.query(BehaviorReport)
        .filter(BehaviorReport.SubscriptionId == sub_id)
        .order_by(BehaviorReport.ReportId.desc())
        .limit(30)
        .all()
    )
    return [_report_row(r) for r in rows]


# ---------------------------------------------------------------------------
# Cron
# ---------------------------------------------------------------------------

def _run_in_background(run_date: Optional[date]) -> None:
    db = SessionLocal()
    try:
        log.info("Reporte comportamiento: %s", R.run_scheduled(db, run_date))
    except Exception:  # noqa: BLE001 — que quede en el log / Sentry, no hay a quién devolverlo
        log.exception("Reporte comportamiento: falló la corrida")
    finally:
        db.close()


@internal_router.post("/run", status_code=202)
def run(
    background: BackgroundTasks,
    x_cron_key: str = Header(default=""),
    run_date: Optional[date] = Query(default=None, alias="date"),
):
    """Lo llama el cron diario (07:00 AR). Decide solo qué toca: lunes →
    semanal, día 1 → mensual. `date` permite re-disparar un día puntual.

    Responde enseguida y envía en segundo plano: un mensual con todos los
    trades puede pasar el timeout de gunicorn (120 s) sobre la DB S0."""
    if not settings.cron_secret:
        raise HTTPException(503, "CRON_SECRET no configurado")
    if not hmac.compare_digest(x_cron_key.encode(), settings.cron_secret.encode()):
        raise HTTPException(401, "X-Cron-Key inválida")
    day = run_date or R.today_ar()
    kinds = R.due_kinds(day)
    if kinds:
        background.add_task(_run_in_background, day)
    return {"date": day.isoformat(), "kinds": kinds}


# ---------------------------------------------------------------------------
# Público (token)
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"^[a-f0-9]{64}$")
_DETAIL_CACHE = TTLCache(ttl_seconds=600.0, max_entries=300)

_RATE_LIMIT = 30          # requests por ventana e IP
_RATE_WINDOW_S = 60.0
_hits: dict[str, deque] = {}
_hits_lock = threading.Lock()


def _rate_limit(request: Request) -> None:
    # App Service agrega la IP real AL FINAL de X-Forwarded-For (lo de la
    # izquierda lo puede mandar el cliente → no sirve para limitar).
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[-1].strip() or (request.client.host if request.client else "")
    if ip.count(":") == 1:  # IPv4:puerto (App Service lo manda así); IPv6 se deja entero
        ip = ip.split(":")[0]
    now = time.monotonic()
    with _hits_lock:
        if len(_hits) > 5000:
            _hits.clear()
        q = _hits.setdefault(ip, deque())
        while q and now - q[0] > _RATE_WINDOW_S:
            q.popleft()
        if len(q) >= _RATE_LIMIT:
            raise HTTPException(429, "Demasiadas solicitudes, probá en un minuto")
        q.append(now)


def _load_report(token: str, db: Session) -> tuple[BehaviorReport, dict]:
    if not _TOKEN_RE.match(token):
        raise HTTPException(404, "Reporte no encontrado")
    report = db.query(BehaviorReport).filter(BehaviorReport.Token == token).first()
    if report is None:
        raise HTTPException(404, "Reporte no encontrado")
    if report.ExpiresAt < R.utcnow():
        raise HTTPException(410, "El reporte venció")
    return report, json.loads(report.Payload)


@public_router.get("/{token}", dependencies=[Depends(_rate_limit)])
def public_report(token: str, db: Session = Depends(get_db)):
    report, payload = _load_report(token, db)
    return {**payload, "expiresAt": report.ExpiresAt.isoformat()}


@public_router.get("/{token}/trades/{user_id}", dependencies=[Depends(_rate_limit)])
def public_report_trade(token: str, user_id: int, db: Session = Depends(get_db)):
    """Detalle de un trade del reporte (mismo formato que /intelligence/behavior).
    Solo trades incluidos en el snapshot."""
    report, payload = _load_report(token, db)
    if user_id not in {t["userId"] for t in payload["trades"]}:
        raise HTTPException(404, "Trade no incluido en este reporte")
    key = (user_id, report.PeriodFrom, report.PeriodTo)
    return _DETAIL_CACHE.get_or_build(key, lambda: build_behavior(db, user_id, report.PeriodFrom, report.PeriodTo))
