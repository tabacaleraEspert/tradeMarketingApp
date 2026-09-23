// Nivel 2 del drill: rutas foco ordenadas peor-primero por el KPI elegido.
import { Navigate, useNavigate, useParams } from "react-router";
import { ChevronRight, Map } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import {
  DRILLS,
  MONTH_NAMES,
  aggregateRoutes,
  censoAverage,
  faltanLabel,
  formatPct,
  goalFor,
  isDrillKey,
  rankRoutes,
  toneForGoal,
} from "./mi-gestion-utils";
import { useMiGestionData, usePeriod } from "./useMiGestionData";
import { DrillIcon, EmptyCard, ErrorCard, ListSkeleton, MiGestionHeader, OfflineNote, PctPill, TONE_CLASSES } from "./mi-gestion-ui";

export function MiGestionRutasPage() {
  const { kpi: kpiParam } = useParams();
  const navigate = useNavigate();
  const { period, param } = usePeriod();
  const { data, loading, error, fromCache, reload } = useMiGestionData(period);

  if (!isDrillKey(kpiParam)) return <Navigate to={`/mi-gestion?m=${param}`} replace />;
  const drill = DRILLS[kpiParam];

  const kpis = data?.myRow?.kpis;
  const kpi = kpis?.find((k) => k.key === drill.key);
  const goal = goalFor(drill, kpis);
  const rutas = data?.rutas ?? [];
  const agg = aggregateRoutes(rutas, drill);
  const actual = drill.key === "censo"
    ? censoAverage(rutas).total
    : kpi && kpi.denominator > 0 ? kpi.actual : agg.pct;
  const colors = TONE_CLASSES[toneForGoal(actual, goal)];
  const ranked = rankRoutes(rutas, drill);

  return (
    <div className="min-h-full bg-background pb-6">
      <MiGestionHeader
        eyebrow="Mi gestión TMR"
        title={drill.label}
        subtitle={`${MONTH_NAMES[period.month - 1]} ${period.year} › Rutas foco`}
        backTo={`/mi-gestion?m=${param}`}
        right={
          !loading && !error ? (
            <div className="text-right">
              <p className={`text-xl font-black leading-none ${actual >= goal ? "text-green-400" : actual >= goal - 20 ? "text-amber-300" : "text-red-400"}`}>
                {formatPct(actual)}%
              </p>
              <p className="text-[10px] text-white/60 mt-0.5">meta {formatPct(goal)}%</p>
            </div>
          ) : undefined
        }
      />

      <div className="px-4 -mt-3 space-y-3">
        {fromCache && !loading && <OfflineNote />}
        {loading && <ListSkeleton rows={4} />}
        {!loading && error && <ErrorCard message="No se pudieron cargar tus rutas." onRetry={reload} />}

        {!loading && !error && data && (
          <>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 shrink-0 rounded-full bg-[#A48242]/10 flex items-center justify-center text-[#A48242]">
                  <DrillIcon name={drill.icon} size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {agg.den > 0 ? `${agg.num} de ${agg.den} PDVs` : "Sin PDVs elegibles"}
                  </p>
                  <p className={`text-xs font-semibold ${colors.text}`}>
                    {rutas.length > 0 ? faltanLabel(agg, goal) : "sin rutas foco"}
                    {faltanLabel(agg, goal).startsWith("faltan") ? " para la meta" : ""}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground shrink-0">{ranked.length} rutas</p>
              </CardContent>
            </Card>

            {drill.key === "efectividad_visitas" && (
              <p className="text-[11px] text-muted-foreground px-1">
                El KPI oficial cuenta visitas efectivas (cobertura + POP + acción). Acá ves planificados visitados, para saber dónde ir.
              </p>
            )}

            {ranked.length === 0 && (
              <EmptyCard icon={<Map size={32} />} title="Sin rutas foco" text="No tenés rutas foco asignadas en este período." />
            )}

            <div className="space-y-2">
              {ranked.map(({ route, metric }) => {
                const empty = metric.den === 0;
                const canOpen = typeof route.route_id === "number";
                const label = faltanLabel(metric, goal);
                return (
                  <button
                    key={route.route_id ?? route.nombre}
                    type="button"
                    disabled={!canOpen}
                    onClick={() => canOpen && navigate(`/mi-gestion/${drill.key}/ruta/${route.route_id}?m=${param}`)}
                    className={`w-full text-left bg-card border border-border rounded-xl px-3.5 py-3 flex items-center gap-3 active:bg-muted/60 transition-colors ${
                      empty ? "opacity-60" : ""
                    } ${canOpen ? "" : "cursor-default"}`}
                  >
                    <PctPill pct={metric.pct} goal={goal} muted={empty} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{route.nombre}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {empty ? "sin PDVs elegibles" : `${metric.num}/${metric.den}`}
                        {!empty && (
                          <>
                            {" · "}
                            <span className={label.startsWith("faltan") ? `font-semibold ${TONE_CLASSES[toneForGoal(metric.pct, goal)].text}` : "text-green-600 font-semibold"}>
                              {label}
                            </span>
                          </>
                        )}
                        {" · "}
                        {route.pdvs} PDVs
                      </p>
                    </div>
                    {canOpen && <ChevronRight size={18} className="text-muted-foreground shrink-0" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
