/**
 * Helpers puros del filtro de rango de "Comportamiento": presets → {from, to}
 * en fecha Argentina (yyyy-mm-dd), formateo de labels y números. Sin estado ni
 * dependencias de React para poder testearlos con vitest.
 *
 * Todas las cuentas de calendario se hacen sobre la fecha AR como "fecha civil"
 * (Date.UTC con la y-m-d) para no depender de la zona del navegador.
 */
import { todayAR } from "../../../lib/dateUtils";

export type RangePreset =
  | "hoy"
  | "esta_semana"
  | "semana_pasada"
  | "este_mes"
  | "mes_anterior"
  | "ultimos_30"
  | "custom";

export interface DateRange {
  from: string;
  to: string;
}

export interface RangeValue {
  preset: RangePreset;
  /** Solo para "custom" (yyyy-mm-dd). */
  from?: string;
  to?: string;
}

/** Tope del backend (días inclusivos) por request. */
export const MAX_RANGE_DAYS = 92;

export const PRESET_LABELS: Array<[RangePreset, string]> = [
  ["hoy", "Hoy"],
  ["esta_semana", "Esta semana"],
  ["semana_pasada", "Semana pasada"],
  ["este_mes", "Este mes"],
  ["mes_anterior", "Mes anterior"],
  ["ultimos_30", "Últimos 30 días"],
];

const AR_TZ = "America/Argentina/Buenos_Aires";

/** yyyy-mm-dd → Date UTC de esa fecha civil (medianoche UTC). */
function civil(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Suma días a una fecha civil yyyy-mm-dd. */
export function addDays(iso: string, n: number): string {
  const d = civil(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}

/** Días inclusivos entre dos fechas civiles (from ≤ to → ≥ 1). */
export function daysBetween(from: string, to: string): number {
  return Math.round((civil(to).getTime() - civil(from).getTime()) / 86_400_000) + 1;
}

/** Lunes de la semana (lun–dom) que contiene la fecha. */
function mondayOf(iso: string): string {
  const dow = civil(iso).getUTCDay(); // 0=dom … 6=sáb
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(iso, -back);
}

/**
 * Resuelve un preset a un rango inclusivo. `today` es inyectable para tests;
 * por defecto es la fecha civil Argentina de hoy.
 */
export function resolveRange(value: RangeValue, today: string = todayAR()): DateRange | null {
  switch (value.preset) {
    case "hoy":
      return { from: today, to: today };
    case "esta_semana":
      return { from: mondayOf(today), to: today };
    case "semana_pasada": {
      const thisMonday = mondayOf(today);
      return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
    }
    case "este_mes":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "mes_anterior": {
      const first = civil(`${today.slice(0, 7)}-01`);
      const prevFirst = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));
      const prevLast = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 0));
      return { from: isoOf(prevFirst), to: isoOf(prevLast) };
    }
    case "ultimos_30":
      return { from: addDays(today, -29), to: today };
    case "custom": {
      if (!value.from || !value.to) return null;
      if (value.from > value.to) return null;
      return { from: value.from, to: value.to };
    }
  }
}

/** Mensaje de error de un rango custom, o null si es válido. */
export function rangeError(value: RangeValue, today: string = todayAR()): string | null {
  if (value.preset !== "custom") return null;
  if (!value.from || !value.to) return "Elegí desde y hasta.";
  if (value.from > value.to) return "\"Desde\" no puede ser posterior a \"hasta\".";
  const n = daysBetween(value.from, value.to);
  if (n > MAX_RANGE_DAYS) return `Máximo ${MAX_RANGE_DAYS} días por consulta (elegiste ${n}).`;
  void today;
  return null;
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DOW_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "24 sep" — de una fecha civil yyyy-mm-dd. */
export function shortDate(iso: string): string {
  const d = civil(iso);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** "mié 24 sep" — label de fila de día. */
export function dayLabel(iso: string): string {
  const d = civil(iso);
  return `${DOW_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** "24 sep" · "1 – 24 sep" · "28 ago – 24 sep 2026" · "1 dic 2025 – 15 ene 2026". */
export function formatRangeLabel(r: DateRange): string {
  if (r.from === r.to) return `${shortDate(r.from)} ${r.from.slice(0, 4)}`;
  const f = civil(r.from);
  const t = civil(r.to);
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  const sameMonth = sameYear && f.getUTCMonth() === t.getUTCMonth();
  if (sameMonth) return `${f.getUTCDate()} – ${shortDate(r.to)} ${t.getUTCFullYear()}`;
  if (sameYear) return `${shortDate(r.from)} – ${shortDate(r.to)} ${t.getUTCFullYear()}`;
  return `${shortDate(r.from)} ${f.getUTCFullYear()} – ${shortDate(r.to)} ${t.getUTCFullYear()}`;
}

/** "HH:MM" en hora Argentina a partir de un ISO; "—" si no hay. */
export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-AR", {
    timeZone: AR_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "12,3 km" · "0,8 km" · "—" si null. */
export function kmFmt(km: number | null | undefined, digits = 1): string {
  if (km == null || Number.isNaN(km)) return "—";
  return `${km.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

/** "1 h 25 min" · "45 min" · "—". */
export function minFmt(min: number | null | undefined): string {
  if (min == null || Number.isNaN(min)) return "—";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
