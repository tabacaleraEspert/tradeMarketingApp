import type { KpiItem } from "@/lib/api";
import { formatPct, toneFor, toneClasses } from "./resumen-utils";

interface Props {
  kpi: KpiItem;
}

export function KpiCard({ kpi }: Props) {
  const hasData = kpi.denominator > 0;
  const ratio = hasData && kpi.target > 0 ? (kpi.actual / kpi.target) * 100 : 0;
  const colors = hasData ? toneClasses[toneFor(ratio)] : null;
  const barWidth = Math.max(0, Math.min(100, kpi.actual));
  const targetPos = Math.max(0, Math.min(100, kpi.target));
  const gap = !hasData || kpi.achieved ? null : Math.round((kpi.target - kpi.actual) * 10) / 10;

  return (
    <div className="border border-border rounded-lg p-3">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-semibold text-foreground">{kpi.name}</p>
        <span className="text-[10px] text-muted-foreground shrink-0">Peso {kpi.weight}%</span>
      </div>

      <div className="flex items-baseline gap-1 mb-1.5">
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
        <span className="text-muted-foreground shrink-0">{kpi.numerator} / {kpi.denominator} PDVs</span>
        {!hasData ? (
          <span className="font-semibold text-muted-foreground">Sin datos</span>
        ) : kpi.achieved ? (
          <span className="font-semibold text-green-600">✓ Logrado</span>
        ) : (
          <span className={`font-semibold ${colors?.text ?? ""}`}>falta {gap} pp</span>
        )}
      </div>
    </div>
  );
}
