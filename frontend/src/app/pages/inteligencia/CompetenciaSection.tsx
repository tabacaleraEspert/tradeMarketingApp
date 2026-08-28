import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import type { IntelOverview } from "@/lib/api";

/** Celda del heatmap: intensidad proporcional a la presencia. */
function heatStyle(pct: number | undefined, own: boolean) {
  if (pct == null) return { background: "transparent" };
  const alpha = Math.min(0.88, Math.max(0.06, pct / 110));
  return {
    background: own ? `rgba(235, 104, 52, ${alpha})` : `rgba(42, 120, 214, ${alpha})`,
    color: alpha > 0.5 ? "#fff" : undefined,
  };
}

export function CompetenciaHeatmap({ competencia }: { competencia: IntelOverview["competencia"] }) {
  const zonas = Object.keys(competencia).filter((z) => z !== "Nacional");
  const fabricantes = useMemo(() => {
    const all = new Set<string>();
    Object.values(competencia).forEach((c) => Object.keys(c.presencia).forEach((f) => all.add(f)));
    // Espert primero, el resto por presencia nacional descendente.
    const nac = competencia["Nacional"]?.presencia ?? {};
    return [...all].sort((a, b) =>
      a === "Espert" ? -1 : b === "Espert" ? 1 : (nac[b] ?? 0) - (nac[a] ?? 0)
    );
  }, [competencia]);

  // Scroll horizontal asistido: flechas + sombras de borde + columna fija.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    updateEdges();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateEdges]);

  const scrollBy = (dir: 1 | -1) =>
    scrollRef.current?.scrollBy({ left: dir * 280, behavior: "smooth" });

  return (
    <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="font-bold text-foreground text-sm">¿Contra quién peleamos en cada zona?</h3>
            <div className="flex gap-1">
              <button
                onClick={() => scrollBy(-1)}
                disabled={!canLeft}
                aria-label="Desplazar a la izquierda"
                className="p-1 rounded-full border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => scrollBy(1)}
                disabled={!canRight}
                aria-label="Desplazar a la derecha"
                className="p-1 rounded-full border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            % de PDVs censados (con cigarrillos) donde el fabricante tiene al menos un SKU trabajado.
          </p>

          <div className="relative">
            {/* Sombras que avisan que hay más contenido hacia un lado */}
            {canLeft && (
              <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-20 bg-gradient-to-r from-card to-transparent" />
            )}
            {canRight && (
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-20 bg-gradient-to-l from-card to-transparent" />
            )}

            <div ref={scrollRef} onScroll={updateEdges} className="overflow-x-auto scroll-smooth">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 pr-2 sticky left-0 z-10 bg-card">Fabricante</th>
                    <th className="py-1.5 px-1 text-center">Nacional</th>
                    {zonas.map((z) => (
                      <th key={z} className="py-1.5 px-1 text-center whitespace-nowrap">{z}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fabricantes.map((f) => (
                    <tr key={f}>
                      <td
                        className={`py-0.5 pr-2 whitespace-nowrap font-medium sticky left-0 z-10 bg-card ${
                          f === "Espert" ? "text-espert-gold" : "text-foreground"
                        }`}
                      >
                        {f}
                      </td>
                      {["Nacional", ...zonas].map((z) => {
                        const pct = competencia[z]?.presencia[f];
                        return (
                          <td key={z} className="p-0.5">
                            <div
                              className="rounded text-center py-1 font-semibold min-w-[52px]"
                              style={heatStyle(pct, f === "Espert")}
                              title={pct != null ? `${f} en ${z}: ${pct}%` : `${f} sin presencia relevada en ${z}`}
                            >
                              {pct != null ? pct.toFixed(0) : "·"}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
    </Card>
  );
}

export function PreciosFabricantes({ precioFab }: { precioFab: IntelOverview["precioFab"] }) {
  const precios = Object.entries(precioFab).sort(([, a], [, b]) => b.prom - a.prom);
  const maxPrecio = Math.max(1, ...precios.map(([, v]) => v.prom));

  return (
      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-1">¿A qué precio juega cada uno?</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Solo precios validados (fuera de 0,25×–4× la mediana se descartan).
          </p>
          <div className="space-y-2">
            {precios.map(([fab, v]) => (
              <div key={fab} className="flex items-center gap-2 text-xs">
                <span className={`w-28 shrink-0 truncate ${fab === "Espert" ? "font-bold text-espert-gold" : "text-foreground"}`}>
                  {fab}
                </span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className={fab === "Espert" ? "h-full bg-espert-gold" : "h-full bg-[#2a78d6]"}
                    style={{ width: `${(v.prom / maxPrecio) * 100}%` }}
                  />
                </div>
                <span className="w-20 text-right tabular-nums font-semibold text-foreground">
                  ${v.prom.toLocaleString("es-AR")}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
  );
}
