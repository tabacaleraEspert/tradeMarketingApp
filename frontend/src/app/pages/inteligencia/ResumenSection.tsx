import { Card, CardContent } from "../../components/ui/card";
import type { IntelOverview } from "@/lib/api";

const SEVERITY_STYLES: Record<string, string> = {
  critica: "bg-red-600 text-white",
  alta: "bg-orange-500 text-white",
  media: "bg-amber-400 text-amber-950",
};

const nf = (n: number) => n.toLocaleString("es-AR");

/** Bloque "Contexto general": las cards que, leídas en orden, arman la foto
 * global de la operación antes de entrar al análisis en detalle. */
export function ResumenSection({ data }: { data: IntelOverview }) {
  const r = data.resumen;
  const zonas = data.zonas;
  const trades = data.trades;

  const equipo = trades.length;
  const activos = trades.filter((t) => t.visitas30d > 0);
  const visitas30d = trades.reduce((acc, t) => acc + t.visitas30d, 0);
  const promPorTrade = activos.length ? Math.round(visitas30d / activos.length) : 0;
  const sinCensar = r.pdvsActivos - r.censados;
  const conEspertZonas = zonas.filter((z) => z.skusPromEspert > 0);
  const skusProm = conEspertZonas.length
    ? Math.round(
        (conEspertZonas.reduce((acc, z) => acc + z.skusPromEspert * z.conEspert, 0) /
          Math.max(1, conEspertZonas.reduce((acc, z) => acc + z.conEspert, 0))) * 10
      ) / 10
    : 0;

  // Ordenadas para leerse como contexto: la cartera → cuánto la conocemos →
  // cómo nos va donde la conocemos → quiénes la trabajan y a qué ritmo.
  const tiles = [
    { v: nf(r.pdvsActivos), l: "PDVs activos", d: `en ${zonas.length} zonas` },
    { v: nf(r.censados), l: "Censados", d: `${r.pctCensado}% de la cartera` },
    { v: nf(sinCensar), l: "Sin censar", d: "la frontera de expansión" },
    { v: `${r.cobertura}%`, l: "Cobertura Espert", d: "donde censamos" },
    { v: nf(r.conEspert), l: "PDVs con Espert", d: `${skusProm} SKUs promedio` },
    { v: nf(equipo), l: "Equipo en campo", d: `${activos.length} activos este mes` },
    { v: nf(visitas30d), l: "Visitas 30 días", d: `${nf(promPorTrade)} por trade` },
    { v: nf(r.relevamientos), l: "Relevamientos", d: `${data.mesesDeDatos} meses de censo` },
  ];

  const maxMes = Math.max(1, ...data.visitasPorMes.map((m) => m.visitas));

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 pt-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-espert-gold shrink-0">
          Contexto general
        </h2>
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground shrink-0">
          La foto completa antes de entrar al detalle
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {tiles.map((t) => (
          <Card key={t.l}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-foreground tabular-nums">{t.v}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                {t.l}
              </p>
              {t.d && <p className="text-xs text-muted-foreground">{t.d}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <h3 className="font-bold text-foreground text-sm">¿Cómo evoluciona el ritmo de visitas?</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Arriba: visitas totales del equipo en el mes. Abajo: promedio por trade activo.
            </p>
            <div className="flex items-end gap-2 h-32">
              {data.visitasPorMes.map((m) => (
                <div key={m.mes} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <span className="text-[11px] font-semibold text-foreground tabular-nums">
                    {nf(m.visitas)}
                  </span>
                  <div
                    className="w-full rounded-t bg-espert-gold/80"
                    style={{ height: `${Math.max(4, (m.visitas / maxMes) * 78)}px` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{m.mes.slice(5)}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {nf(m.promPorTrade)}/trade
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <h3 className="font-bold text-foreground text-sm mb-1">¿Qué está gritando la data hoy?</h3>
            {data.alertas.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin alertas — todo en orden.</p>
            )}
            {data.alertas.map((a) => (
              <div key={a.tipo + a.titulo} className="flex items-start gap-2">
                <span
                  className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${SEVERITY_STYLES[a.severidad] ?? "bg-muted text-muted-foreground"}`}
                >
                  {a.severidad}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">{a.titulo}</p>
                  <p className="text-xs text-muted-foreground">{a.detalle}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
