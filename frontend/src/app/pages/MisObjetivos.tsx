import { useCallback, useEffect, useState } from "react";
import { Target, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { getCurrentUser } from "../lib/auth";
import { kpiApi, type KpiVariableRow, type KpiItem } from "@/lib/api";

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type Tone = "green" | "amber" | "red";

// Semáforo de cumplimiento: verde >=80, ámbar >=50, rojo <50 (mismo criterio que el tablero TMR).
function toneFor(pct: number): Tone {
  if (pct >= 80) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

const TONE_CLASSES: Record<Tone, { text: string; bar: string; stroke: string }> = {
  green: { text: "text-green-600", bar: "bg-green-500", stroke: "#16a34a" },
  amber: { text: "text-amber-600", bar: "bg-amber-500", stroke: "#d97706" },
  red: { text: "text-red-600", bar: "bg-red-500", stroke: "#dc2626" },
};

function VariableRing({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const size = 140;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const colors = TONE_CLASSES[toneFor(clamped)];

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
        <span className={`text-3xl font-black ${colors.text}`}>{formatPct(clamped)}%</span>
      </div>
    </div>
  );
}

function KpiRow({ kpi }: { kpi: KpiItem }) {
  const hasData = kpi.denominator > 0;
  const ratio = hasData && kpi.target > 0 ? (kpi.actual / kpi.target) * 100 : 0;
  const colors = hasData ? TONE_CLASSES[toneFor(ratio)] : null;
  const barWidth = Math.max(0, Math.min(100, kpi.actual));
  const targetPos = Math.max(0, Math.min(100, kpi.target));
  const diff = Math.round((kpi.actual - kpi.target) * 10) / 10;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="text-sm font-semibold text-foreground">{kpi.name}</p>
          <span className="text-[10px] text-muted-foreground shrink-0">vale {formatPct(kpi.weight)}%</span>
        </div>

        <div className="flex items-baseline gap-1 mb-2">
          <span className={`text-xl font-black ${colors ? colors.text : "text-muted-foreground"}`}>
            {formatPct(kpi.actual)}%
          </span>
          <span className="text-xs text-muted-foreground">/ meta {formatPct(kpi.target)}%</span>
        </div>

        <div className="relative w-full bg-muted rounded-full h-2 mb-2">
          <div
            className={`h-2 rounded-full transition-all ${colors ? colors.bar : "bg-muted-foreground/40"}`}
            style={{ width: `${barWidth}%` }}
          />
          <div
            className="absolute top-0 h-2 w-0.5 bg-foreground/50"
            style={{ left: `${targetPos}%` }}
            title={`Meta: ${formatPct(kpi.target)}%`}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] gap-2">
          <span className="text-muted-foreground shrink-0">{kpi.numerator} de {kpi.denominator} PDVs</span>
          {!hasData ? (
            <span className="font-semibold text-muted-foreground">Sin datos</span>
          ) : kpi.achieved ? (
            <span className="font-semibold text-green-600">✓ Logrado{diff > 0 ? ` (+${formatPct(diff)} pts)` : ""}</span>
          ) : (
            <span className={`font-semibold ${colors?.text ?? ""}`}>Te faltan {formatPct(Math.abs(diff))} pp</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function MisObjetivos() {
  const currentUser = getCurrentUser();
  const isAdminRole = ["admin", "regional_manager", "territory_manager", "supervisor", "ejecutivo"].includes(currentUser.role);

  const now = new Date();
  const monthOptions = Array.from({ length: 3 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const [selected, setSelected] = useState(monthOptions[0]);
  const { year, month } = selected;
  const daysInMonth = new Date(year, month, 0).getDate();

  const [rows, setRows] = useState<KpiVariableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    kpiApi.variable({ year, month })
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const myRow = rows.find((r) => r.userId === Number(currentUser.id));
  // Fallback client-side igual al del tablero (TableroPage.tsx) mientras no hay
  // fila propia todavía (loading / sin datos): permite mostrar el badge del header ya.
  const partial = myRow?.partial ?? (year === now.getFullYear() && month === now.getMonth() + 1);
  const day = myRow?.day ?? now.getDate();

  return (
    <div className="min-h-screen bg-background pb-6">
      {/* Header */}
      <div className="bg-black text-white px-5 pt-5 pb-5 rounded-b-2xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[#A48242] text-[10px] font-semibold tracking-widest uppercase">Mis objetivos</p>
            <h1 className="text-lg font-bold mt-0.5">{MONTH_NAMES[month - 1]} {year}</h1>
          </div>
          {partial ? (
            <Badge className="bg-amber-400/20 text-amber-300 border-0 text-[10px] shrink-0">
              En curso · día {day} de {daysInMonth}
            </Badge>
          ) : (
            <Badge className="bg-white/10 text-white/70 border-0 text-[10px] shrink-0">Mes cerrado</Badge>
          )}
        </div>

        {/* Selector de mes: actual + 2 anteriores */}
        <div className="flex gap-1.5">
          {monthOptions.map((opt) => (
            <button
              key={`${opt.year}-${opt.month}`}
              onClick={() => setSelected(opt)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                opt.year === year && opt.month === month
                  ? "bg-[#A48242] text-white"
                  : "bg-white/10 text-white/60 hover:bg-white/20"
              }`}
            >
              {MONTH_SHORT[opt.month - 1]}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 -mt-3 space-y-3">
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

        {!loading && error && (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <AlertCircle size={32} className="mx-auto text-destructive/70" />
              <p className="text-sm text-muted-foreground">No se pudieron cargar tus objetivos.</p>
              <button
                onClick={load}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline mx-auto"
              >
                <RefreshCw size={12} /> Reintentar
              </button>
            </CardContent>
          </Card>
        )}

        {!loading && !error && !myRow && (
          <Card>
            <CardContent className="p-6 text-center space-y-2">
              <Target size={32} className="mx-auto text-muted-foreground/50" />
              <p className="text-sm font-semibold text-foreground">
                {isAdminRole ? "Esta vista es para TM Reps" : "Sin objetivos configurados"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isAdminRole
                  ? "Tu rol no tiene objetivos comerciales asignados."
                  : "Todavía no hay metas configuradas para vos en este período."}
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && !error && myRow && myRow.kpis.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center space-y-2">
              <Target size={32} className="mx-auto text-muted-foreground/50" />
              <p className="text-sm font-semibold text-foreground">Sin objetivos configurados</p>
              <p className="text-xs text-muted-foreground">Todavía no hay metas configuradas para vos en este período.</p>
            </CardContent>
          </Card>
        )}

        {!loading && !error && myRow && myRow.kpis.length > 0 && (
          <>
            <Card>
              <CardContent className="p-5 flex flex-col items-center">
                <VariableRing percent={myRow.variableTotal} />
                <p className="text-xs text-muted-foreground mt-2">de cumplimiento</p>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {myRow.kpis.map((kpi) => <KpiRow key={kpi.key} kpi={kpi} />)}
            </div>

            <p className="text-[11px] text-muted-foreground text-center px-2 pt-1">
              Cada KPI suma su peso al total solo si alcanzás su meta del mes.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
