import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Slide {
  key: string;
  title: string;
  node: ReactNode;
}

/**
 * Navegación horizontal entre secciones, sin reload ni redirect: todos los
 * paneles quedan montados (conservan fetch, filtros y paginado) en una cinta
 * flex que transiciona con translateX. La altura del contenedor sigue a la del
 * panel activo (ResizeObserver) para que un panel corto no deje un vacío del
 * alto del más largo.
 *
 * Se navega con las flechas, los pills de título, ← → del teclado, scroll
 * horizontal del trackpad o swipe. El wheel ignora los gestos que nacen dentro
 * de una tabla con overflow-x-auto (ahí el gesto es para la tabla).
 */
export function SlideDeck({ slides, compact = false }: { slides: Slide[]; compact?: boolean }) {
  const [idx, setIdx] = useState(0);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const lastWheel = useRef(0);
  const touchX = useRef<number | null>(null);

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(slides.length - 1, i)),
    [slides.length]
  );
  const go = useCallback((i: number) => setIdx((prev) => {
    const next = Math.max(0, Math.min(slides.length - 1, i));
    return next === prev ? prev : next;
  }), [slides.length]);

  useEffect(() => {
    const el = panelRefs.current[idx];
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [idx]);

  useEffect(() => {
    // Las flechas del teclado navegan solo el deck principal — con decks
    // anidados, dos escuchas globales moverían los dos a la vez.
    if (compact) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") setIdx((i) => clamp(i + 1));
      if (e.key === "ArrowLeft") setIdx((i) => clamp(i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clamp, compact]);

  const onWheel = (e: React.WheelEvent) => {
    if ((e.target as Element).closest(".overflow-x-auto")) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 24) return;
    // El gesto lo consume el deck más interno: no debe mover también al padre.
    e.stopPropagation();
    const now = Date.now();
    if (now - lastWheel.current < 650) return;
    lastWheel.current = now;
    setIdx((i) => clamp(i + (e.deltaX > 0 ? 1 : -1)));
  };

  const onTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    e.stopPropagation();
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 60) return;
    setIdx((i) => clamp(i + (dx < 0 ? 1 : -1)));
  };

  return (
    <div>
      {/* Navegación por pills — solo el deck principal; en los mini-decks la
          señal de "hay más" son las cards asomando a los costados. Flechas y
          pills van dentro de una barra contenedora: son UN control. */}
      {!compact && (
      <div className="flex justify-center mb-3">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1.5 shadow-sm max-w-full overflow-x-auto">
          <button
            onClick={() => go(idx - 1)}
            disabled={idx === 0}
            aria-label="Sección anterior"
            className="p-1.5 rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors shrink-0"
          >
            <ChevronLeft size={16} />
          </button>
          {slides.map((s, i) => (
            <button
              key={s.key}
              onClick={() => go(i)}
              className={`px-3 py-1.5 text-xs rounded-full font-semibold transition-colors whitespace-nowrap ${
                i === idx
                  ? "bg-espert-gold text-white"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {s.title}
            </button>
          ))}
          <button
            onClick={() => go(idx + 1)}
            disabled={idx === slides.length - 1}
            aria-label="Sección siguiente"
            className="p-1.5 rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors shrink-0"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      )}

      {/* Cinta de paneles */}
      <div
        className="overflow-hidden transition-[height] duration-500 ease-in-out"
        style={height != null ? { height } : undefined}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className={`flex transition-transform duration-500 ease-in-out ${compact ? "gap-4" : ""}`}
          style={{
            // Compact: la card activa deja asomar la siguiente a la derecha y,
            // cuando no es la primera, también la anterior a la izquierda.
            transform: compact
              ? `translateX(calc(${idx} * (-92% - 1rem) + ${idx > 0 ? "4.5%" : "0%"}))`
              : `translateX(-${idx * 100}%)`,
          }}
        >
          {slides.map((s, i) => (
            <div
              key={s.key}
              ref={(el) => { panelRefs.current[i] = el; }}
              className={`${compact ? "min-w-[92%]" : "min-w-full"} self-start ${
                compact && i !== idx ? "cursor-pointer opacity-60 hover:opacity-80 transition-opacity" : ""
              }`}
              aria-hidden={i !== idx}
              onClick={compact && i !== idx ? () => go(i) : undefined}
              title={compact && i !== idx ? s.title : undefined}
            >
              {s.node}
            </div>
          ))}
        </div>
      </div>

      {/* Indicador de posición: el segmento activo se estira */}
      <div className={`flex justify-center gap-1.5 ${compact ? "mt-2" : "mt-3"}`}>
        {slides.map((s, i) => (
          <button
            key={s.key}
            onClick={() => go(i)}
            aria-label={`Ir a ${s.title}`}
            className={`h-1.5 rounded-full transition-all duration-300 ease-in-out ${
              i === idx
                ? "w-7 bg-espert-gold"
                : "w-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
