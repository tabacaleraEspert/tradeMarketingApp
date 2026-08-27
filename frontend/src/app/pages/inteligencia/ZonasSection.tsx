import { Card, CardContent } from "../../components/ui/card";
import type { IntelZona } from "@/lib/api";

function coberturaColor(pct: number): string {
  if (pct >= 85) return "text-green-600 dark:text-green-400";
  if (pct >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function ZonasSection({ zonas }: { zonas: IntelZona[] }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-bold text-foreground text-sm mb-1">Análisis por zona</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Cobertura = % de PDVs censados que trabajan al menos un SKU Espert.
          SKUs prom. = profundidad de góndola donde ya estamos.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">Zona</th>
                <th className="py-2 pr-3 text-right">PDVs</th>
                <th className="py-2 pr-3 text-right">Censados</th>
                <th className="py-2 pr-3 text-right">Con Espert</th>
                <th className="py-2 pr-3 text-right">Cobertura</th>
                <th className="py-2 pr-3 text-right">SKUs prom.</th>
                <th className="py-2 pr-3 text-right">Visitas 30d</th>
                <th className="py-2 text-right">Trades 30d</th>
              </tr>
            </thead>
            <tbody>
              {zonas.map((z) => (
                <tr key={z.zonaId} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="py-2 pr-3 font-medium text-foreground whitespace-nowrap">{z.zona}</td>
                  <td className="py-2 pr-3 text-right">{z.pdvs.toLocaleString("es-AR")}</td>
                  <td className="py-2 pr-3 text-right">{z.censados.toLocaleString("es-AR")}</td>
                  <td className="py-2 pr-3 text-right">{z.conEspert.toLocaleString("es-AR")}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${coberturaColor(z.cobertura)}`}>
                    {z.cobertura}%
                  </td>
                  <td className="py-2 pr-3 text-right">{z.skusPromEspert}</td>
                  <td className="py-2 pr-3 text-right">{z.visitas30d.toLocaleString("es-AR")}</td>
                  <td className="py-2 text-right">{z.trades30d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
