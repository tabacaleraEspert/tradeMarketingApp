import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { IntelZona } from "@/lib/api";

const nf = (n: number) => n.toLocaleString("es-AR");

export interface ZonaDetailOrigin {
  dx: number; // distancia del click al centro del viewport
  dy: number;
}

export type ZonaDetailVariant = "stats" | "skus";

const BRANDS = ["Van Kiff", "Milenio", "Melbourne", "Mill", "Bold", "Lebonn", "Blank", "Dito", "Fleek"];

/** "Milenio Red" → marca atenuada + variante en negrita, para que la lista no
 * sea una pared de nombres repetidos. */
function SkuName({ name }: { name: string }) {
  const brand = BRANDS.find((b) => name.startsWith(b));
  const variant = brand ? name.slice(brand.length).trim() : "";
  if (!brand || !variant) return <span className="font-semibold text-foreground">{name}</span>;
  return (
    <span>
      <span className="text-muted-foreground">{brand}</span>{" "}
      <span className="font-semibold text-foreground">{variant}</span>
    </span>
  );
}

interface Props {
  zona: IntelZona;
  topSkus: Array<{ producto: string; pct: number }>;
  origin: ZonaDetailOrigin;
  variant: ZonaDetailVariant;
  onClose: () => void;
}

/**
 * Modal de detalle. Anima desde el punto exacto del click (translate + scale
 * hacia el centro); se cierra clickeando el fondo, la X o con Escape.
 * `variant="stats"`: los números completos de la zona (click en la fila).
 * `variant="skus"`: solo los 5 SKUs más presentes (click en la columna SKUs).
 */
export function ZonaDetailModal({ zona: z, topSkus, origin, variant, onClose }: Props) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const pctCensado = z.pdvs ? Math.round((z.censados / z.pdvs) * 100) : 0;
  const porTrade = z.trades30d ? Math.round(z.visitas30d / z.trades30d) : 0;

  const stats = [
    { l: "PDVs activos", v: nf(z.pdvs) },
    { l: "Censados", v: `${nf(z.censados)} (${pctCensado}%)` },
    { l: "Sin censar", v: nf(z.pdvs - z.censados) },
    { l: "Con Espert", v: nf(z.conEspert) },
    { l: "Cobertura", v: `${z.cobertura}%` },
    { l: "SKUs prom. por PDV", v: String(z.skusPromEspert) },
    { l: "Visitas 30 días", v: nf(z.visitas30d) },
    {
      l: "Trades activos",
      v: z.trades30d > 0 ? `${z.trades30d} · ${nf(porTrade)} visitas c/u` : "sin visitas",
    },
    {
      l: "Venden sueltos",
      v: z.sueltosConDato > 0 ? `${z.sueltosPct}% (de ${nf(z.sueltosConDato)} con dato)` : "sin dato",
    },
  ];

  const skus = topSkus.slice(0, 5);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-colors duration-300 ${
        entered ? "bg-black/50" : "bg-black/0"
      }`}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl transition-all duration-300 ease-out"
        style={{
          transform: entered
            ? "translate(0px, 0px) scale(1)"
            : `translate(${origin.dx}px, ${origin.dy}px) scale(0.3)`,
          opacity: entered ? 1 : 0,
        }}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-espert-gold">
              {variant === "skus" ? "SKUs en góndola" : "Zona"}
            </p>
            <h3 className="text-lg font-bold text-foreground">{z.zona}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-full text-muted-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {variant === "stats" && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 px-5 py-4 pb-5">
            {stats.map((s) => (
              <div key={s.l} className="flex items-baseline justify-between gap-2 border-b border-border/50 pb-1.5">
                <span className="text-xs text-muted-foreground">{s.l}</span>
                <span className="text-sm font-semibold text-foreground tabular-nums text-right">{s.v}</span>
              </div>
            ))}
          </div>
        )}

        {variant === "skus" && (
          <div className="px-5 py-4 pb-5">
            <p className="text-xs text-muted-foreground mb-3">
              Los 5 SKUs Espert más presentes en los PDVs censados de la zona.
            </p>
            {skus.length === 0 && (
              <p className="text-sm text-muted-foreground">Todavía no hay SKUs Espert relevados acá.</p>
            )}
            <div className="space-y-2">
              {skus.map((s, i) => (
                <div key={s.producto} className="flex items-center gap-3 text-sm">
                  <span className="w-4 text-right text-xs text-muted-foreground tabular-nums shrink-0">
                    {i + 1}
                  </span>
                  <span className="w-36 shrink-0 truncate">
                    <SkuName name={s.producto} />
                  </span>
                  <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-espert-gold rounded" style={{ width: `${s.pct}%` }} />
                  </div>
                  <span className="w-11 text-right tabular-nums font-bold text-foreground shrink-0">
                    {s.pct.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">
              % de PDVs censados de la zona que lo trabajan · Cerrá clickeando afuera
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
