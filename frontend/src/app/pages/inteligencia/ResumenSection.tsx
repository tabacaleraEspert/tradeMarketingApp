import { Card, CardContent } from "../../components/ui/card";
import type { IntelOverview } from "@/lib/api";

const SEVERITY_STYLES: Record<string, string> = {
  critica: "bg-red-600 text-white",
  alta: "bg-orange-500 text-white",
  media: "bg-amber-400 text-amber-950",
};

export function ResumenSection({ data }: { data: IntelOverview }) {
  const r = data.resumen;
  const tiles = [
    { v: r.pdvsActivos.toLocaleString("es-AR"), l: "PDVs activos" },
    { v: r.censados.toLocaleString("es-AR"), l: "Censados", d: `${r.pctCensado}% de la cartera` },
    { v: `${r.cobertura}%`, l: "Cobertura Espert", d: "donde censamos" },
    { v: r.conEspert.toLocaleString("es-AR"), l: "PDVs con Espert" },
    { v: r.relevamientos.toLocaleString("es-AR"), l: "Relevamientos" },
    { v: r.visitas.toLocaleString("es-AR"), l: "Visitas" },
  ];

  const maxMes = Math.max(1, ...data.visitasPorMes.map((m) => m.visitas));

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
            <h3 className="font-bold text-foreground text-sm mb-3">Visitas por mes</h3>
            <div className="flex items-end gap-2 h-28">
              {data.visitasPorMes.map((m) => (
                <div key={m.mes} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {m.visitas.toLocaleString("es-AR")}
                  </span>
                  <div
                    className="w-full rounded-t bg-espert-gold/80"
                    style={{ height: `${Math.max(4, (m.visitas / maxMes) * 80)}px` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{m.mes.slice(5)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <h3 className="font-bold text-foreground text-sm mb-1">Alertas activas</h3>
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
