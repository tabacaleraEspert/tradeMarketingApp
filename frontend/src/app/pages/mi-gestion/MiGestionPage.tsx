// Nivel 1 del drill: anillo de variable + 5 tarjetas KPI + Censo. Tap → rutas.
import { useNavigate } from "react-router";
import { ChevronRight, Target } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import type { KpiItem } from "@/lib/api";
import {
  DRILLS,
  KPI_DRILL_KEYS,
  MONTH_NAMES,
  MONTH_SHORT,
  aggregateRoutes,
  censoAverage,
  faltanLabel,
  formatPct,
  goalFor,
  periodOptions,
  toneForGoal,
  type Drill,
} from "./mi-gestion-utils";
import { useMiGestionData, usePeriod } from "./useMiGestionData";
import { DrillIcon, ErrorCard, MiGestionHeader, OfflineNote, TONE_CLASSES } from "./mi-gestion-ui";

function VariableRing({ percent, size = 104 }: { percent: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  // Mismo semáforo que MisObjetivos: ≥80 verde, ≥50 ámbar, resto rojo.
  const colors = TONE_CLASSES[clamped >= 80 ? "green" : clamped >= 50 ? "yellow" : "red"];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth}
          stroke={colors.stroke} strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-2xl font-black ${colors.text}`}>{formatPct(clamped)}%</span>
      </div>
    </div>
  );
}

interface DrillCardProps {
  drill: Drill;
  kpi: KpiItem | undefined;
  actual: number;
  goal: number;
  faltan: string | null;
  nDeD?: string;
  sub?: string;
  onClick: () => void;
}

function DrillCard({ drill, kpi, actual, goal, faltan, nDeD, sub, onClick }: DrillCardProps) {
  const colors = TONE_CLASSES[toneForGoal(actual, goal)];
  const barWidth = Math.max(0, Math.min(100, actual));
  const targetPos = Math.max(0, Math.min(100, goal));
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-xl p-3.5 active:bg-muted/60 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 shrink-0 rounded-full bg-[#A48242]/10 flex items-center justify-center text-[#A48242]">
          <DrillIcon name={drill.icon} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{kpi?.name ?? drill.label}</p>
            {kpi && <span className="text-[10px] text-muted-foreground shrink-0">vale {formatPct(kpi.weight)}%</span>}
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-black ${colors.text}`}>{formatPct(actual)}%</span>
            <span className="text-[11px] text-muted-foreground">/ meta {formatPct(goal)}%</span>
            {sub && <span className="text-[11px] text-muted-foreground ml-auto">{sub}</span>}
          </div>
        </div>
        <ChevronRight size={18} className="text-muted-foreground shrink-0" />
      </div>
      <div className="relative w-full bg-muted rounded-full h-1.5 mt-2.5">
        <div className={`h-1.5 rounded-full ${colors.bar}`} style={{ width: `${barWidth}%` }} />
        <div className="absolute top-0 h-1.5 w-0.5 bg-foreground/50" style={{ left: `${targetPos}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px]">
        <span className="text-muted-foreground">{nDeD ?? ""}</span>
        {faltan && (
          <span className={`font-semibold ${faltan.startsWith("faltan") ? colors.text : "text-muted-foreground"}`}>
            {faltan.startsWith("faltan") ? `${faltan} para la meta` : faltan}
          </span>
        )}
      </div>
    </button>
  );
}

export function MiGestionPage() {
  const navigate = useNavigate();
  const { period, setPeriod, param } = usePeriod();
  const { data, loading, error, fromCache, reload } = useMiGestionData(period);

  const now = new Date();
  const options = periodOptions(now);
  const daysInMonth = new Date(period.year, period.month, 0).getDate();
  const partial = data?.myRow?.partial ?? (period.year === now.getFullYear() && period.month === now.getMonth() + 1);
  const day = data?.myRow?.day ?? now.getDate();

  const kpis = data?.myRow?.kpis;
  const rutas = data?.rutas ?? [];
  const censo = censoAverage(rutas);
  const censoGoal = goalFor(DRILLS.censo, kpis);

  return (
    <div className="min-h-full bg-background pb-6">
      <MiGestionHeader
        eyebrow="Mi gestión TMR"
        title={`${MONTH_NAMES[period.month - 1]} ${period.year}`}
        subtitle="Tocá un KPI para ver qué rutas y PDVs mover"
        backTo="/"
        right={
          partial ? (
            <Badge className="bg-amber-400/20 text-amber-300 border-0 text-[10px]">Día {day} de {daysInMonth}</Badge>
          ) : (
            <Badge className="bg-white/10 text-white/70 border-0 text-[10px]">Mes cerrado</Badge>
          )
        }
      >
        <div className="flex gap-1.5">
          {options.map((opt) => {
            const active = opt.year === period.year && opt.month === period.month;
            return (
              <button
                key={`${opt.year}-${opt.month}`}
                type="button"
                onClick={() => setPeriod(opt)}
                className={`min-h-[40px] px-4 rounded-full text-[11px] font-medium transition-colors ${
                  active ? "bg-[#A48242] text-white" : "bg-white/10 text-white/60 hover:bg-white/20"
                }`}
              >
                {MONTH_SHORT[opt.month - 1]}
              </button>
            );
          })}
        </div>
      </MiGestionHeader>

      <div className="px-4 -mt-3 space-y-3">
        {fromCache && !loading && <OfflineNote />}

        {loading && (
          <>
            <Card>
              <CardContent className="p-5 flex items-center gap-5">
                <Skeleton className="w-[104px] h-[104px] rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </CardContent>
            </Card>
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-3 w-24" />
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {!loading && error && <ErrorCard message="No se pudo cargar tu gestión." onRetry={reload} />}

        {!loading && !error && data && (
          <>
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <VariableRing percent={data.myRow?.variableTotal ?? 0} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Variable del mes</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data.myRow
                      ? "Cada KPI suma su peso solo si alcanzás la meta."
                      : "Sin objetivos configurados para este período."}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {rutas.length} {rutas.length === 1 ? "ruta foco" : "rutas foco"} · {censo.pdvs} PDVs
                  </p>
                </div>
              </CardContent>
            </Card>

            {!data.myRow && rutas.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center space-y-2">
                  <Target size={32} className="mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-semibold text-foreground">Sin datos para este mes</p>
                  <p className="text-xs text-muted-foreground">No hay objetivos ni rutas foco asignadas en este período.</p>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground px-1">KPIs del variable</p>
              {KPI_DRILL_KEYS.map((key) => {
                const drill = DRILLS[key];
                const kpi = kpis?.find((k) => k.key === key);
                const goal = goalFor(drill, kpis);
                // Fila oficial de /kpi/variable manda (actual, N de D y faltan salen de
                // numerator/denominator/target); la suma de rutas es solo fallback.
                const official = kpi && kpi.denominator > 0;
                const m = official
                  ? { num: kpi.numerator, den: kpi.denominator, pct: kpi.actual }
                  : aggregateRoutes(rutas, drill);
                return (
                  <DrillCard
                    key={key}
                    drill={drill}
                    kpi={kpi}
                    actual={m.pct}
                    goal={goal}
                    nDeD={m.den > 0 ? `${m.num} de ${m.den} PDVs` : ""}
                    faltan={official || rutas.length > 0 ? faltanLabel(m, goal) : null}
                    onClick={() => navigate(`/mi-gestion/${key}?m=${param}`)}
                  />
                );
              })}
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground px-1">Censo</p>
              <DrillCard
                drill={DRILLS.censo}
                kpi={undefined}
                actual={censo.total}
                goal={censoGoal}
                sub={`Espert ${formatPct(censo.espert)}%`}
                faltan={rutas.length > 0 ? faltanLabel(aggregateRoutes(rutas, DRILLS.censo), censoGoal) : null}
                onClick={() => navigate(`/mi-gestion/censo?m=${param}`)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
