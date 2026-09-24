/**
 * Filtro de rango de "Comportamiento": chips de preset + desde/hasta custom.
 * Mismo look que `PeriodFilter` (chips dorados). Muestra el rango resuelto y,
 * para custom, un error inline si supera los 92 días (no dispara el fetch).
 */
import { useState } from "react";
import {
  PRESET_LABELS,
  formatRangeLabel,
  rangeError,
  resolveRange,
  type RangeValue,
} from "./range-utils";

export const DEFAULT_RANGE: RangeValue = { preset: "esta_semana" };

interface Props {
  value: RangeValue;
  onChange: (v: RangeValue) => void;
  loading?: boolean;
}

export function RangeFilter({ value, onChange, loading }: Props) {
  const [customFrom, setCustomFrom] = useState(value.from ?? "");
  const [customTo, setCustomTo] = useState(value.to ?? "");
  const setCustom = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    onChange({ preset: "custom", from: from || undefined, to: to || undefined });
  };

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
      active ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
    }`;

  const error = rangeError(value);
  const resolved = error ? null : resolveRange(value);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Período:</span>
        {PRESET_LABELS.map(([k, label]) => (
          <button key={k} onClick={() => onChange({ preset: k })} className={chip(value.preset === k)}>
            {label}
          </button>
        ))}
        <button onClick={() => setCustom(customFrom, customTo)} className={chip(value.preset === "custom")}>
          Desde / hasta
        </button>
        {value.preset === "custom" && (
          <span className="inline-flex items-center gap-1">
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustom(e.target.value, customTo)}
              className="h-6 px-1.5 rounded border border-border bg-card text-[11px] text-foreground"
              aria-label="Desde"
            />
            <span className="text-[11px] text-muted-foreground">→</span>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustom(customFrom, e.target.value)}
              className="h-6 px-1.5 rounded border border-border bg-card text-[11px] text-foreground"
              aria-label="Hasta"
            />
          </span>
        )}
        {loading && (
          <span
            className="w-3.5 h-3.5 border-2 border-espert-gold border-t-transparent rounded-full animate-spin"
            role="status"
            aria-label="Cargando período"
          />
        )}
      </div>
      {error ? (
        <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
      ) : resolved ? (
        <p className="text-[11px] text-muted-foreground">
          Mostrando <span className="font-semibold text-foreground">{formatRangeLabel(resolved)}</span>
        </p>
      ) : null}
    </div>
  );
}
