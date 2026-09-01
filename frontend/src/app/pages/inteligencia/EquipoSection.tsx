import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Grid3x3, RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { TradePdvMatrix } from "./TradePdvMatrix";
import { TradeRutaMatrix } from "./TradeRutaMatrix";
import { DEFAULT_PERIOD, PeriodFilter, periodParams, periodSuffix, type TmrPeriod } from "./PeriodFilter";
import {
  intelligenceApi,
  type IntelTrade,
  type IntelZona,
  type TmrTeamResponse,
  type TmrTeamRow,
} from "@/lib/api";

const nf = (n: number) => n.toLocaleString("es-AR");

function pctColor(pct: number): string {
  if (pct >= 80) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/** Métrica de porcentaje: solo el número con color de semáforo. */
function PctStat({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <p className={`text-sm font-bold tabular-nums ${pctColor(pct)}`}>{pct}%</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

interface Props {
  trades: IntelTrade[];
  zonas: IntelZona[];
  onTradeClick?: (trade: IntelTrade) => void;
  onRutaClick?: (ruta: string, trade: IntelTrade) => void;
}

/**
 * "¿Cómo está trabajando el equipo?" con granularidad Zona → TM rep.
 * Cruza dos fuentes: el censo histórico (overview.trades: cartera, censado,
 * SKUs prom) y la actividad del mes del Tablero TMR (/kpi/tmr/team:
 * efectividad, GPS, foto, duración, acciones, entregas).
 */
export function EquipoSection({ trades, zonas, onTradeClick, onRutaClick }: Props) {
  const [team, setTeam] = useState<TmrTeamResponse | null>(null);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState<TmrPeriod>(DEFAULT_PERIOD);
  const [openZona, setOpenZona] = useState<string | null>(null);
  // Con una sola zona en el scope (p.ej. dentro de la vista de zona) el
  // acordeón sobra: los trades van directo, ya desplegados.
  const singleZona = new Set(trades.map((t) => t.zona || "Sin zona")).size === 1;
  // Drill del trade (matriz PDVs o marca x ruta): uno abierto a la vez, son
  // los fetch caros del tablero.
  const [drill, setDrill] = useState<{ userId: number; tipo: "pdvs" | "rutas" } | null>(null);
  const toggleDrill = (userId: number, tipo: "pdvs" | "rutas") =>
    setDrill(drill?.userId === userId && drill.tipo === tipo ? null : { userId, tipo });

  const load = useCallback(() => {
    setError(false);
    intelligenceApi
      .tmrTeam(periodParams(period))
      .then(setTeam)
      .catch(() => setError(true));
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const tmrById = useMemo(() => {
    const map = new Map<number, TmrTeamRow>();
    team?.trades.forEach((r) => map.set(r.id, r));
    return map;
  }, [team]);

  const grupos = useMemo(() => {
    const byZona = new Map<string, IntelTrade[]>();
    for (const t of trades) {
      const key = t.zona || "Sin zona";
      byZona.set(key, [...(byZona.get(key) ?? []), t]);
    }
    const zonaInfo = new Map(zonas.map((z) => [z.zona, z]));
    return [...byZona.entries()]
      .map(([zona, ts]) => ({
        zona,
        info: zonaInfo.get(zona),
        trades: [...ts].sort((a, b) => b.visitas30d - a.visitas30d),
        visitas: ts.reduce((acc, t) => acc + t.visitas30d, 0),
      }))
      .sort((a, b) => b.visitas - a.visitas);
  }, [trades, zonas]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h3 className="font-bold text-foreground text-sm">¿Cómo está trabajando el equipo?</h3>
          {team && <span className="text-xs text-muted-foreground">{team.periodo_label}</span>}
        </div>
        <div className="mb-2">
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {singleZona
            ? "Tocá un TM rep para abrir su matriz de PDVs; con los botones cambiás a la vista por marca y ruta."
            : "Tocá una zona para abrir sus TM reps: censo (cartera, avance, góndola) + actividad del mes del Tablero TMR (efectividad, GPS, foto, duración, entregas)."}
        </p>

        {error && (
          <div className="text-center py-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              No se pudo cargar la actividad del mes — se muestra solo el censo.
            </p>
            <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </div>
        )}

        {/* Sin cajas anidadas: zonas y trades separados solo por divisores */}
        <div className="divide-y divide-border">
          {grupos.map((g) => {
            const abierta = singleZona || openZona === g.zona;
            return (
              <div key={g.zona}>
                {/* Cabecera de zona */}
                {!singleZona && (
                <button
                  onClick={() => setOpenZona(abierta ? null : g.zona)}
                  className="w-full flex items-center gap-3 py-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <ChevronDown
                    size={16}
                    className={`shrink-0 text-muted-foreground transition-transform duration-300 ${abierta ? "rotate-180" : ""}`}
                  />
                  <span className="font-semibold text-sm text-foreground flex-1 min-w-0 truncate">
                    {g.zona}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {g.trades.length} trade{g.trades.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 hidden sm:inline">
                    {nf(g.visitas)} visitas 30d
                  </span>
                  {g.info && (
                    <span className={`text-xs font-semibold tabular-nums shrink-0 ${pctColor(g.info.cobertura)}`}>
                      {g.info.cobertura}% cobertura
                    </span>
                  )}
                </button>
                )}

                {/* TM reps de la zona */}
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                    abierta ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className={`divide-y divide-border/40 pb-2 ${singleZona ? "" : "pl-6"}`}>
                      {g.trades.map((t) => {
                        const m = tmrById.get(t.userId);
                        const abierto = drill?.userId === t.userId;
                        return (
                          <div
                            key={t.userId}
                            // Abierto = un cuadro propio; los demás siguen como
                            // filas planas abajo.
                            className={`cursor-pointer transition-colors ${
                              abierto
                                ? "border border-border rounded-lg px-4 py-3 my-2 bg-muted/20 !border-t"
                                : "py-3 hover:bg-muted/20"
                            }`}
                            onClick={() =>
                              setDrill(abierto ? null : { userId: t.userId, tipo: "pdvs" })
                            }
                          >
                            <div className="flex items-baseline justify-between flex-wrap gap-1 mb-2">
                              <div className="min-w-0">
                                {onTradeClick ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onTradeClick(t); }}
                                    className="text-sm font-semibold text-foreground hover:text-espert-gold hover:underline transition-colors"
                                    title={`Ver el tablero de ${t.nombre}`}
                                  >
                                    {t.nombre}
                                  </button>
                                ) : (
                                  <span className="text-sm font-semibold text-foreground">{t.nombre}</span>
                                )}
                                {t.reportaA && (
                                  <span className="ml-2 text-[11px] text-muted-foreground">
                                    reporta a {t.reportaA}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                  última visita: {t.ultimaVisita ?? "nunca"}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleDrill(t.userId, "pdvs"); }}
                                  className={`inline-flex items-center gap-1 text-[11px] font-semibold transition-colors ${
                                    drill?.userId === t.userId && drill.tipo === "pdvs"
                                      ? "text-espert-gold"
                                      : "text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  <Grid3x3 size={12} /> Matriz PDVs
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleDrill(t.userId, "rutas"); }}
                                  className={`inline-flex items-center gap-1 text-[11px] font-semibold transition-colors ${
                                    drill?.userId === t.userId && drill.tipo === "rutas"
                                      ? "text-espert-gold"
                                      : "text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  <Grid3x3 size={12} /> Marca × Ruta
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2">
                              <div>
                                <p className="text-sm font-bold text-foreground tabular-nums">
                                  {m ? nf(m.tot) : nf(t.visitas30d)}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  visitas {m ? periodSuffix(period) : "30d"}
                                  {m && m.dur > 0 ? ` · ${m.dur} min prom.` : ""}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm font-bold text-foreground tabular-nums">
                                  {nf(t.censados)}<span className="text-muted-foreground font-normal">/{nf(t.cartera)}</span>
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  censados ({t.pctCensado}%) · {t.skusProm} SKUs/PDV
                                </p>
                              </div>
                              {m && <PctStat label="efectividad plan" pct={m.ef_pct} />}
                              <PctStat label="GPS" pct={m ? m.gps : t.gps} />
                              <PctStat label="foto" pct={m ? m.foto : t.foto} />
                              {m ? (
                                <div>
                                  <p className="text-sm font-bold text-foreground tabular-nums">{nf(m.tot_ent)}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    entregas · {m.accion_pct}% visitas con acción
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  <p className="text-sm font-bold text-foreground tabular-nums">{nf(t.conEspert)}</p>
                                  <p className="text-[10px] text-muted-foreground">PDVs con Espert</p>
                                </div>
                              )}
                            </div>

                            {drill?.userId === t.userId && (
                              <div className="mt-3 cursor-default" onClick={(e) => e.stopPropagation()}>
                                {drill.tipo === "pdvs" ? (
                                  <TradePdvMatrix
                                    userId={t.userId}
                                    title={t.nombre}
                                    period={period}
                                    onRutaClick={onRutaClick ? (ruta) => onRutaClick(ruta, t) : undefined}
                                  />
                                ) : (
                                  <TradeRutaMatrix userId={t.userId} title={t.nombre} period={period} />
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {g.trades.length === 0 && (
                        <p className="py-3 text-xs text-muted-foreground">Sin trades en esta zona.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
