import { useMemo } from "react";
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

interface Props {
  competencia: IntelOverview["competencia"];
  precioFab: IntelOverview["precioFab"];
}

export function CompetenciaSection({ competencia, precioFab }: Props) {
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

  const precios = Object.entries(precioFab).sort(([, a], [, b]) => b.prom - a.prom);
  const maxPrecio = Math.max(1, ...precios.map(([, v]) => v.prom));

  return (
    <section className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-1">Presencia por fabricante y zona (%)</h3>
          <p className="text-xs text-muted-foreground mb-3">
            % de PDVs censados (con cigarrillos) donde el fabricante tiene al menos un SKU trabajado.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1.5 pr-2">Fabricante</th>
                  <th className="py-1.5 px-1 text-center">Nacional</th>
                  {zonas.map((z) => (
                    <th key={z} className="py-1.5 px-1 text-center whitespace-nowrap">{z}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fabricantes.map((f) => (
                  <tr key={f}>
                    <td className={`py-0.5 pr-2 whitespace-nowrap font-medium ${f === "Espert" ? "text-espert-gold" : "text-foreground"}`}>
                      {f}
                    </td>
                    {["Nacional", ...zonas].map((z) => {
                      const pct = competencia[z]?.presencia[f];
                      return (
                        <td key={z} className="p-0.5">
                          <div
                            className="rounded text-center py-1 font-semibold"
                            style={heatStyle(pct, f === "Espert")}
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-1">Precio promedio del atado</h3>
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
    </section>
  );
}
