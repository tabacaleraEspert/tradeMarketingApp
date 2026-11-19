/**
 * Lógica pura del tablero de control de rutas (semana × trade): fechas, armado de
 * celdas, solapamientos y qué opciones de movimiento aplican. Sin React ni red, para
 * poder testearla. Fechas como "YYYY-MM-DD", aritmética en UTC (igual que routeDays.ts).
 */
import type { BoardDay, BoardRep, BoardRoute } from "@/lib/api/routeBoard";

const DAY_MS = 86_400_000;

export const parseISO = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const fmtISO = (d: Date) => d.toISOString().slice(0, 10);
export const addDaysISO = (iso: string, n: number) => fmtISO(new Date(parseISO(iso).getTime() + n * DAY_MS));
/** getDay() de JS: 0 = domingo … 6 = sábado (mismo criterio que FrequencyConfig). */
export const jsDay = (iso: string) => parseISO(iso).getUTCDay();
/** Lunes de la semana (lun–dom) de la fecha. */
export const mondayOf = (iso: string) => addDaysISO(iso, -((jsDay(iso) + 6) % 7));
export const sameWeek = (a: string, b: string) => mondayOf(a) === mondayOf(b);

const DOW_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DOW_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const dowShort = (iso: string) => DOW_SHORT[jsDay(iso)];
export const dowLong = (iso: string) => DOW_LONG[jsDay(iso)];
/** "23/11" */
export const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** "lun 23/11" */
export const shortDate = (iso: string) => `${DOW_SHORT[jsDay(iso)].toLowerCase()} ${dayMonth(iso)}`;

/** "23 – 28 nov 2026" / "30 nov – 5 dic 2026" */
export function weekLabel(monday: string, lastDay: string): string {
  const a = parseISO(monday);
  const b = parseISO(lastDay);
  const left = a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}` : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
  return `${left} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

/** Columnas de la semana: lunes a sábado, y domingo solo si hay algún día planificado. */
export function weekColumns(monday: string, days: Pick<BoardDay, "workDate">[]): string[] {
  const cols = Array.from({ length: 6 }, (_, i) => addDaysISO(monday, i));
  const sunday = addDaysISO(monday, 6);
  if (days.some((d) => d.workDate === sunday)) cols.push(sunday);
  return cols;
}

export const cellKey = (userId: number, date: string) => `${userId}|${date}`;

/** Días agrupados por celda (trade + fecha), ordenados por nombre de ruta. */
export function groupByCell(days: BoardDay[]): Map<string, BoardDay[]> {
  const map = new Map<string, BoardDay[]>();
  for (const d of days) {
    const k = cellKey(d.userId, d.workDate);
    const list = map.get(k);
    if (list) list.push(d);
    else map.set(k, [d]);
  }
  for (const list of map.values()) list.sort((a, b) => a.routeName.localeCompare(b.routeName, "es"));
  return map;
}

/** Texto del aviso de celda con 2+ rutas (permitido, solo se avisa). */
export function overlapText(cellDays: Pick<BoardDay, "routeName">[]): string | null {
  if (cellDays.length < 2) return null;
  return `${cellDays.length} rutas el mismo día: ${cellDays.map((d) => d.routeName).join(" · ")}`;
}

export interface RepGroup {
  key: string;
  label: string;
  reps: BoardRep[];
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Filtra por nombre y zona, y agrupa por responsable (los sin responsable van al final). */
export function filterAndGroupReps(
  reps: BoardRep[],
  opts: { search?: string; zone?: string; onlyWithDays?: boolean; repsWithDays?: Set<number> },
): RepGroup[] {
  const q = norm(opts.search?.trim() ?? "");
  const groups = new Map<string, RepGroup>();
  for (const r of reps) {
    if (q && !norm(r.name).includes(q) && !norm(r.managerName ?? "").includes(q)) continue;
    if (opts.zone && opts.zone !== "all" && (r.zoneName ?? "") !== opts.zone) continue;
    if (opts.onlyWithDays && !opts.repsWithDays?.has(r.userId)) continue;
    const key = r.managerId != null ? `m${r.managerId}` : "none";
    let g = groups.get(key);
    if (!g) {
      g = { key, label: r.managerName ? `Equipo de ${r.managerName}` : "Sin responsable", reps: [] };
      groups.set(key, g);
    }
    g.reps.push(r);
  }
  const out = [...groups.values()];
  for (const g of out) g.reps.sort((a, b) => a.name.localeCompare(b.name, "es"));
  out.sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : a.label.localeCompare(b.label, "es")));
  return out;
}

