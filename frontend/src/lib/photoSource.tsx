/**
 * Selector de origen de foto: Cámara vs Galería.
 *
 * Por qué existe: en el WebView de Capacitor (APK), un <input type="file"
 * accept="image/*"> SIN el atributo `capture` abre solo la galería/archivos y NO
 * ofrece la cámara; con `capture="environment"` abre solo la cámara. No hay forma
 * confiable de ofrecer ambas con un único input. La solución portable (APK + PWA)
 * es dejar que el usuario elija: la opción "Cámara" setea `capture` en el input
 * justo antes de abrirlo; la opción "Galería" lo quita.
 *
 * Uso:
 *   const inputRef = useRef<HTMLInputElement>(null);
 *   const { openSheet, sheet } = usePhotoSource(inputRef);
 *   <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={...} />
 *   <button onClick={openSheet}>Tomar foto</button>
 *   {sheet}
 */

import { useState, useCallback } from "react";
import { Camera, Image as ImageIcon, X } from "lucide-react";

export type PhotoSource = "camera" | "gallery";

export function PhotoSourceSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (source: PhotoSource) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card rounded-t-2xl border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-foreground">Agregar foto</p>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onPick("camera")}
          className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted transition-colors"
        >
          <span className="w-10 h-10 rounded-full bg-espert-gold/15 flex items-center justify-center shrink-0">
            <Camera size={20} className="text-espert-gold" />
          </span>
          <span className="text-left">
            <span className="block font-medium text-foreground">Cámara</span>
            <span className="block text-xs text-muted-foreground">Sacar una foto ahora</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onPick("gallery")}
          className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted transition-colors"
        >
          <span className="w-10 h-10 rounded-full bg-espert-gold/15 flex items-center justify-center shrink-0">
            <ImageIcon size={20} className="text-espert-gold" />
          </span>
          <span className="text-left">
            <span className="block font-medium text-foreground">Galería</span>
            <span className="block text-xs text-muted-foreground">Elegir una imagen guardada</span>
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Hook que conecta un <input type=file> con el selector Cámara/Galería.
 * Devuelve `openSheet` (abrir el selector) y `sheet` (el JSX a renderizar).
 */
export function usePhotoSource(inputRef: React.RefObject<HTMLInputElement | null>) {
  const [open, setOpen] = useState(false);
  const openSheet = useCallback(() => setOpen(true), []);
  const closeSheet = useCallback(() => setOpen(false), []);

  const pick = useCallback(
    (source: PhotoSource) => {
      setOpen(false);
      const el = inputRef.current;
      if (!el) return;
      // Setear/quitar `capture` decide cámara vs galería en el WebView.
      if (source === "camera") el.setAttribute("capture", "environment");
      else el.removeAttribute("capture");
      el.click();
    },
    [inputRef]
  );

  const sheet = <PhotoSourceSheet open={open} onClose={closeSheet} onPick={pick} />;
  return { openSheet, closeSheet, sheet, sourceSheetOpen: open };
}
