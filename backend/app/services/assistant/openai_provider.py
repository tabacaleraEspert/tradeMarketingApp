"""Proveedor OpenAI (Chat Completions). Único archivo que conoce el SDK.

Lecciones heredadas de Bachi / RRHH:
- NO setear `reasoning_effort`: con function tools la API devuelve 400.
- El cierre va con las tools declaradas (mismo prefijo de prompt → el caché
  sigue pegando) pero `tool_choice="none"`; sin eso un turno llegó a tardar
  51 s para devolver 0 caracteres.
- `prompt_cache_key` + retención 24h: el prompt estable se paga una vez.
"""
from __future__ import annotations

from typing import Iterator, Union

from .provider import Message, Round, ToolCall, ToolDef, Usage


def _to_wire(messages: list[Message]) -> list[dict]:
    out: list[dict] = []
    for m in messages:
        if m.role == "tool":
            out.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content or ""})
        elif m.tool_calls:
            out.append({
                "role": "assistant",
                "content": m.content,
                "tool_calls": [
                    {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.args_json}}
                    for c in m.tool_calls
                ],
            })
        else:
            out.append({"role": m.role, "content": m.content or ""})
    return out


def _tools_wire(tools: list[ToolDef]) -> list[dict]:
    return [
        {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.schema}}
        for t in tools
    ]


def _usage(u) -> Usage:
    if u is None:
        return Usage()
    details = getattr(u, "prompt_tokens_details", None)
    cached = getattr(details, "cached_tokens", 0) if details is not None else 0
    return Usage(input=u.prompt_tokens or 0, output=u.completion_tokens or 0, cached=cached or 0)


class OpenAIProvider:
    def __init__(self, api_key: str, model: str):
        from openai import OpenAI  # import lazy: sin key la dependencia ni se toca

        self._client = OpenAI(api_key=api_key, max_retries=0)
        self._model = model
        # No tipados en todas las versiones del SDK → van por extra_body.
        self._cache = {"prompt_cache_key": f"trade-{model}-base", "prompt_cache_retention": "24h"}

    def complete(self, messages: list[Message], tools: list[ToolDef], max_tokens: int, timeout: float) -> Round:
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=_to_wire(messages),
            tools=_tools_wire(tools),
            max_completion_tokens=max_tokens,
            timeout=timeout,
            extra_body=self._cache,
        )
        msg = resp.choices[0].message
        calls = tuple(
            ToolCall(id=c.id, name=c.function.name, args_json=c.function.arguments or "{}")
            for c in (msg.tool_calls or [])
        )
        return Round(text=msg.content or None, calls=calls, usage=_usage(resp.usage))

    def stream_closing(
        self, messages: list[Message], tools: list[ToolDef], max_tokens: int, timeout: float
    ) -> Iterator[Union[str, Usage]]:
        usage = Usage()
        stream = self._client.chat.completions.create(
            model=self._model,
            messages=_to_wire(messages),
            tools=_tools_wire(tools),
            tool_choice="none",
            max_completion_tokens=max_tokens,
            timeout=timeout,
            stream=True,
            stream_options={"include_usage": True},
            extra_body=self._cache,
        )
        try:
            for chunk in stream:
                if chunk.usage is not None:
                    usage = _usage(chunk.usage)
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        finally:
            stream.close()
        yield usage
