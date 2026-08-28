import { Card, CardContent } from "../../components/ui/card";
import type { IntelZona } from "@/lib/api";

const nf = (n: number) => n.toLocaleString("es-AR");

/** Dos complementos del gráfico de volumen: dónde está el esfuerzo del equipo
 * (visitas 30d) y dónde tenemos más góndola (SKUs promedio), por zona. */
export function ZonasMiniCharts({ zonas }: { zonas: IntelZona[] }) {
  const porVisitas = [...zonas].sort((a, b) => b.visitas30d - a.visitas30d);
  const maxVisitas = Math.max(1, ...zonas.map((z) => z.visitas30d));
  const porSkus = [...zonas].sort((a, b) => b.skusPromEspert - a.skusPromEspert);
  const maxSkus = Math.max(1, ...zonas.map((z) => z.skusPromEspert));

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-1">¿Dónde está el esfuerzo?</h3>
          <p className="text-xs text-muted-foreground mb-3">Visitas de los últimos 30 días por zona.</p>
          <div className="space-y-1.5">
            {porVisitas.map((z) => (
              <div key={z.zonaId} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 truncate text-foreground">{z.zona}</span>
                <div className="flex-1 h-3.5 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-[#2a78d6] rounded"
                    style={{ width: `${(z.visitas30d / maxVisitas) * 100}%` }}
                  />
                </div>
                <span className="w-24 text-right tabular-nums text-muted-foreground shrink-0">
                  <span className="font-semibold text-foreground">{nf(z.visitas30d)}</span>
                  {z.trades30d > 0 ? ` · ${z.trades30d}t` : ""}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-1">¿Dónde tenemos más góndola?</h3>
          <p className="text-xs text-muted-foreground mb-3">
            SKUs Espert promedio por PDV (donde ya trabajamos), por zona.
          </p>
          <div className="space-y-1.5">
            {porSkus.map((z) => (
              <div key={z.zonaId} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 truncate text-foreground">{z.zona}</span>
                <div className="flex-1 h-3.5 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-espert-gold rounded"
                    style={{ width: `${(z.skusPromEspert / maxSkus) * 100}%` }}
                  />
                </div>
                <span className="w-10 text-right tabular-nums font-semibold text-foreground shrink-0">
                  {z.skusPromEspert}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
