/**
 * Filtro de período de las secciones de actividad (/kpi/tmr/*): chips de atajo
 * (este mes, mes anterior, últimos 3 meses, todo) + rango desde/hasta custom.
 * El estado vive en cada sección; `periodParams` lo traduce a los query params
 * que esperan los endpoints (year/month para el modo mes, date_from/date_to
 * para los rangos).
 */
import { useState } from "react";

export type PeriodChip = "mes" | "mes_ant" | "3m" | "todo" | "custom";

export interface TmrPeriod {
  chip: PeriodChip;
  /** Solo para chip "custom", formato yyyy-mm-dd. */
  from?: string;
  to?: string;
}

export const DEFAULT_PERIOD: TmrPeriod = { chip: "mes" };

export interface TmrPeriodParams {
  year: number;
  month: number;
  date_from?: string;
  date_to?: string;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function periodParams(p: TmrPeriod): TmrPeriodParams {
  const now = new Date();
  const base = { year: now.getFullYear(), month: now.getMonth() + 1 };
  switch (p.chip) {
    case "mes":
      return base;
    case "mes_ant": {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { year: prev.getFullYear(), month: prev.getMonth() + 1 };
    }
    case "3m":
      return { ...base, date_from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), date_to: iso(now) };
    case "todo":
      // Sin date_from el backend arranca desde el mínimo histórico.
      return { ...base, date_to: iso(now) };
    case "custom":
      return { ...base, date_from: p.from || undefined, date_to: p.to || undefined };
  }
}

/** Sufijo para los labels de métricas: "visitas del mes" vs "del período". */
export function periodSuffix(p: TmrPeriod): string {
  return p.chip === "mes" || p.chip === "mes_ant" ? "del mes" : "del período";
}

const CHIPS: Array<[PeriodChip, string]> = [
  ["mes", "Este mes"],
  ["mes_ant", "Mes anterior"],
  ["3m", "Últimos 3 meses"],
  ["todo", "Todo"],
];

interface Props {
  value: TmrPeriod;
  onChange: (p: TmrPeriod) => void;
  /** Muestra un spinner al final de los chips mientras se refetchea. */
  loading?: boolean;
}

export function PeriodFilter({ value, onChange, loading }: Props) {
  // Las fechas custom se conservan al pasar por otros chips y volver.
  const [customFrom, setCustomFrom] = useState(value.from ?? "");
  const [customTo, setCustomTo] = useState(value.to ?? "");
  const setCustom = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    onChange({ chip: "custom", from: from || undefined, to: to || undefined });
  };

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
      active ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
    }`;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Período:</span>
      {CHIPS.map(([k, label]) => (
        <button key={k} onClick={() => onChange({ chip: k })} className={chip(value.chip === k)}>
          {label}
        </button>
      ))}
      <button
        onClick={() => setCustom(customFrom, customTo)}
        className={chip(value.chip === "custom")}
      >
        Desde / hasta
      </button>
      {value.chip === "custom" && (
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
  );
}
