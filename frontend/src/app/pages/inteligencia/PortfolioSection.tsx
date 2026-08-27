import { Card, CardContent } from "../../components/ui/card";
import type { IntelPortfolioRow, IntelZona } from "@/lib/api";

const TOP_SKUS = 14;

function heatStyle(pct: number | undefined) {
  if (!pct) return { background: "transparent" };
  const alpha = Math.min(0.88, Math.max(0.06, pct / 110));
  return { background: `rgba(235, 104, 52, ${alpha})`, color: alpha > 0.5 ? "#fff" : undefined };
}

interface Props {
  portfolio: IntelPortfolioRow[];
  zonas: IntelZona[];
}

export function PortfolioSection({ portfolio, zonas }: Props) {
  const top = portfolio.slice(0, TOP_SKUS);
  const maxPct = Math.max(1, ...top.map((p) => p.pct));
  const zonaNames = zonas.map((z) => z.zona);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-bold text-foreground text-sm mb-1">Portfolio Espert en góndola</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Presencia de cada SKU sobre los PDVs censados — nacional y por zona (top {TOP_SKUS}).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1.5 pr-2">SKU</th>
                <th className="py-1.5 pr-2 text-right">PDVs</th>
                <th className="py-1.5 pr-2 w-32">Nacional</th>
                <th className="py-1.5 pr-2 text-right">Precio</th>
                {zonaNames.map((z) => (
                  <th key={z} className="py-1.5 px-1 text-center whitespace-nowrap">{z}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.producto}>
                  <td className="py-0.5 pr-2 whitespace-nowrap font-medium text-foreground">
                    {p.producto}
                    {p.categoria !== "cigarrillos" && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground uppercase">{p.categoria}</span>
                    )}
                  </td>
                  <td className="py-0.5 pr-2 text-right">{p.pdvs.toLocaleString("es-AR")}</td>
                  <td className="py-0.5 pr-2">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-espert-gold" style={{ width: `${(p.pct / maxPct) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right font-semibold text-foreground">{p.pct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="py-0.5 pr-2 text-right">
                    {p.precioProm != null ? `$${p.precioProm.toLocaleString("es-AR")}` : "—"}
                  </td>
                  {zonaNames.map((z) => {
                    const pct = p.porZona[z];
                    return (
                      <td key={z} className="p-0.5">
                        <div className="rounded text-center py-0.5 font-semibold" style={heatStyle(pct)}>
                          {pct != null && pct > 0 ? pct.toFixed(0) : "·"}
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
  );
}
