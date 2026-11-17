"""Auditoría del asistente: turnos, uso de herramientas, rate limit, costo, purga.

Cada función hace su propio commit: el turno tiene que quedar registrado aunque
el request se corte a mitad de camino. Las fallas de auditoría de herramientas
y de cierre se loguean y no interrumpen la respuesta al usuario; la ÚNICA que
corta es el rate limit, que falla cerrado (en Bachi fallar abierto costó plata).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...config import settings
from ...models import AssistantToolUse, AssistantTurn, User
from .provider import Usage

log = logging.getLogger(__name__)

RATE_LIMIT_COUNT = 20
RATE_LIMIT_WINDOW_MIN = 5
MAX_USAGE_TURNS = 500
# Argentina no tiene horario de verano: UTC-3 fijo.
_AR_OFFSET = timedelta(hours=3)


def _utcnow() -> datetime:
    """Naive UTC (misma convención que Visit.OpenedAt). En función aparte para
    poder fijarla en tests."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def cost_usd(usage: Usage) -> float:
    """Costo del turno con los precios vigentes. Se guarda por turno al cerrar,
    así el historial sobrevive a un cambio de precios."""
    fresh = max(usage.input - usage.cached, 0)
    return (
        fresh * settings.assistant_price_input
        + usage.cached * settings.assistant_price_cached
        + usage.output * settings.assistant_price_output
    ) / 1_000_000


def recent_count(db: Session, user_id: int) -> Optional[int]:
    """Turnos del usuario en la ventana del rate limit. `None` = no se pudo
    contar → el que llama RECHAZA (falla cerrada)."""
    try:
        since = _utcnow() - timedelta(minutes=RATE_LIMIT_WINDOW_MIN)
        return (
            db.query(func.count(AssistantTurn.AssistantTurnId))
            .filter(AssistantTurn.UserId == user_id, AssistantTurn.CreatedUtc >= since)
            .scalar()
        ) or 0
    except Exception:
        log.exception("assistant: no se pudo contar turnos recientes (rate limit falla cerrado)")
        db.rollback()
        return None


def open_turn(db: Session, user_id: int, question: str, model: str) -> Optional[int]:
    """Abre la fila del turno ANTES de llamar al modelo: los turnos en vuelo
    cuentan para el rate limit. `None` = no se pudo registrar → se rechaza."""
    try:
        turn = AssistantTurn(UserId=user_id, CreatedUtc=_utcnow(), Question=question, Model=model)
        db.add(turn)
        db.commit()
        return turn.AssistantTurnId
    except Exception:
        log.exception("assistant: no se pudo abrir el turno")
        db.rollback()
        return None


def log_tool(db: Session, turn_id: int, tool: str, args_json: str, duration_ms: int) -> None:
    try:
        db.add(AssistantToolUse(
            AssistantTurnId=turn_id, Tool=tool[:60], ArgsJson=(args_json or "")[:2000], DurationMs=duration_ms,
        ))
        db.commit()
    except Exception:
        log.exception("assistant: no se pudo registrar el uso de %s", tool)
        db.rollback()


def close_turn(
    db: Session, turn_id: int, *, ok: bool, error: Optional[str], answer: str,
    rounds: int, duration_ms: int, usage: Usage,
) -> None:
    try:
        db.rollback()  # por si una herramienta dejó la sesión a medio camino
        turn = db.get(AssistantTurn, turn_id)
        if turn is None:
            return
        turn.Ok = ok
        turn.Error = (error or None) and error[:500]
        turn.Answer = answer
        turn.Rounds = rounds
        turn.DurationMs = duration_ms
        turn.TokensIn = usage.input
        turn.TokensOut = usage.output
        turn.TokensCached = usage.cached
        turn.CostUsd = Decimal(str(round(cost_usd(usage), 6)))
        db.commit()
    except Exception:
        log.exception("assistant: no se pudo cerrar el turno %s", turn_id)
        db.rollback()


