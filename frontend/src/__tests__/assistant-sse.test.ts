/**
 * Tests de lib/api/assistant.ts: parser SSE puro y ask() contra un fetch simulado.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ask, AssistantError, parseSseChunk, toAssistantEvent, type AssistantEvent } from "../lib/api/assistant";
import { clearTokens, getAccessToken, saveTokens } from "../lib/api/auth-storage";
import { httpResponse, sse, streamResponse } from "./assistant-test-utils";

describe("parseSseChunk", () => {
  it("parsea varios eventos en un mismo chunk", () => {
    const { events, rest } = parseSseChunk("", sse("tool", { label: "revisando rutas…" }) + sse("text", { delta: "Hola" }));
    expect(events).toEqual([
      { event: "tool", data: '{"label":"revisando rutas…"}' },
      { event: "text", data: '{"delta":"Hola"}' },
    ]);
    expect(rest).toBe("");
  });

  it("junta un evento partido entre chunks (incluso en medio del JSON)", () => {
    const full = sse("text", { delta: "cobertura 47,7%" });
    for (let cut = 1; cut < full.length; cut++) {
      const first = parseSseChunk("", full.slice(0, cut));
      expect(first.events).toEqual([]);
      const second = parseSseChunk(first.rest, full.slice(cut));
      expect(second.events).toEqual([{ event: "text", data: '{"delta":"cobertura 47,7%"}' }]);
      expect(second.rest).toBe("");
    }
  });

  it("acepta fines de línea CRLF, también partidos entre \\r y \\n", () => {
    const full = 'event: text\r\ndata: {"delta":"a"}\r\n\r\nevent: text\r\ndata: {"delta":"b"}\r\n\r\n';
    expect(parseSseChunk("", full).events.map((e) => e.data)).toEqual(['{"delta":"a"}', '{"delta":"b"}']);

    const cut = full.indexOf("\r\n\r\n") + 1; // corta justo después de un \r
    const first = parseSseChunk("", full.slice(0, cut));
    const second = parseSseChunk(first.rest, full.slice(cut));
    expect([...first.events, ...second.events].map((e) => e.data)).toEqual(['{"delta":"a"}', '{"delta":"b"}']);
  });

  it("ignora comentarios y une data multilínea", () => {
    const { events } = parseSseChunk("", ": keep-alive\n\nevent: x\ndata: uno\ndata: dos\n\n");
    expect(events).toEqual([{ event: "x", data: "uno\ndos" }]);
  });

  it("deja en rest lo que todavía no cerró", () => {
    const { events, rest } = parseSseChunk("", sse("text", { delta: "a" }) + "event: end\ndata: {");
    expect(events).toHaveLength(1);
    expect(rest).toBe("event: end\ndata: {");
  });
});

describe("toAssistantEvent", () => {
  it("mapea los cuatro eventos del contrato", () => {
    expect(toAssistantEvent({ event: "tool", data: '{"label":"x"}' })).toEqual({ type: "tool", label: "x" });
    expect(toAssistantEvent({ event: "text", data: '{"delta":"x"}' })).toEqual({ type: "text", delta: "x" });
    expect(toAssistantEvent({ event: "error", data: '{"message":"x"}' })).toEqual({ type: "error", message: "x" });
    expect(toAssistantEvent({ event: "end", data: '{"text":"x","durationMs":3200,"costUsd":0.004}' })).toEqual({
      type: "end", text: "x", durationMs: 3200, costUsd: 0.004,
    });
  });

  it("ignora eventos desconocidos y JSON roto", () => {
    expect(toAssistantEvent({ event: "ping", data: "{}" })).toBeNull();
    expect(toAssistantEvent({ event: "text", data: "{no json" })).toBeNull();
    expect(toAssistantEvent({ event: "text", data: '{"otra":1}' })).toBeNull();
  });
});

describe("ask", () => {
  const mockFetch = vi.fn();
  const collect = async (signal?: AbortSignal) => {
    const events: AssistantEvent[] = [];
    await ask({ question: "hola", history: [] }, { signal, onEvent: (e) => events.push(e) });
    return events;
  };

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    saveTokens({ accessToken: "tok-1", refreshToken: "ref-1", expiresInSeconds: 3600 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it("manda POST con bearer y entrega los eventos; ignora los desconocidos", async () => {
    const all = sse("tool", { label: "t" }) + sse("ping", {}) + sse("text", { delta: "Ho" }) + sse("text", { delta: "la" }) +
      sse("end", { text: "Hola", durationMs: 10, costUsd: 0.001 });
    // Chunks de 7 caracteres: todos los eventos llegan partidos.
    mockFetch.mockResolvedValueOnce(streamResponse(all.match(/[\s\S]{1,7}/g)!));

    const events = await collect();
    expect(events.map((e) => e.type)).toEqual(["tool", "text", "text", "end"]);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/assistant\/ask$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(init.body)).toEqual({ question: "hola", history: [] });
  });

  it("entrega el último evento aunque falte la línea en blanco final", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse(['event: end\ndata: {"text":"ok","durationMs":1,"costUsd":0}']));
    expect((await collect()).map((e) => e.type)).toEqual(["end"]);
  });

  it("401: refresca el token una vez y reintenta", async () => {
    mockFetch
      .mockResolvedValueOnce(httpResponse(401))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "tok-2", expires_in: 3600 }) })
      .mockResolvedValueOnce(streamResponse([sse("end", { text: "ok", durationMs: 1, costUsd: 0 })]));

    expect((await collect()).map((e) => e.type)).toEqual(["end"]);
    expect(mockFetch.mock.calls[1][0]).toMatch(/\/auth\/refresh$/);
    expect(mockFetch.mock.calls[2][1].headers.Authorization).toBe("Bearer tok-2");
    expect(getAccessToken()).toBe("tok-2");
  });

  it("401 sin poder refrescar, 403 y 503 dan un AssistantError con mensaje amigable", async () => {
    mockFetch.mockResolvedValueOnce(httpResponse(401)).mockResolvedValueOnce(httpResponse(401));
    await expect(collect()).rejects.toMatchObject({ name: "AssistantError", status: 401 });

    mockFetch.mockResolvedValueOnce(httpResponse(403));
    await expect(collect()).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/administradores/) });

    mockFetch.mockResolvedValueOnce(httpResponse(503));
    await expect(collect()).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/no está disponible/) });
  });

  it("falla de red → AssistantError status 0; cancelación → propaga el abort", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(collect()).rejects.toBeInstanceOf(AssistantError);

    const controller = new AbortController();
    controller.abort();
    mockFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(collect(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
