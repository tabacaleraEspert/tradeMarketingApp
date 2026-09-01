import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { intelligenceApi, type TmrTeamResponse, type TmrTeamRow } from "@/lib/api";
import { DEFAULT_PERIOD, PeriodFilter, periodParams, type TmrPeriod } from "./PeriodFilter";

const nf = (n: number) => n.toLocaleString("es-AR");

function pctClass(pct: number): string {
  if (pct >= 80) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function estado(r: TmrTeamRow): { label: string; cls: string } {
  if (r.tot === 0) return { label: "Sin actividad", cls: "bg-red-600 text-white" };
  if (r.gps < 80) return { label: "GPS bajo", cls: "bg-orange-500 text-white" };
  if (r.foto < 40) return { label: "Foto baja", cls: "bg-amber-400 text-amber-950" };
  return { label: "OK", cls: "bg-green-600 text-white" };
}

/**
 * La tabla cruda de equipo del Tablero TMR, tal cual se lee allá: una fila por
 * TMR con toda la actividad del mes. Misma fuente (/kpi/tmr/team).
 */
export function EquipoTablaCruda() {
  const [team, setTeam] = useState<TmrTeamResponse | null>(null);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState<TmrPeriod>(DEFAULT_PERIOD);

  const load = useCallback(() => {
    setError(false);
    intelligenceApi
      .tmrTeam(periodParams(period))
      .then(setTeam)
      .catch(() => setError(true));
  }, [period]);
  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h3 className="font-bold text-foreground text-sm">La tabla completa, sin vueltas</h3>
          {team && <span className="text-xs text-muted-foreground">{team.periodo_label}</span>}
        </div>
        <div className="mb-2">
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Una fila por TMR con toda la actividad del período — la misma tabla del Tablero TMR.
        </p>

        {error && (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm text-muted-foreground">No se pudo cargar la actividad del mes.</p>
            <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </div>
        )}
        {!team && !error && (
          <div className="flex items-center justify-center h-24">
            <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {team && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-3">TMR</th>
                  <th className="py-2 pr-3">Zona</th>
                  <th className="py-2 pr-3 text-right">Visitas</th>
                  <th className="py-2 pr-3 text-right">PDVs vis./asig.</th>
                  <th className="py-2 pr-3 text-right">GPS %</th>
                  <th className="py-2 pr-3 text-right">Foto %</th>
                  <th className="py-2 pr-3 text-right">Dur.</th>
                  <th className="py-2 pr-3 text-right" title="PDVs planificados visitados / planificados">Efectividad</th>
                  <th className="py-2 pr-3 text-right" title="% de visitas con al menos una acción ejecutada">% Acción</th>
                  <th className="py-2 pr-3 text-right">Entregas</th>
                  <th className="py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {team.trades.map((r, i) => {
                  const st = estado(r);
                  return (
                    <tr key={r.id} className="border-b border-border/60 hover:bg-muted/40">
                      <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5 pr-3 font-medium text-foreground whitespace-nowrap">{r.n}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">{r.zona || "—"}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold text-foreground">{nf(r.tot)}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {nf(r.vis)}<span className="text-muted-foreground">/{nf(r.pdvs)}</span>
                      </td>
                      <td className={`py-1.5 pr-3 text-right font-semibold ${r.tot ? pctClass(r.gps) : ""}`}>
                        {r.tot ? `${r.gps}%` : "—"}
                      </td>
                      <td className={`py-1.5 pr-3 text-right font-semibold ${r.tot ? pctClass(r.foto) : ""}`}>
                        {r.tot ? `${r.foto}%` : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{r.dur ? `${r.dur}m` : "—"}</td>
                      <td className={`py-1.5 pr-3 text-right font-semibold ${r.plan ? pctClass(r.ef_pct) : ""}`}>
                        {r.plan ? `${r.ef_pct}%` : "—"}
                      </td>
                      <td className={`py-1.5 pr-3 text-right ${r.tot ? pctClass(r.accion_pct) : ""}`}>
                        {r.tot ? `${r.accion_pct}%` : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-semibold text-foreground">{nf(r.tot_ent)}</td>
                      <td className="py-1.5">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