def purge_texts(db: Session, older_than_days: int) -> int:
    """Pone Question/Answer en NULL en turnos viejos. NUNCA borra filas: borrar
    reiniciaría el rate limit y perdería el historial de costo."""
    cutoff = _utcnow() - timedelta(days=older_than_days)
    n = (
        db.query(AssistantTurn)
        .filter(
            AssistantTurn.CreatedUtc < cutoff,
            (AssistantTurn.Question.isnot(None)) | (AssistantTurn.Answer.isnot(None)),
        )
        .update({AssistantTurn.Question: None, AssistantTurn.Answer: None}, synchronize_session=False)
    )
    db.commit()
    return n


def usage_report(db: Session, date_from: date, date_to: date) -> dict[str, Any]:
    """Panel de uso. Fechas en hora Argentina, inclusivas. Los agregados son del
    período completo; el detalle trae los últimos `MAX_USAGE_TURNS` turnos."""
    start = datetime.combine(date_from, datetime.min.time()) + _AR_OFFSET
    end = datetime.combine(date_to + timedelta(days=1), datetime.min.time()) + _AR_OFFSET
    in_range = [AssistantTurn.CreatedUtc >= start, AssistantTurn.CreatedUtc < end]

    n_turns, n_users, cost, tok_in, tok_cached = (
        db.query(
            func.count(AssistantTurn.AssistantTurnId),
            func.count(func.distinct(AssistantTurn.UserId)),
            func.coalesce(func.sum(AssistantTurn.CostUsd), 0),
            func.coalesce(func.sum(AssistantTurn.TokensIn), 0),
            func.coalesce(func.sum(AssistantTurn.TokensCached), 0),
        )
        .filter(*in_range)
        .one()
    )
    cost = float(cost)
    # Proyección: ritmo diario de los días transcurridos del rango × 30.
    today_ar = (_utcnow() - _AR_OFFSET).date()
    elapsed_days = max((min(date_to, today_ar) - date_from).days + 1, 1)

    tools = [
        {"tool": tool, "count": count}
        for tool, count in (
            db.query(AssistantToolUse.Tool, func.count(AssistantToolUse.AssistantToolUseId))
            .join(AssistantTurn, AssistantTurn.AssistantTurnId == AssistantToolUse.AssistantTurnId)
            .filter(*in_range)
            .group_by(AssistantToolUse.Tool)
            .order_by(func.count(AssistantToolUse.AssistantToolUseId).desc())
            .all()
        )
    ]

    rows = (
        db.query(AssistantTurn, User.DisplayName)
        .outerjoin(User, User.UserId == AssistantTurn.UserId)
        .filter(*in_range)
        .order_by(AssistantTurn.CreatedUtc.desc())
        .limit(MAX_USAGE_TURNS)
        .all()
    )
    turn_ids = [t.AssistantTurnId for t, _ in rows]
    tools_by_turn: dict[int, list[dict]] = {}
    for i in range(0, len(turn_ids), 1000):  # SQL Server: tope ~2100 parámetros por IN
        for u in (
            db.query(AssistantToolUse)
            .filter(AssistantToolUse.AssistantTurnId.in_(turn_ids[i:i + 1000]))
            .order_by(AssistantToolUse.AssistantToolUseId)
            .all()
        ):
            tools_by_turn.setdefault(u.AssistantTurnId, []).append(
                {"tool": u.Tool, "argsJson": u.ArgsJson, "durationMs": u.DurationMs}
            )

    return {
        "summary": {
            "turns": n_turns or 0,
            "users": n_users or 0,
            "costUsd": round(cost, 4),
            "projectedMonthlyUsd": round(cost / elapsed_days * 30, 2),
            "cachedPct": round(100 * int(tok_cached) / int(tok_in), 1) if tok_in else 0.0,
        },
        "tools": tools,
        "turns": [
            {
                "id": t.AssistantTurnId,
                "createdUtc": t.CreatedUtc.isoformat() + "Z",
                "userId": t.UserId,
                "userName": name or f"Usuario {t.UserId}",
                "question": t.Question,
                "answer": t.Answer,
                "rounds": t.Rounds,
                "durationMs": t.DurationMs,
                "tokensIn": t.TokensIn,
                "tokensOut": t.TokensOut,
                "tokensCached": t.TokensCached,
                "costUsd": float(t.CostUsd or 0),
                "ok": bool(t.Ok),
                "error": t.Error,
                "tools": tools_by_turn.get(t.AssistantTurnId, []),
            }
            for t, name in rows
        ],
    }