export interface MovePlan {
  dateChanged: boolean;
  repChanged: boolean;
  /** Se puede ofrecer "Solo este día". */
  dayOnly: boolean;
  dayOnlyReason: string | null;
  /** Se puede ofrecer "Toda la ruta de acá en adelante". */
  wholeRoute: boolean;
  /** Por qué no se ofrece (para mostrarlo en el diálogo). */
  wholeRouteReason: string | null;
}

interface FreqConfig {
  day?: number;
  days?: number[];
}

function parseConfig(raw: string | null | undefined): FreqConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as FreqConfig;
  } catch {
    return {};
  }
}

/**
 * Qué opciones tiene un movimiento de un día a (fecha, trade) destino.
 *
 * - Un día es siempre del trade dueño de la ruta: "prestar" un solo día a otro trade
 *   todavía no está disponible (el servidor lo rechaza). Soltar en otra fila solo ofrece
 *   "Toda la ruta" (reasignarla), salvo que el destino sea justamente el dueño de la ruta.
 * - "Toda la ruta" por cambio de día de la semana solo aplica a frecuencia semanal,
 *   quincenal o días específicos, dentro de la misma semana, cuando el día arrastrado
 *   es el de la frecuencia (espejo de POST /routes/days/{id}/shift-weekday).
 */
export function planMove(
  day: Pick<BoardDay, "workDate" | "userId">,
  route: Pick<BoardRoute, "frequencyType" | "frequencyConfig" | "assignedUserId"> | undefined,
  targetDate: string,
  targetUserId: number,
): MovePlan {
  const dateChanged = targetDate !== day.workDate;
  const repChanged = targetUserId !== day.userId;
  const targetOwnsRoute = route?.assignedUserId === targetUserId;

  const dayOnlyReason =
    repChanged && !targetOwnsRoute
      ? "Prestar un solo día a otro trade todavía no está disponible: para cambiar de trade se reasigna toda la ruta."
      : null;

  let reason: string | null = null;
  if (repChanged && targetOwnsRoute) {
    reason = "La ruta ya es de ese trade: alcanza con mover este día.";
  } else if (dateChanged) {
    const freq = route?.frequencyType ?? null;
    const cfg = parseConfig(route?.frequencyConfig);
    const from = jsDay(day.workDate);
    const to = jsDay(targetDate);
    if (!freq || !["weekly", "biweekly", "specific_days"].includes(freq)) {
      reason = "La frecuencia de esta ruta no tiene un día de la semana fijo.";
    } else if (!sameWeek(day.workDate, targetDate) || from === to) {
      reason = "Para cambiar el día de toda la ruta, el destino tiene que ser otro día de la misma semana.";
    } else if (freq === "specific_days") {
      if (!cfg.days?.includes(from)) reason = `El ${dowLong(day.workDate)} no es parte de la frecuencia de la ruta.`;
      else if (cfg.days.includes(to)) reason = `La ruta ya se visita los ${dowLong(targetDate)}.`;
    } else if (cfg.day !== from) {
      reason = `El ${dowLong(day.workDate)} no es el día de la frecuencia de la ruta.`;
    }
  }
  const changed = dateChanged || repChanged;
  return {
    dateChanged,
    repChanged,
    dayOnly: changed && dayOnlyReason === null,
    dayOnlyReason,
    wholeRoute: changed && reason === null,
    wholeRouteReason: reason,
  };
}

/** Rutas que se pueden planificar en una fecha: vigentes y sin vencer antes de ese día. */
export function routesForDate(routes: BoardRoute[], date: string): BoardRoute[] {
  return routes.filter((r) => r.isLive && (!r.endDate || r.endDate >= date));
}
