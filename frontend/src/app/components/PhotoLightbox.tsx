import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface LightboxPhoto {
  url: string;
  label?: string;
}

interface PhotoLightboxProps {
  photos: LightboxPhoto[];
  /** Índice abierto; null = cerrado */
  index: number | null;
  onClose: () => void;
}

/**
 * Visor de fotos a pantalla completa (mobile-first). Tap fuera de la imagen o
 * Esc cierra; flechas / swipe cambian de foto. El zoom lo hace el navegador
 * (pinch sobre la imagen) — no se reinventa.
 * z-[1100]: por encima del Modal de la app (z-[1001]) y de los mapas.
 */
export function PhotoLightbox({ photos, index, onClose }: PhotoLightboxProps) {
  const [current, setCurrent] = useState(index ?? 0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    if (index !== null) setCurrent(index);
  }, [index]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(photos.length - 1, c + 1));
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, photos.length, onClose]);

  if (index === null || photos.length === 0) return null;
  const photo = photos[Math.min(current, photos.length - 1)];
  const hasPrev = current > 0;
  const hasNext = current < photos.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Foto ampliada"
      className="fixed inset-0 z-[1100] bg-black/95 flex flex-col"
      onClick={onClose}
      onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        setTouchStartX(null);
        if (dx < -50 && hasNext) setCurrent((c) => c + 1);
        if (dx > 50 && hasPrev) setCurrent((c) => c - 1);
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-medium truncate">
          {photo.label ?? ""}
          {photos.length > 1 && (
            <span className="text-white/60 ml-2">{current + 1} / {photos.length}</span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="w-10 h-10 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center"
        >
          <X size={22} />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center min-h-0 px-2">
        <img
          src={photo.url}
          alt={photo.label ?? "foto"}
          className="max-w-full max-h-full object-contain select-none"
          onClick={(e) => e.stopPropagation()}
          draggable={false}
        />
      </div>
      {photos.length > 1 && (
        <div className="flex items-center justify-between px-4 py-4" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => setCurrent((c) => c - 1)}
            aria-label="Anterior"
            className="w-11 h-11 rounded-full bg-white/10 text-white disabled:opacity-30 flex items-center justify-center"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => setCurrent((c) => c + 1)}
            aria-label="Siguiente"
            className="w-11 h-11 rounded-full bg-white/10 text-white disabled:opacity-30 flex items-center justify-center"
          >
            <ChevronRight size={24} />
          </button>
        </div>
      )}
    </div>
  );
}
