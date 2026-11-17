/**
 * Conversación con Puchi. Vive solo en memoria: recargar la página la borra, y
 * se reinicia sola 1 hora después de su primer mensaje.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ask, AssistantError, type AssistantHistoryMessage } from "@/lib/api/assistant";

export const MAX_QUESTION_CHARS = 4000;
export const MAX_HISTORY_MESSAGES = 24;
export const CONVERSATION_TTL_MS = 60 * 60 * 1000;
export const CUT_MESSAGE = "Se cortó la consulta antes de terminar. Probá de nuevo.";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "error";
  content: string;
  /** Respuesta todavía llegando por el stream. */
  streaming?: boolean;
  /**
   * Fuera del historial que se manda al backend: la pregunta de un turno que
   * falló, o el texto parcial de una respuesta que no llegó a `end`.
   */
  excluded?: boolean;
  durationMs?: number;
  costUsd?: number;
}

export type AssistantStatusState = "idle" | "answering";

/** Historial para el backend: solo turnos completos (pregunta + respuesta final), últimos 24 mensajes. */
export function buildHistory(messages: ChatMessage[]): AssistantHistoryMessage[] {
  return messages
    .filter((m) => m.role !== "error" && !m.excluded && !m.streaming)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    .slice(-MAX_HISTORY_MESSAGES);
}

export function useAssistant() {
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  const [status, setStatusState] = useState<AssistantStatusState>("idle");
  const [toolLabel, setToolLabel] = useState<string | null>(null);

  // Refs espejo: send() lee el estado vigente sin depender del render.
  const messagesRef = useRef<ChatMessage[]>([]);
  const statusRef = useRef<AssistantStatusState>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const startedAt = useRef<number | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMessages = (update: (prev: ChatMessage[]) => ChatMessage[]) => {
    messagesRef.current = update(messagesRef.current);
    setMessagesState(messagesRef.current);
  };
  const setStatus = (s: AssistantStatusState) => {
    statusRef.current = s;
    setStatusState(s);
  };

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
    startedAt.current = null;
    setMessages(() => []);
    setToolLabel(null);
    setStatus("idle");
  }, []);

  const scheduleExpiry = useCallback(
    (delayMs: number) => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(() => {
        // Si justo está respondiendo, se espera a que termine.
        if (statusRef.current === "answering") scheduleExpiry(5000);
        else reset();
      }, delayMs);
    },
    [reset]
  );

  const send = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim().slice(0, MAX_QUESTION_CHARS);
      if (!question || statusRef.current === "answering") return;

      if (startedAt.current !== null && Date.now() - startedAt.current >= CONVERSATION_TTL_MS) reset();
      if (startedAt.current === null) {
        startedAt.current = Date.now();
        scheduleExpiry(CONVERSATION_TTL_MS);
      }

      const history = buildHistory(messagesRef.current);
      const userId = nextId.current++;
      const answerId = nextId.current++;
      setMessages((prev) => [...prev, { id: userId, role: "user", content: question }]);
      setToolLabel(null);
      setStatus("answering");

      const controller = new AbortController();
      abortRef.current = controller;

      let acc = "";
      let ended = false;
      let errorMessage: string | null = null;
      const upsertAnswer = (patch: Partial<ChatMessage>) =>
        setMessages((prev) => {
          const base: ChatMessage = { id: answerId, role: "assistant", content: "" };
          return prev.some((m) => m.id === answerId)
            ? prev.map((m) => (m.id === answerId ? { ...m, ...patch } : m))
            : [...prev, { ...base, ...patch }];
        });

      try {
        await ask(
          { question, history },
          {
            signal: controller.signal,
            onEvent: (ev) => {
              if (controller.signal.aborted || ended) return;
              if (ev.type === "tool") {
                setToolLabel(ev.label);
              } else if (ev.type === "text") {
                acc += ev.delta;
                setToolLabel(null);
                upsertAnswer({ content: acc, streaming: true });
              } else if (ev.type === "error") {
                errorMessage = ev.message;
              } else {
                ended = true;
                // El texto de `end` manda sobre los deltas acumulados.
                upsertAnswer({
                  content: ev.text,
                  streaming: false,
                  durationMs: ev.durationMs,
                  costUsd: ev.costUsd,
                });
              }
            },
          }
        );
      } catch (e) {
        if (controller.signal.aborted) return;
        errorMessage =
          e instanceof AssistantError ? e.message : "No pude responder esta consulta. Probá de nuevo en un rato.";
      }
      if (controller.signal.aborted) return;
      abortRef.current = null;

      if (!ended) {
        // Turno fallido: se muestra el aviso y nada de ese turno va al historial.
        const warning = errorMessage ?? CUT_MESSAGE;
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === userId || m.id === answerId ? { ...m, streaming: false, excluded: true } : m
          ),
          { id: nextId.current++, role: "error", content: warning },
        ]);
      }
      setToolLabel(null);
      setStatus("idle");
    },
    [reset, scheduleExpiry]
  );

  // Al desmontar: cancelar la consulta en curso y el timer de vencimiento.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    },
    []
  );

  return { messages, status, toolLabel, send, reset };
}
