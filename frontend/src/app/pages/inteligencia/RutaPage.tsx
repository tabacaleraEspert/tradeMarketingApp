import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { intelligenceApi, type TmrRutaRow } from "@/lib/api";
import { TradePdvMatrix } from "./TradePdvMatrix";
import { DEFAULT_PERIOD, PeriodFilter, periodParams, type TmrPeriod } from "./PeriodFilter";

const nf = (n: number) => n.toLocaleString("es-AR");

function pctColor(pct: number): string {
  if (pct >= 80) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

const SCORE_STYLES: Record<string, string> = {
  "Excelente": "bg-green-600 text-white",
  "Muy Bueno": "bg-green-500 text-white",
  "Bueno": "bg-amber-400 text-amber-950",
  "Regular": "bg-orange-500 text-white",
  "No cuenta": "bg-muted text-muted-foreground",
};

interface Props {
  userId: number;
  tradeNombre: string;
  rutaNombre: string;
  onBack: () => void;
  /** Ir al tablero del trade dueño de la ruta. */
  onTradeClick?: () => void;
  /** Ir al tablero de la zona (por nombre). */
  onZonaClick?: (zona: string) => void;
}

/**
 * El tablero de UNA ruta foco: sus métricas del mes, los SKUs relevados en la
 * ruta (cobertura + precio) y la matriz de PDVs acotada a la ruta.
 */
export function RutaPage({ userId, tradeNombre, rutaNombre, onBack, onTradeClick, onZonaClick }: Props) {
  const [entered, setEntered] = useState(false);
  const [ruta, setRuta] = useState<TmrRutaRow | null>(null);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState<TmrPeriod>(DEFAULT_PERIOD);

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  const load = useCallback(() => {
    setError(false);
    intelligenceApi
      .tmrRoutes({ ...periodParams(period), user_id: userId })
      .then((resp) => {
        const found = resp.rutas.find((r) => r.nombre === rutaNombre);
        if (found) setRuta(found);
        else setError(true);
      })
      .catch(() => setError(true));
  }, [userId, rutaNombre, period]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    load();
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const skus = ruta
    ? Object.entries({ ...ruta.prod_cob })
        .map(([producto, cob]) => ({
          producto,
          cob,
          precio: ruta.precios_ruta?.[producto]?.avg ?? null,
        }))
        .sort((a, b) => b.cob - a.cob)
        .slice(0, 15)
    : [];

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
        <p className="text-xs font-semibold uppercase tracking-widest text-espert-gold">Ruta foco</p>
        <h2 className="text-2xl font-bold text-foreground">{rutaNombre}</h2>
        <p className="text-sm text-muted-foreground">
          {onTradeClick ? (
            <button
              onClick={onTradeClick}
              className="font-semibold text-foreground hover:text-espert-gold hover:underline transition-colors"
              title={`Ver el tablero de ${tradeNombre}`}
            >
              {tradeNombre}
            </button>
          ) : (
            tradeNombre
          )}
          {ruta?.zona && (
            <>
              {" · "}
              {onZonaClick ? (
                <button
                  onClick={() => onZonaClick(ruta.zona)}
                  className="font-semibold text-foreground hover:text-espert-gold hover:underline transition-colors"
                  title={`Ver el tablero de ${ruta.zona}`}
                >
                  {ruta.zona}
                </button>
              ) : (
                ruta.zona
              )}
            </>
          )}
          {ruta?.freq && <> · frecuencia {ruta.freq === "biweekly" ? "quincenal" : "mensual"}</>}
        </p>
        <div className="mt-3">
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No se pudo cargar la ruta.</p>
            <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </CardContent>
        </Card>
      )}

      {ruta && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { v: nf(ruta.pdvs), l: "PDVs en ruta" },
              { v: nf(ruta.relevados), l: "Relevados", d: `${ruta.buenos} con score bueno+` },
              { v: `${ruta.cob_score_pct}%`, l: "Score cobertura", cls: pctColor(ruta.cob_score_pct) },
              {
                v: `${ruta.ef_jul}%`, l: "Efectividad", cls: pctColor(ruta.ef_jul),
                d: `${nf(ruta.vis_plan)}/${nf(ruta.planned_mes)} planificados`,
              },
              { v: nf(ruta.vis_pdvs_jul), l: "PDVs visitados" },
              {
                v: nf(ruta.vende_sueltos), l: "Venden sueltos",
                d: `${nf(ruta.con_canje)} con canje`,
              },
              {
                v: nf(ruta.con_promo), l: "Con promo",
                d: `${nf(ruta.con_material)} con material`,
              },
            ].map((t) => (
              <Card key={t.l}>
                <CardContent className="p-4">
                  <p className={`text-xl font-bold tabular-nums ${t.cls ?? "text-foreground"}`}>{t.v}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">{t.l}</p>
                  {t.d && <p className="text-xs text-muted-foreground">{t.d}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          {ruta.score_dist && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(ruta.score_dist)
                .filter(([, n]) => n > 0)
                .map(([score, n]) => (
                  <span key={score} className={`px-2 py-1 rounded-full font-semibold ${SCORE_STYLES[score] ?? "bg-muted text-muted-foreground"}`}>
                    {score}: {n}
                  </span>
                ))}
            </div>
          )}

          {skus.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-bold text-foreground text-sm mb-1">SKUs en la ruta</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Cobertura (% de PDVs de la ruta que lo trabajan) y precio promedio relevado.
                </p>
                <div className="space-y-1.5">
                  {skus.map((s) => (
                    <div key={s.producto} className="flex items-center gap-2 text-xs">
                      <span className="w-36 shrink-0 truncate text-foreground">{s.producto}</span>
                      <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-espert-gold rounded" style={{ width: `${s.cob}%` }} />
                      </div>
                      <span className="w-9 text-right tabular-nums font-semibold text-foreground shrink-0">{s.cob}%</span>
                      <span className="w-16 text-right tabular-nums text-muted-foreground shrink-0">
                        {s.precio != null ? `$${nf(s.precio)}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4">
              <h3 className="font-bold text-foreground text-sm mb-3">PDVs de la ruta</h3>
              <TradePdvMatrix userId={userId} title={`${rutaNombre} · ${tradeNombre}`} fixedRuta={rutaNombre} period={period} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
