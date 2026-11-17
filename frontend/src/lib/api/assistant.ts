/**
 * Puchi — asistente de consultas (solo admin).
 *
 * `ask()` usa fetch crudo + ReadableStream porque la respuesta es SSE y el
 * wrapper `api` solo parsea JSON. No pasa por la cola offline (src/lib/offline):
 * una consulta al asistente no se encola ni se reintenta sola.
 */
import { api, tryRefreshAccessToken } from "./client";
import { API_BASE_URL } from "./config";
import { getAccessToken, getRefreshToken, isAccessTokenExpired } from "./auth-storage";

// ── Tipos del contrato ──────────────────────────────────────────────────────

export interface AssistantStatus {
  enabled: boolean;
}

export interface AssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantAskRequest {
  question: string;
  history: AssistantHistoryMessage[];
}

export type AssistantEvent =
  | { type: "tool"; label: string }
  | { type: "text"; delta: string }
  | { type: "error"; message: string }
  | { type: "end"; text: string; durationMs: number; costUsd: number };

export interface AssistantUsageTool {
  tool: string;
  argsJson: string | null;
  durationMs: number;
}

export interface AssistantUsageTurn {
  id: number;
  createdUtc: string;
  userId: number;
  userName: string;
  /** null = texto purgado. */
  question: string | null;
  answer: string | null;
  rounds: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  ok: boolean;
  error: string | null;
  tools: AssistantUsageTool[];
}

export interface AssistantUsage {
  summary: {
    turns: number;
    users: number;
    costUsd: number;
    projectedMonthlyUsd: number;
    cachedPct: number;
  };
  tools: { tool: string; count: number }[];
  turns: AssistantUsageTurn[];
}

// ── SSE ─────────────────────────────────────────────────────────────────────

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Parser SSE puro e incremental: recibe lo que quedó sin cerrar del chunk
 * anterior (`buffer`) más el chunk nuevo, y devuelve los eventos completos y
 * el resto a guardar. Tolera eventos partidos entre chunks, varios eventos por
 * chunk y fines de línea `\r\n`.
 */
export function parseSseChunk(buffer: string, chunk: string): { events: SseEvent[]; rest: string } {
  let text = buffer + chunk;
  // Un `\r` al final puede ser la mitad de un `\r\n`: se guarda para el próximo chunk.
  let held = "";
  if (text.endsWith("\r")) {
    held = "\r";
    text = text.slice(0, -1);
  }
  text = text.replace(/\r\n?/g, "\n");

  const blocks = text.split("\n\n");
  const rest = (blocks.pop() ?? "") + held;
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length === 0) continue;
    events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

/** Evento SSE crudo → evento tipado del asistente. Lo desconocido o mal formado da null. */
export function toAssistantEvent(ev: SseEvent): AssistantEvent | null {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(ev.data);
    if (!parsed || typeof parsed !== "object") return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (ev.event) {
    case "tool":
      return typeof payload.label === "string" ? { type: "tool", label: payload.label } : null;
    case "text":
      return typeof payload.delta === "string" ? { type: "text", delta: payload.delta } : null;
    case "error":
      return {
        type: "error",
        message: typeof payload.message === "string" && payload.message ? payload.message : GENERIC_ERROR,
      };
    case "end":
      return typeof payload.text === "string"
        ? {
            type: "end",
            text: payload.text,
            durationMs: Number(payload.durationMs) || 0,
            costUsd: Number(payload.costUsd) || 0,
          }
        : null;
    default:
      return null;
  }
}

// ── ask ─────────────────────────────────────────────────────────────────────

const GENERIC_ERROR = "No pude responder esta consulta. Probá de nuevo en un rato.";

/** Error de `ask()` con mensaje ya listo para mostrar en el chat. */
export class AssistantError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "AssistantError";
  }
}

function httpErrorMessage(status: number): string {
  if (status === 401) return "Tu sesión expiró. Volvé a ingresar para seguir consultando.";
  if (status === 403) return "Puchi está disponible solo para administradores.";
  if (status === 429) return "Hiciste muchas consultas seguidas. Esperá un momento y probá de nuevo.";
  if (status === 503) return "Puchi no está disponible en este momento. Probá de nuevo en unos minutos.";
  return `No pude responder esta consulta (error ${status}). Probá de nuevo en un rato.`;
}

export interface AskOptions {
  signal?: AbortSignal;
  onEvent: (event: AssistantEvent) => void;
}

/**
 * Manda la pregunta y va entregando los eventos del stream por `onEvent`.
 * Resuelve cuando el stream se cierra (haya llegado `end` o no: eso lo decide
 * quien llama). Rechaza con AssistantError en respuestas no-200 o falla de red,
 * y con el AbortError original si se canceló.
 */
export async function ask(body: AssistantAskRequest, { signal, onEvent }: AskOptions): Promise<void> {
  const post = () =>
    fetch(`${API_BASE_URL}/assistant/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${getAccessToken() ?? ""}`,
      },
      body: JSON.stringify(body),
      signal,
    });

  let res: Response;
  try {
    if (isAccessTokenExpired() && getRefreshToken()) await tryRefreshAccessToken();
    res = await post();
    // 401: un refresh y un solo reintento, igual que apiRequest.
    if (res.status === 401 && (await tryRefreshAccessToken())) res = await post();
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AssistantError("Sin conexión al servidor. Revisá tu WiFi/datos e intentá de nuevo.", 0);
  }

  if (!res.ok) throw new AssistantError(httpErrorMessage(res.status), res.status);
  if (!res.body) throw new AssistantError(GENERIC_ERROR, res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (chunk: string) => {
    const { events, rest } = parseSseChunk(buffer, chunk);
    buffer = rest;
    for (const raw of events) {
      const ev = toAssistantEvent(raw);
      if (ev) onEvent(ev);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      emit(decoder.decode(value, { stream: true }));
    }
    // Último evento sin línea en blanco final.
    emit(decoder.decode() + "\n\n");
  } catch (e) {
    if (signal?.aborted) throw e;
    // Conexión cortada a mitad del stream: se trata como stream sin `end`.
  }
}

// ── Endpoints JSON ──────────────────────────────────────────────────────────

export const assistantApi = {
  status: () => api.get<AssistantStatus>("/assistant/status"),
  ask,
  usage: (dateFrom: string, dateTo: string) =>
    api.get<AssistantUsage>("/assistant/usage", { date_from: dateFrom, date_to: dateTo }),
  purge: (days = 90) => api.post<{ purged: number }>(`/assistant/purge?days=${days}`),
  /** Precalienta en segundo plano el censo que usan casi todas las consultas. */
  warm: () => api.post<{ warming: boolean }>("/assistant/warm"),
};
