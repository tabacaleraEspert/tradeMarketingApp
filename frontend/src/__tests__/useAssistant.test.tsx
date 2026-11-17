import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { CUT_MESSAGE, MAX_HISTORY_MESSAGES, useAssistant } from "@/app/components/assistant/useAssistant";
import { httpResponse, sse, streamResponse } from "./assistant-test-utils";

const mockFetch = vi.fn();
const okTurn = (text: string) => streamResponse([sse("end", { text, durationMs: 1000, costUsd: 0.001 })]);
const sentBody = (call: number) => JSON.parse(mockFetch.mock.calls[call][1].body);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useAssistant", () => {
  it("camino feliz: etiqueta de herramienta, deltas y el texto final de end manda", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const encoder = new TextEncoder();
    const steps = [
      sse("tool", { label: "revisando oportunidades…" }),
      sse("text", { delta: "Hay 12" }),
      sse("text", { delta: " PDV" }),
      sse("end", { text: "Hay 12 PDVs.", durationMs: 3200, costUsd: 0.004 }),
    ];
    let n = 0;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (n === 2) await gate; // frena después del primer delta
            return n < steps.length ? { done: false, value: encoder.encode(steps[n++]) } : { done: true, value: undefined };
          },
        }),
      },
    });

    const { result } = renderHook(() => useAssistant());
    let done!: Promise<void>;
    await act(async () => {
      done = result.current.send("  ¿Cuántos PDVs?  ");
      await new Promise((r) => setTimeout(r, 0));
    });

    // A mitad del stream
    expect(result.current.status).toBe("answering");
    expect(result.current.messages.map((m) => [m.role, m.content, !!m.streaming])).toEqual([
      ["user", "¿Cuántos PDVs?", false],
      ["assistant", "Hay 12", true],
    ]);

    await act(async () => {
      release();
      await done;
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.toolLabel).toBeNull();
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant", content: "Hay 12 PDVs.", streaming: false, durationMs: 3200, costUsd: 0.004,
    });
    expect(sentBody(0)).toEqual({ question: "¿Cuántos PDVs?", history: [] });

    // El turno siguiente manda pregunta + respuesta final como historial
    mockFetch.mockResolvedValueOnce(okTurn("Otra."));
    await act(() => result.current.send("¿Y en Cuyo?"));
    expect(sentBody(1).history).toEqual([
      { role: "user", content: "¿Cuántos PDVs?" },
      { role: "assistant", content: "Hay 12 PDVs." },
    ]);
  });

  it("muestra la etiqueta de la herramienta mientras espera texto", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const encoder = new TextEncoder();
    let n = 0;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (n === 0) {
              n++;
              return { done: false, value: encoder.encode(sse("tool", { label: "revisando rutas…" })) };
            }
            await gate;
            if (n === 1) {
              n++;
              return { done: false, value: encoder.encode(sse("end", { text: "ok", durationMs: 1, costUsd: 0 })) };
            }
            return { done: true, value: undefined };
          },
        }),
      },
    });
    const { result } = renderHook(() => useAssistant());
    let done!: Promise<void>;
    await act(async () => {
      done = result.current.send("hola");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.toolLabel).toBe("revisando rutas…");
    await act(async () => {
      release();
      await done;
    });
    expect(result.current.toolLabel).toBeNull();
  });

  it("evento error: se muestra como aviso y el turno no entra al historial", async () => {
    mockFetch.mockResolvedValueOnce(
      streamResponse([sse("text", { delta: "Empiezo…" }), sse("error", { message: "Llegaste al límite de consultas por hora." })])
    );
    const { result } = renderHook(() => useAssistant());
    await act(() => result.current.send("pregunta que falla"));

    expect(result.current.status).toBe("idle");
    expect(result.current.messages.map((m) => m.role)).toEqual(["user", "assistant", "error"]);
    expect(result.current.messages[2].content).toBe("Llegaste al límite de consultas por hora.");
    expect(result.current.messages[1].streaming).toBe(false);

    mockFetch.mockResolvedValueOnce(okTurn("ok"));
    await act(() => result.current.send("otra"));
    expect(sentBody(1)).toEqual({ question: "otra", history: [] });
  });

  it("stream que termina sin end: avisa que se cortó", async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([sse("tool", { label: "x" }), sse("text", { delta: "a medias" })]));
    const { result } = renderHook(() => useAssistant());
    await act(() => result.current.send("hola"));

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last).toMatchObject({ role: "error", content: CUT_MESSAGE });
    expect(result.current.status).toBe("idle");
    expect(result.current.toolLabel).toBeNull();
  });

  it("respuesta no-200: error amigable en el chat", async () => {
    mockFetch.mockResolvedValueOnce(httpResponse(503));
    const { result } = renderHook(() => useAssistant());
    await act(() => result.current.send("hola"));
    expect(result.current.messages.map((m) => m.role)).toEqual(["user", "error"]);
    expect(result.current.messages[1].content).toMatch(/no está disponible/);
  });

  it("el historial excluye errores y se limita a los últimos 24 mensajes", async () => {
    const { result } = renderHook(() => useAssistant());
    for (let i = 1; i <= 14; i++) {
      // El turno 5 falla: ni su pregunta ni su error van al historial.
      mockFetch.mockResolvedValueOnce(i === 5 ? streamResponse([sse("error", { message: "falló" })]) : okTurn(`r${i}`));
      await act(() => result.current.send(`p${i}`));
    }
    mockFetch.mockResolvedValueOnce(okTurn("fin"));
    await act(() => result.current.send("última"));

    const { history } = sentBody(14);
    expect(history).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(history.some((m: { content: string }) => m.content === "p5" || m.content === "falló")).toBe(false);
    // 13 turnos buenos (26 mensajes) → quedan los últimos 12: del p2 al r14 (sin el 5).
    expect(history[0]).toEqual({ role: "user", content: "p2" });
    expect(history[23]).toEqual({ role: "assistant", content: "r14" });
    expect(history.every((m: { role: string }, i: number) => m.role === (i % 2 === 0 ? "user" : "assistant"))).toBe(true);
  });

  it("no manda preguntas vacías ni dos a la vez; reset limpia", async () => {
    const { result } = renderHook(() => useAssistant());
    await act(() => result.current.send("   "));
    expect(mockFetch).not.toHaveBeenCalled();

    mockFetch.mockResolvedValueOnce(okTurn("ok"));
    await act(async () => {
      const first = result.current.send("una");
      await result.current.send("dos");
      await first;
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    act(() => result.current.reset());
    expect(result.current.messages).toEqual([]);
  });

  it("la conversación se reinicia sola 1 hora después del primer mensaje", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(okTurn("ok"));
    const { result } = renderHook(() => useAssistant());
    await act(() => result.current.send("hola"));
    expect(result.current.messages).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(59 * 60 * 1000);
    });
    expect(result.current.messages).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(result.current.messages).toEqual([]);
  });

  it("al desmontar cancela la consulta en curso", async () => {
    let signal: AbortSignal | undefined;
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise(() => {});
    });
    const { result, unmount } = renderHook(() => useAssistant());
    await act(async () => {
      void result.current.send("hola");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
