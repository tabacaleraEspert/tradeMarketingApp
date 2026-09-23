// Lógica pura del drill "Mi gestión TMR": KPI → rutas → PDVs.
// Sin React ni fetch: todo testeable con vitest.
import type { KpiItem, TmrPdvRow, TmrPdvsResponse, TmrRutaRow } from "@/lib/api";

export type DrillKey =
  | "cobertura_skus"
  | "efectividad_visitas"
  | "penetracion_sueltos"
  | "pop_colocado"
  | "activaciones_promo"
  | "censo";

export const KPI_DRILL_KEYS: DrillKey[] = [
  "cobertura_skus",
  "efectividad_visitas",
  "penetracion_sueltos",
  "pop_colocado",
  "activaciones_promo",
];

export interface RouteMetric {
  num: number;
  den: number;
  pct: number;
}

export interface PdvRank {
  /** Menor = más oportunidad de mejora. Solo tiene sentido comparar entre elegibles. */
  score: number;
  reason: string;
  eligible: boolean;
}

export interface PdvRankCtx {
  /** Productos que le faltan al PDV para llegar a "Bueno" (de quick_wins). */
  missing?: string[];
}

export interface Drill {
  key: DrillKey;
  label: string;
  short: string;
  /** Nombre de ícono (lucide) resuelto en el componente; acá se mantiene puro. */
  icon: string;
  defaultGoal: number;
  routeMetric(r: TmrRutaRow): RouteMetric;
  pdvRank(p: TmrPdvRow, ctx: PdvRankCtx): PdvRank;
}

export const GOOD_SCORES = ["Excelente", "Muy Bueno", "Bueno"];

function pctOf(num: number, den: number): number {
  return den > 0 ? (num / den) * 100 : 0;
}

function metric(num: number, den: number): RouteMetric {
  return { num, den, pct: pctOf(num, den) };
}

function isGoodScore(score: string | null | undefined): boolean {
  return !!score && GOOD_SCORES.includes(score);
}

function sellsLoose(p: TmrPdvRow): boolean {
  if (typeof p.sells_loose === "boolean") return p.sells_loose;
  return p.vs === "Sí";
}

function joinMissing(missing: string[]): string {
  if (missing.length <= 1) return missing.join("");
  return `${missing.slice(0, -1).join(", ")} y ${missing[missing.length - 1]}`;
}

const coberturaDrill: Drill = {
  key: "cobertura_skus",
  label: "Cobertura SKUs",
  short: "Cobertura",
  icon: "package",
  defaultGoal: 80,
  // Sobre TODOS los PDVs de la ruta (igual que el KPI oficial: los sin relevar cuentan en contra).
  routeMetric: (r) => metric(r.buenos ?? 0, r.pdvs ?? 0),
  pdvRank: (p, ctx) => {
    if (isGoodScore(p.score)) return { score: 99, reason: `${p.score} ✓`, eligible: false };
    const missing = ctx.missing ?? [];
    if (p.score === null || p.score === undefined) {
      return { score: 3, reason: "Sin relevar", eligible: true };
    }
    if (missing.length === 1) {
      return { score: 0, reason: `${p.score} · le falta ${joinMissing(missing)}`, eligible: true };
    }
    if (missing.length === 2) {
      return { score: 1, reason: `${p.score} · le faltan ${joinMissing(missing)}`, eligible: true };
    }
    if (p.score === "No cuenta") {
      return { score: 2, reason: "No cuenta · relevar de nuevo", eligible: true };
    }
    return { score: 2, reason: `${p.score} · lejos de Bueno`, eligible: true };
  },
};

const efectividadDrill: Drill = {
  key: "efectividad_visitas",
  label: "Efectividad de visitas",
  short: "Efectividad",
  icon: "map-pin",
  defaultGoal: 90,
  routeMetric: (r) => metric(r.vis_plan ?? 0, r.planned_mes ?? 0),
  pdvRank: (p) => {
    if (!p.planned) return { score: 99, reason: "No planificado este mes", eligible: false };
    if (p.vis === 0) return { score: 0, reason: "Planificado, sin visitar", eligible: true };
    if (!p.ha) return { score: 1, reason: "Visitado, sin acción", eligible: true };
    return { score: 99, reason: "Visitado con acción ✓", eligible: false };
  },
};

