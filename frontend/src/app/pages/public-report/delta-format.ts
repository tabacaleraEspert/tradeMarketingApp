/** Formato de las comparativas del reporte (mismo texto que el mail: backend
 * `behavior_report_mail.fmt_delta`). */
import type { BehaviorKpiDelta } from "@/lib/api";

const num = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });

/** "▲ +32 (+4%)", "▼ −3 pp", "= sin cambio", "—" (sin dato). */
export function fmtDelta(d: BehaviorKpiDelta | null | undefined, compact = false): string {
  if (!d) return "—";
  if (d.diff === 0) return compact ? "=" : "= sin cambio";
  const arrow = d.diff > 0 ? "▲" : "▼";
  const sign = d.diff > 0 ? "+" : "−";
  let txt = `${arrow} ${sign}${num(Math.abs(d.diff))}${d.unit === "pp" ? " pp" : ""}`;
  if (d.pct != null && !compact) txt += ` (${d.pct > 0 ? "+" : d.pct < 0 ? "−" : ""}${Math.abs(d.pct)}%)`;
  return txt;
}

export function deltaClass(d: BehaviorKpiDelta | null | undefined): string {
  if (!d || d.better == null) return "text-muted-foreground";
  return d.better ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
}

/** "2026-09-07" → "07/09". */
export const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
