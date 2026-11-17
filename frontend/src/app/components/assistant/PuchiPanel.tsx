import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Markdown, hasWideTable } from "./markdown";
import { fmtAnswerFooter } from "./format";
import { PuchiAvatar, type PuchiState } from "./PuchiAvatar";
import { PUCHI_LABEL } from "./PuchiFab";
import { MAX_QUESTION_CHARS, type ChatMessage, type useAssistant } from "./useAssistant";

const SUGGESTIONS = [
  "¿Cómo viene la cobertura por zona?",
  "¿Qué trades tienen menos visitas este mes?",
  "¿Cuántos PDVs llevan más de 60 días sin visita?",
];

const MAX_INPUT_HEIGHT = 96; // 4 líneas de 20px + padding

interface PuchiPanelProps {
  assistant: ReturnType<typeof useAssistant>;
  avatarState: PuchiState;
  onClose: () => void;
}

export function PuchiPanel({ assistant, avatarState, onClose }: PuchiPanelProps) {
  const { messages, status, toolLabel, send, reset } = assistant;
  const answering = status === "answering";
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // El foco entra al abrir y vuelve al input cuando termina cada respuesta.
  useEffect(() => {
    if (!answering) inputRef.current?.focus();
  }, [answering]);

  // Autoscroll al fondo con cada novedad (mensaje, delta, etiqueta de progreso).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, toolLabel, answering]);

  // Textarea que crece de 1 a 4 líneas.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);

  const submit = (text: string) => {
    if (answering || !text.trim()) return;
    setDraft("");
    void send(text);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft);
    }
  };

  const lastMessage = messages[messages.length - 1];
  const waitingForText = answering && !(lastMessage?.role === "assistant" && lastMessage.content);
  const showProgress = answering && (waitingForText || !!toolLabel);
  // Con una tabla ancha en la conversación el panel crece (en escritorio) para
  // que las columnas entren sin scroll lateral.
  const wide = messages.some((m) => m.role === "assistant" && hasWideTable(m.content));

  return (
    <section
      role="dialog"
      aria-label={PUCHI_LABEL}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className={`puchi-panel fixed z-40 inset-x-2 sm:left-auto sm:right-4 ${
        wide ? "sm:w-[min(640px,calc(100vw-2rem))]" : "sm:w-[420px]"
      } transition-[width] duration-200 bottom-[calc(1rem+68px+env(safe-area-inset-bottom))] h-[min(640px,calc(100dvh-120px))] flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl shadow-black/20`}
    >
      <div aria-hidden="true" className="puchi-cork h-1.5 shrink-0" />

      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <PuchiAvatar size={36} state={avatarState} />
        <h2 className="flex-1 text-base font-bold tracking-tight text-foreground">Puchi</h2>
        <button
          type="button"
          onClick={() => {
            reset();
            setDraft("");
            inputRef.current?.focus();
          }}
          disabled={answering || messages.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw size={14} />
          Empezar de nuevo
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={18} />
        </button>
      </header>

      <div ref={scrollRef} role="log" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-4 px-2 text-center">
            <PuchiAvatar size={96} state="idle" />
            <p className="max-w-[320px] text-sm leading-relaxed text-foreground">
              Hola, soy Puchi. Preguntame sobre PDVs, rutas, cobertura, oportunidades o el equipo. Por ejemplo:
            </p>
            <div className="flex w-full max-w-[340px] flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="rounded-xl border border-espert-gold/40 bg-secondary px-3 py-2 text-left text-sm font-medium text-secondary-foreground transition-colors hover:border-espert-gold hover:bg-espert-gold/15"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {showProgress && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <PuchiAvatar size={40} state="thinking" />
                <span>{toolLabel ?? "pensando…"}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 pt-2 pb-2">
        <div className="flex items-end gap-2 rounded-xl bg-input-background px-3 py-1.5 focus-within:ring-2 focus-within:ring-espert-gold/60">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKeyDown}
            disabled={answering}
            maxLength={MAX_QUESTION_CHARS}
            rows={1}
            aria-label="Tu consulta"
            placeholder={answering ? "Puchi está respondiendo…" : "Escribí tu consulta"}
            className="min-h-[32px] flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => submit(draft)}
            disabled={answering || !draft.trim()}
            aria-label="Enviar"
            className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
          >
            <ArrowUp size={16} />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] leading-tight text-muted-foreground">
          Puchi puede equivocarse. Verificá los números importantes.
        </p>
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-espert-gold-dark px-3 py-2 text-sm text-white dark:text-black">
        {message.content}
      </div>
    );
  }
  if (message.role === "error") {
    return (
      <div
        role="alert"
        className="flex max-w-[85%] items-start gap-2 self-start rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
      >
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{message.content}</span>
      </div>
    );
  }
  return (
    <div className={`flex min-w-0 flex-col gap-1 self-start ${hasWideTable(message.content) ? "max-w-full" : "max-w-[85%]"}`}>
      <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
        <Markdown text={message.content} />
      </div>
      {message.durationMs !== undefined && message.costUsd !== undefined && (
        <p className="px-1 text-[11px] tabular-nums text-muted-foreground">
          {fmtAnswerFooter(message.durationMs, message.costUsd)}
        </p>
      )}
    </div>
  );
}
