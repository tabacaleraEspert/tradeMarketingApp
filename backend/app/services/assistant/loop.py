"""Loop de tool-use del asistente, con cierre forzado.

Reglas heredadas de Bachi / RRHH — cada una costó un incidente, no relajarlas:

1. Guardas ANTES de gastar un token: sin key, pregunta vacía, rate limit.
2. El turno se abre en la DB antes de llamar al modelo (los turnos en vuelo
   cuentan para el rate limit) y se cierra SIEMPRE en el `finally`, incluso si
   el cliente se desconecta.
3. Como mucho `max_rounds - 1` vueltas de herramientas; la última vuelta es el
   cierre, en streaming, con las herramientas declaradas pero prohibidas.
4. Todo pedido de herramienta recibe un resultado, o la API rechaza el request
   siguiente: si se acabó el tiempo, el resultado es un "SIN TIEMPO".
5. Nunca una burbuja vacía: si no hay texto, va un mensaje de respaldo.
6. Al historial del modelo solo entran texto del usuario y respuestas finales;
   los pedidos y resultados de herramientas mueren con el turno.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable, Iterator, Optional

from sqlalchemy.orm import Session

from ...models import User
from . import prompt, turnlog
from .provider import ChatProvider, Message, Usage
from .tools import ToolCtx, ToolRegistry

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Options:
    max_rounds: int = 4            # la última es siempre el cierre
    timeout_s: float = 90.0        # presupuesto total del turno
    no_tools_after_s: float = 70.0  # pasado esto no se ejecutan más herramientas
    closing_budget_s: float = 20.0  # presupuesto propio del cierre si ya se venció el total
    max_history: int = 24
    max_chars: int = 4000
    # Generosos a propósito: el presupuesto incluye tokens de razonamiento; con
    # poco margen el modelo se lo gasta pensando y no escribe nada.
    max_tokens_round: int = 2000
    max_tokens_closing: int = 4000
    max_calls_per_round: int = 6   # tope de herramientas que se ejecutan por vuelta


MSG_NO_KEY = "El asistente no está configurado (falta la API key). Avisale a sistemas."
MSG_RATE_ERROR = "No pude verificar el límite de uso. Probá de nuevo en un rato."
MSG_RATE_LIMIT = (
    f"Llegaste al límite de {turnlog.RATE_LIMIT_COUNT} consultas cada "
    f"{turnlog.RATE_LIMIT_WINDOW_MIN} minutos. Esperá un poco y seguimos."
)
MSG_NO_TURN = "No pude registrar la consulta. Probá de nuevo en un rato."
MSG_EMPTY = "No pude generar una respuesta. Probá reformular la pregunta o achicar el período."
MSG_CUT = "Se cortó la consulta antes de terminar. Probá de nuevo o achicá el período."
TOO_MANY_CALLS = (
    "ERROR: demasiadas consultas en una sola vuelta; esta no se ejecutó. "
    "Respondé con lo que tengas o pedí menos por vez."
)
OUT_OF_TIME = (
    "SIN TIEMPO: no se ejecutó esta consulta porque se agotó el tiempo del turno. "
    "Respondé con lo que ya tengas y avisá qué quedó sin revisar."
)
SYS_OUT_OF_TIME = (
    "Se acabó el tiempo de consulta. Respondé AHORA con lo que tengas, sin pedir más datos, "
    "y avisá qué quedó sin revisar."
)


def _clean_history(history: list[dict], opts: Options) -> list[Message]:
    out: list[Message] = []
    for h in history or []:
        role, content = h.get("role"), h.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            out.append(Message(role, content.strip()[: opts.max_chars]))
    return out[-opts.max_history:]


def _is_timeout(e: Exception) -> bool:
    return "timeout" in type(e).__name__.lower()


def ask(
    *,
    db: Session,
    audit_db: Optional[Session] = None,
    user: User,
    question: str,
    history: list[dict],
    provider: Optional[ChatProvider],
    registry: ToolRegistry,
    model: str,
    options: Options = Options(),
    clock: Callable[[], float] = time.monotonic,
) -> Iterator[dict]:
    """Genera eventos `{"type": "tool"|"text"|"error"|"end", ...}` para UNA pregunta.

    `db` es la sesión de lectura de las herramientas; `audit_db` (default: la
    misma) recibe los commits de auditoría. En producción van separadas: un
    commit expira todo lo cargado en su sesión."""
    opts = options
    audit_db = audit_db or db
    if provider is None:
        yield {"type": "error", "message": MSG_NO_KEY}
        return
    question = (question or "").strip()[: opts.max_chars]
    if not question:
        return

    recent = turnlog.recent_count(audit_db, user.UserId)
    if recent is None:  # falla cerrada
        yield {"type": "error", "message": MSG_RATE_ERROR}
        return
    if recent >= turnlog.RATE_LIMIT_COUNT:
        yield {"type": "error", "message": MSG_RATE_LIMIT}
        return

    turn_id = turnlog.open_turn(audit_db, user.UserId, question, model)
    if turn_id is None:
        yield {"type": "error", "message": MSG_NO_TURN}
        return

    start = clock()
    elapsed = lambda: clock() - start  # noqa: E731
    usage = Usage()
    rounds = 0
    final_text = ""
    error: Optional[str] = None
    finished = False

    try:
        tools = registry.definitions()
        ctx = ToolCtx(db=db, user=user)
        # El bloque volátil (nombre, fecha y hora) va DESPUÉS del historial: todo
        # lo anterior es prefijo estable y entra en el caché del proveedor.
        messages: list[Message] = [
            Message("system", prompt.stable_prompt()),
            *_clean_history(history, opts),
            Message("system", prompt.volatile_prompt(user.DisplayName)),
            Message("user", question),
        ]
        out_of_time = False

        # ── Vueltas de herramientas (sin streaming) ──────────────────────────
        while rounds < opts.max_rounds - 1 and not out_of_time:
            remaining = opts.timeout_s - elapsed()
            if remaining <= 1:
                error = "timeout"
                break
            try:
                rnd = provider.complete(messages, tools, opts.max_tokens_round, remaining)
            except Exception as e:
                error = "timeout" if _is_timeout(e) else f"proveedor: {type(e).__name__}: {e}"
                log.warning("assistant: falló la vuelta %s del turno %s: %s", rounds + 1, turn_id, error)
                break
            rounds += 1
            usage += rnd.usage
            if not rnd.calls:
                final_text = rnd.text or ""
                if final_text:
                    yield {"type": "text", "delta": final_text}
                break
            messages.append(Message("assistant", rnd.text, tool_calls=rnd.calls))
            for i, call in enumerate(rnd.calls):
                if elapsed() > opts.no_tools_after_s:
                    # No se ejecuta y se va derecho al cierre: otra vuelta con
                    # herramientas sería pagar por pedidos que no se van a correr.
                    result, out_of_time = OUT_OF_TIME, True
                elif i >= opts.max_calls_per_round:
                    result = TOO_MANY_CALLS
                else:
                    yield {"type": "tool", "label": registry.label(call.name)}
                    t0 = clock()
                    result = registry.execute(call.name, call.args_json, ctx)
                    turnlog.log_tool(audit_db, turn_id, call.name, call.args_json, int((clock() - t0) * 1000))
                messages.append(Message("tool", result, tool_call_id=call.id))

        # ── Cierre forzado (streaming, herramientas prohibidas) ──────────────
        if not final_text.strip():
            remaining = opts.timeout_s - elapsed()
            if out_of_time or error == "timeout" or remaining <= 5:
                messages.append(Message("system", SYS_OUT_OF_TIME))
            # El cierre tiene siempre al menos su presupuesto propio, quede lo que quede.
            remaining = max(remaining, opts.closing_budget_s)
            rounds += 1
            try:
                for item in provider.stream_closing(messages, tools, opts.max_tokens_closing, remaining):
                    if isinstance(item, Usage):
                        usage += item
                    elif item:
                        final_text += item
                        yield {"type": "text", "delta": item}
            except Exception as e:
                error = error or ("timeout" if _is_timeout(e) else f"proveedor: {type(e).__name__}: {e}")
                log.warning("assistant: falló el cierre del turno %s: %s", turn_id, e)

        # ── Nunca una burbuja vacía ──────────────────────────────────────────
        if not final_text.strip():
            final_text = MSG_CUT if error else MSG_EMPTY
            error = error or "sin_respuesta"
            yield {"type": "text", "delta": final_text}

        finished = True
        yield {
            "type": "end",
            "text": final_text,
            "durationMs": int(elapsed() * 1000),
            "costUsd": round(turnlog.cost_usd(usage), 6),
        }
    except Exception as e:
        error = error or f"interno: {type(e).__name__}: {e}"
        raise
    finally:
        if not finished and error is None:
            error = "cancelado"  # el cliente cerró la conexión a mitad del turno
        turnlog.close_turn(
            audit_db, turn_id, ok=error is None, error=error, answer=final_text,
            rounds=rounds, duration_ms=int(elapsed() * 1000), usage=usage,
        )
