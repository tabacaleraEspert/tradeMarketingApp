import { Card, CardContent } from "../../components/ui/card";
import type { IntelZona } from "@/lib/api";

const nf = (n: number) => n.toLocaleString("es-AR");
const H = 140; // alto útil de las barras en px

/**
 * Dos capas por zona, misma escala:
 *   gris = PDVs totales (volumen) · oro = PDVs que ya trabajan Espert
 * Ordenado por rendimiento por trade (PDVs con Espert que sostiene cada trade
 * activo): la zona que más logra con el equipo que tiene va primera.
 */
export function ZonasVolumenChart({ zonas }: { zonas: IntelZona[] }) {
  const porTradeDe = (z: IntelZona) => (z.trades30d > 0 ? z.conEspert / z.trades30d : 0);
  const ordered = [...zonas].sort((a, b) => porTradeDe(b) - porTradeDe(a));
  const max = Math.max(1, ...zonas.map((z) => z.pdvs));

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-bold text-foreground text-sm mb-1">
          ¿Qué peso tiene cada zona y qué tan representada está?
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Misma escala: el gris es el volumen total de PDVs, el dorado los que ya trabajan
          Espert. El número de arriba es el % censado. Ordenado por PDVs con Espert que
          sostiene cada trade: la zona que más rinde con su equipo va primera.
        </p>

        <div className="flex items-end gap-2 sm:gap-3 overflow-x-auto pb-1">
          {ordered.map((z) => {
            const pctCensado = z.pdvs ? Math.round((z.censados / z.pdvs) * 100) : 0;
            const porTrade = z.trades30d > 0 ? Math.round(z.conEspert / z.trades30d) : 0;
            const hTotal = Math.max(3, (z.pdvs / max) * H);
            const hEspert = Math.max(z.conEspert > 0 ? 2 : 0, (z.conEspert / max) * H);
            return (
              <div
                key={z.zonaId}
                className="flex-1 min-w-[64px] flex flex-col items-center"
                title={`${z.zona}: ${nf(z.pdvs)} PDVs · ${nf(z.censados)} censados (${pctCensado}%) · ${nf(z.conEspert)} con Espert · ${z.trades30d} trades activos`}
              >
                <span className="text-[11px] font-semibold text-foreground tabular-nums mb-1">
                  {pctCensado}%
                </span>
                <div className="relative w-full" style={{ height: H }}>
                  <div
                    className="absolute bottom-0 inset-x-0 rounded-t bg-muted-foreground/25"
                    style={{ height: hTotal }}
                  />
                  <div
                    className="absolute bottom-0 inset-x-0 rounded-t bg-espert-gold"
                    style={{ height: hEspert }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground text-center leading-tight mt-1.5 line-clamp-2">
                  {z.zona}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{nf(z.pdvs)}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {z.trades30d > 0 ? `${z.trades30d} trade${z.trades30d > 1 ? "s" : ""}` : "sin trades"}
                </span>
                <span
                  className="text-[10px] font-bold text-espert-gold tabular-nums whitespace-nowrap cursor-help"
                  title={`${nf(z.conEspert)} PDVs con Espert repartidos entre ${z.trades30d || 0} trades activos`}
                >
                  {z.trades30d > 0 ? `${nf(porTrade)} x trade` : "—"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-4 mt-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-muted-foreground/25" /> PDVs totales
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-espert-gold" /> Con Espert
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-bold text-espert-gold">N x trade</span> = PDVs con Espert por trade activo
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
