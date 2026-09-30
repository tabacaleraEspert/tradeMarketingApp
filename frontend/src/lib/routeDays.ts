/**
 * Fechas de trabajo de una ruta según su frecuencia — única implementación para
 * los editores (RouteEditorPage alta/edición y MyRouteEditorPage), que antes
 * tenían tres copias con diferencias (p.ej. "mensual" no generaba días en edición
 * y el alta no alineaba la quincena).
 *
 * Fechas como "YYYY-MM-DD"; la aritmética es en UTC puro (sin corrimientos por zona).
 * `FrequencyConfig.day` / `days` usan getDay() de JS: 0 = domingo … 6 = sábado.
 * Espejo backend: `routers/routes.py` (check-overlap, `monthly_dates`).
 */

export interface PlanRouteDatesInput {
  frequencyType: string | null | undefined;
  frequencyConfig: string | null | undefined;
  /** Hoy en Argentina ("YYYY-MM-DD"). */
  today: string;
  weeksAhead?: number;
  /** Fecha de fin de la ruta (inclusive): no se generan días después. */
  endDate?: string | null;
  /** Fechas que ya existen y no hay que volver a crear. */
  skip?: Set<string>;
}

interface FreqConfig {
  startDate?: string;
  day?: number;
  days?: number[];
  interval?: number;
}

const DAY_MS = 86_400_000;
const parse = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Mensual: mismo día del mes que `anchor`; en meses más cortos, el último día. */
export function monthlyDates(from: string, to: string, anchor: string): string[] {
  const a = parse(anchor);
  const start = parse(from) > a ? parse(from) : a;
  const end = parse(to);
  const out: string[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (;;) {
    const d = new Date(Date.UTC(y, m, Math.min(a.getUTCDate(), daysInMonth(y, m))));
    if (d > end) break;
    if (d >= start) out.push(fmt(d));
    m += 1;
    if (m === 12) { m = 0; y += 1; }
  }
  return out;
}

function parseConfig(raw: string | null | undefined): FreqConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as FreqConfig;
  } catch {
    return {};
  }
}

/** Fechas a crear, en orden, desde max(hoy, inicio) hasta min(hoy + semanas, fin). */
export function planRouteDates({
  frequencyType,
  frequencyConfig,
  today,
  weeksAhead = 8,
  endDate,
  skip,
}: PlanRouteDatesInput): string[] {
  if (!frequencyType) return [];
  const cfg = parseConfig(frequencyConfig);
  const todayD = parse(today);
  const startD = cfg.startDate ? parse(cfg.startDate) : todayD;
  const from = startD > todayD ? startD : todayD;
  let to = addDays(todayD, weeksAhead * 7);
  if (endDate && parse(endDate) < to) to = parse(endDate);
  if (from > to) return [];

  const dates: string[] = [];
  const everyNDays = (n: number) => {
    // Anclado al inicio (no a hoy): la serie no se corre al regenerar.
    let d = startD;
    while (d < from) d = addDays(d, n);
    for (; d <= to; d = addDays(d, n)) dates.push(fmt(d));
  };
  const weekdays = (keep: (dow: number) => boolean) => {
    for (let d = from; d <= to; d = addDays(d, 1)) if (keep(d.getUTCDay())) dates.push(fmt(d));
  };
  const firstOnOrAfter = (d: Date, dow: number) => addDays(d, (dow - d.getUTCDay() + 7) % 7);

  switch (frequencyType) {
    case "daily":
      weekdays((dow) => dow >= 1 && dow <= 5);
      break;
    case "weekly":
      if (cfg.day != null) for (let d = firstOnOrAfter(from, cfg.day); d <= to; d = addDays(d, 7)) dates.push(fmt(d));
      break;
    case "biweekly":
      if (cfg.day != null) {
        const anchor = firstOnOrAfter(startD, cfg.day);
        let d = firstOnOrAfter(from, cfg.day);
        const off = Math.round((d.getTime() - anchor.getTime()) / DAY_MS) % 14;
        if (off !== 0) d = addDays(d, 14 - off);
        for (; d <= to; d = addDays(d, 14)) dates.push(fmt(d));
      }
      break;
    case "every_15_days":
      everyNDays(15);
      break;
    case "every_x_days":
      everyNDays(cfg.interval || 15);
      break;
    case "monthly":
      dates.push(...monthlyDates(fmt(from), fmt(to), cfg.startDate ?? today));
      break;
    case "specific_days":
      if (cfg.days?.length) weekdays((dow) => cfg.days!.includes(dow));
      break;
  }
  return skip ? dates.filter((d) => !skip.has(d)) : dates;
}

const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "lun 05/10" */
export function shortDay(iso: string): string {
  const d = parse(iso);
  return `${DOW[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** Texto del aviso de solapamiento: "'Ruta Norte' (lun 05/10, lun 12/10 y 3 más) · campaña 'Verano' (mar 06/10)". */
export function describeOverlaps(
  overlaps: { routeName: string; routeType?: string; overlapDates: string[]; overlapCount: number }[],
): string {
  return overlaps
    .map((o) => {
      const shown = o.overlapDates.slice(0, 2).map(shortDay).join(", ");
      const extra = o.overlapCount > 2 ? ` y ${o.overlapCount - 2} más` : "";
      return `${o.routeType === "campaign" ? "campaña " : ""}'${o.routeName}' (${shown}${extra})`;
    })
    .join(" · ");
}
