import { useEffect, useLayoutEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import {
  intelligenceApi,
  type IntelOverview,
  type IntelTrade,
  type TmrTeamRow,
} from "@/lib/api";
import { TradeRutaMatrix } from "./TradeRutaMatrix";
import { TradePdvMatrix } from "./TradePdvMatrix";
import { ProveedoresCard } from "./ProveedoresCard";
import { OportunidadesSection } from "./OportunidadesSection";
import { DEFAULT_PERIOD, PeriodFilter, periodParams, periodSuffix, type TmrPeriod } from "./PeriodFilter";

const nf = (n: number) => n.toLocaleString("es-AR");

function pctColor(pct: number): string {
  if (pct >= 80) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

interface Props {
  trade: IntelTrade;
  overview: IntelOverview;
  onBack: () => void;
  onRutaClick?: (ruta: string) => void;
}

/**
 * El tablero dedicado a UN TM rep — el equivalente a filtrar por TMR en el
 * Tablero TMR estático: sus KPIs del mes, la cobertura por marca y ruta, la
 * matriz producto x PDV y sus oportunidades.
 */
export function TradePage({ trade: t, overview, onBack, onRutaClick }: Props) {
  const [entered, setEntered] = useState(false);
  const [m, setM] = useState<TmrTeamRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<TmrPeriod>(DEFAULT_PERIOD);

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    setLoading(true);
    intelligenceApi
      .tmrTeam(periodParams(period))
      .then((team) => setM(team.trades.find((r) => r.id === t.userId) ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [t.userId, period]);

  const tiles: Array<{ v: string; l: string; d?: string; cls?: string }> = [
    {
      v: m ? nf(m.tot) : nf(t.visitas30d),
      l: m ? `Visitas ${periodSuffix(period)}` : "Visitas 30d",
      d: m && m.dur > 0 ? `${m.dur} min promedio` : undefined,
    },
    {
      v: `${nf(t.censados)}/${nf(t.cartera)}`,
      l: "Censados",
      d: `${t.pctCensado}% de su cartera`,
    },
    { v: String(t.skusProm), l: "SKUs por PDV", d: `${nf(t.conEspert)} PDVs con Espert` },
    ...(m
      ? [
          { v: `${m.ef_pct}%`, l: "Efectividad plan", cls: pctColor(m.ef_pct) },
          { v: `${m.gps}%`, l: "GPS", cls: pctColor(m.gps) },
          { v: `${m.foto}%`, l: "Foto", cls: pctColor(m.foto) },
          {
            v: nf(m.tot_ent),
            l: "Entregas",
            d: `${m.accion_pct}% visitas con acción`,
          },
        ]
      : [
          { v: `${t.gps}%`, l: "GPS", cls: pctColor(t.gps) },
          { v: `${t.foto}%`, l: "Foto", cls: pctColor(t.foto) },
        ]),
  ];

  return (
    <div
      className="space-y-5 transition-all duration-300 ease-out"
      style={{ opacity: entered ? 1 : 0, transform: entered ? "translateX(0)" : "translateX(40px)" }}
    >
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline mb-2"
        >
          <ArrowLeft size={14} /> Volver
        </button>
        <p className="text-xs font-semibold uppercase tracking-widest text-espert-gold">TM Rep</p>
        <h2 className="text-2xl font-bold text-foreground">{t.nombre}</h2>
        <p className="text-sm text-muted-foreground">
          {t.zona || "Sin zona"}
          {t.reportaA && <> · reporta a {t.reportaA}</>}
          {t.ultimaVisita && <> · última visita: {t.ultimaVisita}</>}
        </p>
        <div className="mt-3">
          <PeriodFilter value={period} onChange={setPeriod} loading={loading} />
        </div>
      </div>

      <div className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 transition-opacity ${loading ? "opacity-50" : ""}`}>
        {tiles.map((tile) => (
          <Card key={tile.l}>
            <CardContent className="p-4">
              <p className={`text-xl font-bold tabular-nums ${tile.cls ?? "text-foreground"}`}>{tile.v}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                {tile.l}
              </p>
              {tile.d && <p className="text-xs text-muted-foreground">{tile.d}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-3">Cobertura por marca y ruta</h3>
          <TradeRutaMatrix userId={t.userId} title={t.nombre} period={period} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-bold text-foreground text-sm mb-3">Matriz producto × PDV</h3>
          <TradePdvMatrix userId={t.userId} title={t.nombre} period={period} onRutaClick={onRutaClick} />
        </CardContent>
      </Card>

      <ProveedoresCard userId={t.userId} />

      <OportunidadesSection zonas={overview.zonas} fixedTradeId={t.userId} />
    </div>
  );
}
