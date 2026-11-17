"""Auditoría del asistente IA "Puchi" (ver app/services/assistant/).

`AssistantTurn`: una fila por pregunta — se abre ANTES de llamar al modelo (así
los turnos en vuelo cuentan para el rate limit) y se cierra en el `finally` del
loop con tokens, costo y resultado. `AssistantToolUse`: una fila por herramienta
ejecutada dentro del turno.

Las filas no se borran nunca: la purga pone Question/Answer en NULL (borrar
reiniciaría el rate limit y perdería el historial de costo).
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String

from ..database import Base


class AssistantTurn(Base):
    __tablename__ = "AssistantTurn"

    AssistantTurnId = Column(Integer, primary_key=True, autoincrement=True)
    UserId = Column(Integer, ForeignKey("User.UserId"), nullable=False, index=True)
    # Naive UTC, seteado desde Python (misma convención que Visit.OpenedAt).
    CreatedUtc = Column(DateTime, nullable=False, index=True)
    Question = Column(String, nullable=True)
    Answer = Column(String, nullable=True)
    Model = Column(String(60), nullable=False)
    Rounds = Column(Integer, nullable=False, default=0)
    DurationMs = Column(Integer, nullable=False, default=0)
    TokensIn = Column(Integer, nullable=False, default=0)
    TokensOut = Column(Integer, nullable=False, default=0)
    TokensCached = Column(Integer, nullable=False, default=0)
    CostUsd = Column(Numeric(10, 6), nullable=False, default=0)
    Ok = Column(Boolean, nullable=False, default=False)
    Error = Column(String(500), nullable=True)


class AssistantToolUse(Base):
    __tablename__ = "AssistantToolUse"

    AssistantToolUseId = Column(Integer, primary_key=True, autoincrement=True)
    AssistantTurnId = Column(
        Integer, ForeignKey("AssistantTurn.AssistantTurnId", ondelete="CASCADE"), nullable=False, index=True
    )
    Tool = Column(String(60), nullable=False)
    ArgsJson = Column(String(2000), nullable=True)
    DurationMs = Column(Integer, nullable=False, default=0)
