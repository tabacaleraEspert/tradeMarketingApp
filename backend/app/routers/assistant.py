"""Asistente IA "Puchi" — consultas en lenguaje natural sobre los datos de la app.

    GET  /assistant/status   {enabled}: sin OPENAI_API_KEY el front no muestra el botón
    POST /assistant/ask      pregunta + historial → respuesta por SSE
    GET  /assistant/usage    panel de uso y costo
    POST /assistant/purge    borra los textos de turnos viejos (las filas quedan)

Solo admin (igual que Inteligencia y el Tablero TMR: son de dirección). Solo
lectura: las herramientas del asistente no modifican datos. La traza de cada
consulta queda en `AssistantTurn` / `AssistantToolUse`.

SSE: eventos `tool {label}`, `text {delta}`, `error {message}`, `end {text,
durationMs, costUsd}`. El generador corre en el threadpool y usa sesiones de
DB PROPIAS: la de `Depends(get_db)` se cierra según el ciclo de vida del
request, no el del stream.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Iterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import database
from ..auth import get_current_user, require_role
from ..config import settings
from ..database import get_db
from ..models import User as UserModel
from ..services.assistant import loop, prompt, turnlog
from ..services.assistant.provider import ChatProvider
from ..services.assistant.tools import ToolRegistry

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/assistant",
    tags=["Asistente IA"],
    dependencies=[Depends(require_role("admin", strict=True))],
)

_registry = ToolRegistry()
_provider: Optional[ChatProvider] = None
_provider_lock = threading.Lock()


def get_provider() -> Optional[ChatProvider]:
    """Proveedor por proceso, creado en el primer uso. `None` sin API key."""
    global _provider
    if not settings.openai_api_key:
        return None
    if _provider is None:
        with _provider_lock:
            if _provider is None:
                from ..services.assistant.openai_provider import OpenAIProvider
                _provider = OpenAIProvider(settings.openai_api_key, settings.openai_model)
    return _provider


class HistoryMessage(BaseModel):
    role: str = Field(max_length=20)
    content: str = Field(max_length=20000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=100)


def _sse(event: dict) -> str:
    payload = {k: v for k, v in event.items() if k != "type"}
    return f"event: {event['type']}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream(user_id: int, question: str, history: list[dict], provider: ChatProvider) -> Iterator[str]:
    # Dos sesiones: las herramientas leen en `db` y la auditoría commitea en
    # `audit_db`. Así un commit de auditoría no expira lo que las herramientas
    # (o los caches que alimentan) tienen cargado.
    db = database.SessionLocal()
    audit_db = database.SessionLocal()
    try:
        user = db.get(UserModel, user_id)
        for event in loop.ask(
            db=db, audit_db=audit_db, user=user, question=question, history=history,
            provider=provider, registry=_registry, model=settings.openai_model,
        ):
            yield _sse(event)
    except Exception:
        # El status 200 ya salió: lo único que se puede hacer es avisar por el stream.
        log.exception("assistant: el stream falló")
        yield _sse({"type": "error", "message": loop.MSG_CUT})
    finally:
        db.close()
        audit_db.close()


@router.get("/status")
def get_status():
    return {"enabled": bool(settings.openai_api_key), "missingKnowledge": prompt.missing_files()}


@router.post("/ask")
def ask(body: AskRequest, current_user: UserModel = Depends(get_current_user)):
    provider = get_provider()
    if provider is None:
        raise HTTPException(status_code=503, detail="Asistente no configurado: falta OPENAI_API_KEY en el servidor.")
    return StreamingResponse(
        _stream(current_user.UserId, body.question, [m.model_dump() for m in body.history], provider),
        media_type="text/event-stream",
        # no-transform + X-Accel-Buffering: que ningún proxy junte los eventos.
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


def _today_ar() -> date:
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date()


@router.get("/usage")
def get_usage(
    date_from: Optional[date] = Query(default=None, description="Desde (fecha AR, inclusive). Default: 1° del mes"),
    date_to: Optional[date] = Query(default=None, description="Hasta (fecha AR, inclusive). Default: hoy"),
    db: Session = Depends(get_db),
):
    date_to = date_to or _today_ar()
    date_from = date_from or date_to.replace(day=1)
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="date_to debe ser mayor o igual a date_from")
    return turnlog.usage_report(db, date_from, date_to)


@router.post("/purge")
def purge(
    days: int = Query(default=90, ge=30, description="Borra los textos de turnos con más de N días"),
    db: Session = Depends(get_db),
):
    return {"purged": turnlog.purge_texts(db, days)}
