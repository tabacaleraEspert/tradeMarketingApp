import { Card, CardContent } from "../../components/ui/card";
import type { IntelTrade } from "@/lib/api";

function pctColor(pct: number): string {
  if (pct >= 80) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function TradesSection({ trades }: { trades: IntelTrade[] }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-bold text-foreground text-sm mb-1">Performance por trade (últimos 30 días)</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Cartera, avance del censo, profundidad Espert lograda y disciplina de registro (GPS/foto).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">Trade</th>
                <th className="py-2 pr-3">Zona</th>
                <th className="py-2 pr-3 text-right">Cartera</th>
                <th className="py-2 pr-3 text-right">Censados</th>
                <th className="py-2 pr-3 text-right">% censado</th>
                <th className="py-2 pr-3 text-right">SKUs prom.</th>
                <th className="py-2 pr-3 text-right">Visitas 30d</th>
                <th className="py-2 pr-3 text-right">GPS</th>
                <th className="py-2 pr-3 text-right">Foto</th>
                <th className="py-2 text-right">Última visita</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.userId} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="py-2 pr-3 font-medium text-foreground whitespace-nowrap">{t.nombre}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{t.zona || "—"}</td>
                  <td className="py-2 pr-3 text-right">{t.cartera.toLocaleString("es-AR")}</td>
                  <td className="py-2 pr-3 text-right">{t.censados.toLocaleString("es-AR")}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${pctColor(t.pctCensado)}`}>{t.pctCensado}%</td>
                  <td className="py-2 pr-3 text-right">{t.skusProm}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-foreground">{t.visitas30d}</td>
                  <td className={`py-2 pr-3 text-right ${t.visitas30d ? pctColor(t.gps) : ""}`}>
                    {t.visitas30d ? `${t.gps}%` : "—"}
                  </td>
                  <td className={`py-2 pr-3 text-right ${t.visitas30d ? pctColor(t.foto) : ""}`}>
                    {t.visitas30d ? `${t.foto}%` : "—"}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap text-muted-foreground">
                    {t.ultimaVisita ?? "Nunca"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trades.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Sin trades visibles en tu jerarquía.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
