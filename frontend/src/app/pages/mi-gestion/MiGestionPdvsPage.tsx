// Nivel 3 del drill: PDVs de una ruta ordenados por oportunidad de mejora del KPI.
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { ChevronDown, ChevronRight, Map } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import type { TmrPdvRow } from "@/lib/api";
import {
  DRILLS,
  buildQuickWinIndex,
  faltanLabel,
  flattenPdvs,
  goalFor,
  isDrillKey,
  pdvsForRoute,
  rankPdvs,
  splitEligible,
  toneForGoal,
  type Drill,
  type RankedPdv,
} from "./mi-gestion-utils";
import { useMiGestionData, usePeriod } from "./useMiGestionData";
import { EmptyCard, ErrorCard, ListSkeleton, MiGestionHeader, MiniBadge, OfflineNote, PctPill, ScorePill, TONE_CLASSES } from "./mi-gestion-ui";

function PdvRow({ item, drill, onOpen }: { item: RankedPdv; drill: Drill; onOpen: (p: TmrPdvRow) => void }) {
  const { pdv, rank } = item;
  const canOpen = typeof pdv.id === "number";
  // El backend manda "—" como placeholder cuando no hay ciudad/canal.
  const locCanal = [pdv.loc, pdv.canal].filter((v) => v && v !== "—").join(" · ");
  return (
    <button
      type="button"
      disabled={!canOpen}
      onClick={() => canOpen && onOpen(pdv)}
      className={`w-full text-left bg-card border border-border rounded-xl px-3.5 py-3 flex items-center gap-3 active:bg-muted/60 transition-colors ${
        rank.eligible ? "" : "opacity-70"
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{pdv.n}</p>
        {locCanal && <p className="text-[11px] text-muted-foreground truncate">{locCanal}</p>}
        <p className={`text-xs mt-0.5 ${rank.eligible ? "text-foreground/80" : "text-muted-foreground"}`}>{rank.reason}</p>
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {drill.key === "cobertura_skus" && <ScorePill score={pdv.score} />}
          <MiniBadge>vis {pdv.vis ?? 0}</MiniBadge>
          {pdv.planned && drill.key !== "efectividad_visitas" && <MiniBadge>planificado</MiniBadge>}
        </div>
      </div>
      {canOpen && <ChevronRight size={18} className="text-muted-foreground shrink-0" />}
    </button>
  );
}

export function MiGestionPdvsPage() {
  const { kpi: kpiParam, routeId: routeParam } = useParams();
  const navigate = useNavigate();
  const { period, param } = usePeriod();
  const { data, loading, error, fromCache, reload } = useMiGestionData(period);
  const [showRest, setShowRest] = useState(false);

  const routeId = Number(routeParam);
  if (!isDrillKey(kpiParam) || !Number.isFinite(routeId)) return <Navigate to={`/mi-gestion?m=${param}`} replace />;
  const drill = DRILLS[kpiParam];
  const backTo = `/mi-gestion/${drill.key}?m=${param}`;

  const kpis = data?.myRow?.kpis;
  const goal = goalFor(drill, kpis);
  const route = data?.rutas.find((r) => r.route_id === routeId);
  const metric = route ? drill.routeMetric(route) : null;
  const routePdvs = route ? pdvsForRoute(flattenPdvs(data?.pdvs), routeId, route.nombre) : [];
  const ranked = rankPdvs(routePdvs, drill, buildQuickWinIndex(data?.pdvs?.quick_wins));
  const { eligible, rest } = splitEligible(ranked);
  const label = metric ? faltanLabel(metric, goal) : "";
  const tone = metric ? TONE_CLASSES[toneForGoal(metric.pct, goal)] : null;

  const openPdv = (p: TmrPdvRow) => navigate(`/pos/${p.id}`);

  return (
    <div className="min-h-full bg-background pb-6">
      <MiGestionHeader
        eyebrow="Mi gestión TMR"
        title={route?.nombre ?? "Ruta"}
        subtitle={`${drill.label} › ${route?.nombre ?? "…"}`}
        backTo={backTo}
        right={
          metric && !loading ? (
            <PctPill pct={metric.pct} goal={goal} muted={metric.den === 0} />
          ) : undefined
        }
      />

      <div className="px-4 -mt-3 space-y-3">
        {fromCache && !loading && <OfflineNote />}
        {loading && <ListSkeleton rows={5} />}
        {!loading && error && <ErrorCard message="No se pudieron cargar los PDVs." onRetry={reload} />}

        {!loading && !error && data && !route && (
          <EmptyCard icon={<Map size={32} />} title="Ruta no encontrada" text="Volvé y elegí otra ruta." />
        )}

        {!loading && !error && data && route && metric && (
          <>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {metric.den > 0 ? `${metric.num} de ${metric.den} PDVs` : "Sin PDVs elegibles"}
                  </p>
                  <p className={`text-xs font-semibold ${label.startsWith("faltan") ? tone?.text : "text-muted-foreground"}`}>
                    {label}
                    {label.startsWith("faltan") ? ` para la meta de ${goal}%` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-black text-foreground leading-none">{eligible.length}</p>
                  <p className="text-[10px] text-muted-foreground">para accionar</p>
                </div>
              </CardContent>
            </Card>

            {routePdvs.length === 0 && (
              <EmptyCard icon={<Map size={32} />} title="Sin PDVs en esta ruta" text="La ruta no tiene PDVs activos asignados." />
            )}

            {routePdvs.length > 0 && eligible.length === 0 && (
              <EmptyCard icon={<span className="text-3xl">🎉</span>} title="Esta ruta ya cumple este KPI" text="Todos los PDVs están cubiertos o no aplican." />
            )}

            {eligible.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground px-1">
                  Oportunidades ({eligible.length})
                </p>
                {eligible.map((item) => (
                  <PdvRow key={item.pdv.id ?? item.pdv.n} item={item} drill={drill} onOpen={openPdv} />
                ))}
              </div>
            )}

            {rest.length > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowRest((v) => !v)}
                  className="w-full min-h-[40px] flex items-center justify-between px-1 text-[11px] font-semibold tracking-widest uppercase text-muted-foreground"
                >
                  <span>Ya cumplen / no aplican ({rest.length})</span>
                  <ChevronDown size={16} className={`transition-transform ${showRest ? "rotate-180" : ""}`} />
                </button>
                {showRest && rest.map((item) => (
                  <PdvRow key={item.pdv.id ?? item.pdv.n} item={item} drill={drill} onOpen={openPdv} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