const sueltosDrill: Drill = {
  key: "penetracion_sueltos",
  label: "Penetración sueltos",
  short: "Sueltos",
  icon: "cigarette",
  defaultGoal: 50,
  routeMetric: (r) => metric(r.con_canje ?? 0, r.vende_sueltos ?? 0),
  pdvRank: (p) => {
    if (!sellsLoose(p)) return { score: 99, reason: "No vende sueltos", eligible: false };
    if (p.canje) return { score: 99, reason: "Con canje ✓", eligible: false };
    return { score: 0, reason: "Vende sueltos, sin canje", eligible: true };
  },
};

const popDrill: Drill = {
  key: "pop_colocado",
  label: "POP colocado",
  short: "POP",
  icon: "layout",
  defaultGoal: 70,
  routeMetric: (r) => metric(r.con_material ?? 0, r.pdvs ?? 0),
  pdvRank: (p) =>
    p.material
      ? { score: 99, reason: "Con material ✓", eligible: false }
      : { score: 0, reason: "Sin material POP", eligible: true },
};

const activacionesDrill: Drill = {
  key: "activaciones_promo",
  label: "Activaciones promo",
  short: "Promos",
  icon: "sparkles",
  defaultGoal: 40,
  routeMetric: (r) => metric(r.con_promo ?? 0, r.pdvs ?? 0),
  pdvRank: (p) =>
    p.promo
      ? { score: 99, reason: "Promo activada ✓", eligible: false }
      : { score: 0, reason: "Sin promo activada", eligible: true },
};

const censoDrill: Drill = {
  key: "censo",
  label: "Censo completo",
  short: "Censo",
  icon: "clipboard-check",
  defaultGoal: 80,
  routeMetric: (r) => {
    const den = r.pdvs ?? 0;
    const pct = r.completitud ?? 0;
    const num = Math.round((pct * den) / 100);
    return { num, den, pct: den > 0 ? pct : 0 };
  },
  pdvRank: (p) => {
    const comp = p.comp ?? 0;
    if (comp >= 100) return { score: 999, reason: "Censo completo ✓", eligible: false };
    const sinDato = p.sin_dato ?? 0;
    return { score: comp, reason: `Censo ${Math.round(comp)}% · ${sinDato} Espert sin dato`, eligible: true };
  },
};

export const DRILLS: Record<DrillKey, Drill> = {
  cobertura_skus: coberturaDrill,
  efectividad_visitas: efectividadDrill,
  penetracion_sueltos: sueltosDrill,
  pop_colocado: popDrill,
  activaciones_promo: activacionesDrill,
  censo: censoDrill,
};

export function isDrillKey(k: string | undefined): k is DrillKey {
  return !!k && Object.prototype.hasOwnProperty.call(DRILLS, k);
}

/** Meta del KPI: la del engine si la fila del vendedor la trae, si no el default del drill. */
export function goalFor(drill: Drill, kpis: KpiItem[] | undefined): number {
  const kpi = kpis?.find((k) => k.key === drill.key);
  return kpi && kpi.target > 0 ? kpi.target : drill.defaultGoal;
}

/** PDVs que faltan para alcanzar la meta; null si no hay PDVs elegibles (den = 0). */
export function faltan(m: RouteMetric, goalPct: number): number | null {
  if (m.den <= 0) return null;
  const need = Math.ceil((goalPct * m.den) / 100 - 1e-9);
  return Math.max(0, need - m.num);
}

export function faltanLabel(m: RouteMetric, goalPct: number): string {
  const f = faltan(m, goalPct);
  if (f === null) return "sin PDVs elegibles";
  if (f === 0) return "meta alcanzada";
  return `faltan ${f} ${f === 1 ? "PDV" : "PDVs"}`;
}

export type Tone = "green" | "yellow" | "red";

/** Semáforo relativo a la meta: ≥meta verde, ≥meta-20 amarillo, resto rojo. */
export function toneForGoal(pct: number, goalPct: number): Tone {
  if (pct >= goalPct) return "green";
  if (pct >= goalPct - 20) return "yellow";
  return "red";
}

export interface RankedRoute {
  route: TmrRutaRow;
  metric: RouteMetric;
}

/** Rutas peor-primero por el KPI; las que no tienen denominador van al final. */
export function rankRoutes(rutas: TmrRutaRow[], drill: Drill): RankedRoute[] {
  return rutas
    .map((route) => ({ route, metric: drill.routeMetric(route) }))
    .sort((a, b) => {
      const aEmpty = a.metric.den === 0;
      const bEmpty = b.metric.den === 0;
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      if (a.metric.pct !== b.metric.pct) return a.metric.pct - b.metric.pct;
      return a.route.nombre.localeCompare(b.route.nombre);
    });
}

