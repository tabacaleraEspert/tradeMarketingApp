"""Modelo de mensajes agnóstico del proveedor.

Bachi cambió de proveedor una vez en producción: por eso el loop habla solo en
estos tipos y el SDK vive encerrado en `openai_provider.py`.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, Optional, Protocol, Union


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    args_json: str


@dataclass(frozen=True)
class Message:
    """role: system | user | assistant | tool.
    Un assistant con `tool_calls` es el pedido de herramientas; un tool lleva
    `tool_call_id` y el resultado en `content`."""
    role: str
    content: Optional[str] = None
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: Optional[str] = None


@dataclass(frozen=True)
class ToolDef:
    name: str
    description: str
    schema: dict


@dataclass(frozen=True)
class Usage:
    input: int = 0
    output: int = 0
    cached: int = 0

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(self.input + other.input, self.output + other.output, self.cached + other.cached)


@dataclass(frozen=True)
class Round:
    """Resultado de una vuelta sin streaming: texto final o pedidos de tools."""
    text: Optional[str]
    calls: tuple[ToolCall, ...]
    usage: Usage


class ChatProvider(Protocol):
    def complete(
        self, messages: list[Message], tools: list[ToolDef], max_tokens: int, timeout: float
    ) -> Round:
        """Una vuelta: el modelo puede responder o pedir herramientas."""

    def stream_closing(
        self, messages: list[Message], tools: list[ToolDef], max_tokens: int, timeout: float
    ) -> Iterator[Union[str, Usage]]:
        """Vuelta de cierre: herramientas declaradas pero prohibidas. Emite
        deltas de texto (str) y termina SIEMPRE con un `Usage`."""