/** Suma de num/den de todas las rutas (para el "faltan N" de la tarjeta KPI). Censo: promedio ponderado por PDVs. */
export function aggregateRoutes(rutas: TmrRutaRow[], drill: Drill): RouteMetric {
  let num = 0;
  let den = 0;
  for (const r of rutas) {
    const m = drill.routeMetric(r);
    num += m.num;
    den += m.den;
  }
  return metric(num, den);
}

/** Completitud promedio (total y Espert) ponderada por PDVs de cada ruta. */
export function censoAverage(rutas: TmrRutaRow[]): { total: number; espert: number; pdvs: number } {
  let pdvs = 0;
  let sumTotal = 0;
  let sumEsp = 0;
  for (const r of rutas) {
    const n = r.pdvs ?? 0;
    pdvs += n;
    sumTotal += (r.completitud ?? 0) * n;
    sumEsp += (r.completitud_esp ?? 0) * n;
  }
  return pdvs > 0 ? { total: sumTotal / pdvs, espert: sumEsp / pdvs, pdvs } : { total: 0, espert: 0, pdvs: 0 };
}

export function quickWinKey(n: string, ruta: string): string {
  return `${n}|${ruta}`;
}

/** Índice nombre+ruta → productos faltantes, a partir de quick_wins. */
export function buildQuickWinIndex(quickWins: TmrPdvsResponse["quick_wins"] | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const qw of quickWins ?? []) map.set(quickWinKey(qw.n, qw.ruta), qw.missing ?? []);
  return map;
}

export function flattenPdvs(resp: Pick<TmrPdvsResponse, "tmr_pdvs"> | null | undefined): TmrPdvRow[] {
  if (!resp?.tmr_pdvs) return [];
  return Object.values(resp.tmr_pdvs).flat();
}

/** PDVs de una ruta: por route_id cuando el response lo trae, si no por nombre de ruta. */
export function pdvsForRoute(pdvs: TmrPdvRow[], routeId: number, routeName: string | undefined): TmrPdvRow[] {
  const byId = pdvs.filter((p) => p.route_id === routeId);
  if (byId.length > 0 || routeName === undefined) return byId;
  return pdvs.filter((p) => p.ruta === routeName);
}

export interface RankedPdv {
  pdv: TmrPdvRow;
  rank: PdvRank;
}

/**
 * Ordena PDVs por oportunidad: elegibles primero (score asc, luego `vis` desc
 * porque los ya visitados son más baratos de accionar, luego nombre).
 */
export function rankPdvs(pdvs: TmrPdvRow[], drill: Drill, quickWins: Map<string, string[]>): RankedPdv[] {
  return pdvs
    .map((pdv) => ({ pdv, rank: drill.pdvRank(pdv, { missing: quickWins.get(quickWinKey(pdv.n, pdv.ruta)) }) }))
    .sort((a, b) => {
      if (a.rank.eligible !== b.rank.eligible) return a.rank.eligible ? -1 : 1;
      if (a.rank.score !== b.rank.score) return a.rank.score - b.rank.score;
      if ((a.pdv.vis ?? 0) !== (b.pdv.vis ?? 0)) return (b.pdv.vis ?? 0) - (a.pdv.vis ?? 0);
      return a.pdv.n.localeCompare(b.pdv.n);
    });
}

export function splitEligible(ranked: RankedPdv[]): { eligible: RankedPdv[]; rest: RankedPdv[] } {
  return {
    eligible: ranked.filter((r) => r.rank.eligible),
    rest: ranked.filter((r) => !r.rank.eligible),
  };
}

// ── Período (mes) ──

export interface Period {
  year: number;
  month: number;
}

export const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Mes actual y anterior. */
export function periodOptions(now: Date = new Date()): Period[] {
  return [0, 1].map((i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

export function periodToParam(p: Period): string {
  return `${p.year}-${p.month}`;
}

/** Parsea "YYYY-M"; si no es una opción válida (actual/anterior) cae al mes actual. */
export function parsePeriod(param: string | null | undefined, now: Date = new Date()): Period {
  const opts = periodOptions(now);
  if (param) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(param);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const hit = opts.find((o) => o.year === year && o.month === month);
      if (hit) return hit;
    }
  }
  return opts[0];
}

export function formatPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
