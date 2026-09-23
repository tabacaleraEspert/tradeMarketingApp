/**
 * Helpers puros del censo de cobertura (CoverageFormPage).
 *
 * Modelo de 3 estados por producto: "si" (lo trabaja), "no" (no lo trabaja),
 * "sin_dato" (no se preguntó). Solo "si"/"no" se persisten; "sin_dato" = fila omitida.
 * Jerarquía Categoría → Marca → Variante; marca y categoría derivan su estado
 * de las variantes/productos (no tienen estado propio salvo el "explícito" que
 * el usuario tocó y que solo pesa cuando nada abajo tiene dato).
 */
import type { Product, CoverageDiff } from "@/lib/api/types";

export type CoverageState = "si" | "no" | "sin_dato";

export interface CoverageRow {
  ProductId: number;
  State: CoverageState;
  Price: string;
  Availability: string;
  Puffs: string;
}

export interface BrandGroup {
  /** Nombre de marca (Product.Brand o primera palabra del nombre). */
  brand: string;
  /** Clave única `${category}::${brand}` para sets/records de UI. */
  key: string;
  category: string;
  isOwn: boolean;
  products: Product[];
}

export interface BrandSummary {
  state: CoverageState;
  withData: number;
  total: number;
}

export interface CoveragePersistItem {
  ProductId: number;
  Works: boolean;
  Price?: number;
  Availability?: string;
  Puffs?: number;
}

export const EMPTY_ROW = (pid: number): CoverageRow => ({
  ProductId: pid,
  State: "sin_dato",
  Price: "",
  Availability: "disponible",
  Puffs: "",
});

// ---------------------------------------------------------------------------
// Marca
// ---------------------------------------------------------------------------

/** Marca del producto: `Brand` de la API; si viene vacía, primera palabra del nombre. */
export function brandOf(p: Pick<Product, "Name" | "Brand">): string {
  const b = (p.Brand || "").trim();
  if (b) return b;
  const first = (p.Name || "").trim().split(/\s+/)[0];
  return first || p.Name || "";
}

export function brandKey(category: string, brand: string): string {
  return `${category}::${brand}`;
}

/** Estado derivado de un conjunto de estados (marca o categoría). */
export function deriveState(states: CoverageState[]): CoverageState {
  if (states.some((s) => s === "si")) return "si";
  if (states.length > 0 && states.every((s) => s === "no")) return "no";
  return "sin_dato";
}

export function summarizeBrand(products: Product[], rows: Record<number, CoverageRow>): BrandSummary {
  const states = products.map((p) => rows[p.ProductId]?.State ?? "sin_dato");
  return {
    state: deriveState(states),
    withData: states.filter((s) => s !== "sin_dato").length,
    total: states.length,
  };
}

/**
 * Agrupa los productos de UNA categoría por marca.
 * Orden: marcas Espert (IsOwn) → marcas con alguna variante sin dato → resto.
 * Dentro de la marca se respeta SortOrder.
 *
 * `orderRows`: rows con las que se calcula el orden. La página pasa un snapshot
 * tomado al terminar la carga inicial (incluido el draft) para que las marcas no
 * salten de lugar mientras el usuario las completa; el estado/contador se derivan
 * aparte con las rows vivas. Default: `rows`.
 */
export function groupByBrand(
  category: string,
  products: Product[],
  rows: Record<number, CoverageRow>,
  orderRows: Record<number, CoverageRow> = rows,
): BrandGroup[] {
  const map = new Map<string, BrandGroup>();
  const sorted = [...products].sort((a, b) => a.SortOrder - b.SortOrder);
  for (const p of sorted) {
    const brand = brandOf(p);
    let g = map.get(brand);
    if (!g) {
      g = { brand, key: brandKey(category, brand), category, isOwn: false, products: [] };
      map.set(brand, g);
    }
    g.products.push(p);
    if (p.IsOwn) g.isOwn = true;
  }
  const rank = (g: BrandGroup): number => {
    if (g.isOwn) return 0;
    const anySinDato = g.products.some((p) => (orderRows[p.ProductId]?.State ?? "sin_dato") === "sin_dato");
    return anySinDato ? 1 : 2;
  };
  // sort es estable: dentro de cada rango se mantiene el orden de aparición (SortOrder).
  return [...map.values()].sort((a, b) => rank(a) - rank(b));
}

// ---------------------------------------------------------------------------
// Categoría
// ---------------------------------------------------------------------------

/**
 * Estado de una categoría: auto-"si" si algún producto es "si" (o hay "otros"),
 * auto-"no" si todos los productos son "no"; si no, el estado explícito que tocó
 * el usuario (default "sin_dato").
 */
export function deriveCategoryState(
  products: Product[],
  rows: Record<number, CoverageRow>,
  explicit: CoverageState | undefined,
  hasOthers = false,
): CoverageState {
  if (hasOthers) return "si";
  const derived = deriveState(products.map((p) => rows[p.ProductId]?.State ?? "sin_dato"));
  if (derived !== "sin_dato") return derived;
  return explicit ?? "sin_dato";
}

/** Convierte el Status persistido en PdvProductCategory al estado de UI. */
export function categoryStateFromPdvStatus(status: string | undefined | null): CoverageState {
  if (status === "trabaja") return "si";
  if (status === "no_trabaja") return "no";
  return "sin_dato";
}

// ---------------------------------------------------------------------------
// Estado inicial
// ---------------------------------------------------------------------------

/**
 * Fila inicial a partir del diff: dato guardado de ESTA visita → si/no por Works;
 * si no, herencia de la visita anterior (PrevWorks true→si, false→no, null→sin_dato);
 * si no, sin_dato.
 */
export function initialRowFromDiff(
  pid: number,
  d: CoverageDiff | undefined,
  inheritPrev: boolean,
): CoverageRow {
  if (d?.HasCurrentData) {
    return {
      ProductId: pid,
      State: d.Works ? "si" : "no",
      Price: d.Price != null ? String(d.Price) : "",
      Availability: d.Availability || "disponible",
      Puffs: d.Puffs != null ? String(d.Puffs) : "",
    };
  }
  if (inheritPrev && d && d.PrevWorks != null) {
    return {
      ProductId: pid,
      State: d.PrevWorks ? "si" : "no",
      Price: d.PrevPrice != null ? String(d.PrevPrice) : "",
      Availability: d.PrevAvailability || "disponible",
      Puffs: d.PrevPuffs != null ? String(d.PrevPuffs) : "",
    };
  }
  return EMPTY_ROW(pid);
}

/** Chip "Visita ant.": la fila no tiene dato actual y su estado coincide con lo heredado. */
export function isInheritedRow(row: CoverageRow, d: CoverageDiff | undefined): boolean {
  if (!d || d.HasCurrentData || d.PrevWorks == null) return false;
  return (d.PrevWorks && row.State === "si") || (!d.PrevWorks && row.State === "no");
}

/** Normaliza una fila de draft; drafts viejos solo tienen `Works` (true→si, false→sin_dato). */
export function normalizeDraftRow(raw: unknown, pid: number): CoverageRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<CoverageRow> & { Works?: boolean };
  let state: CoverageState;
  if (r.State === "si" || r.State === "no" || r.State === "sin_dato") state = r.State;
  else if (typeof r.Works === "boolean") state = r.Works ? "si" : "sin_dato";
  else return null;
  return {
    ProductId: pid,
    State: state,
    Price: typeof r.Price === "string" ? r.Price : "",
    Availability: typeof r.Availability === "string" && r.Availability ? r.Availability : "disponible",
    Puffs: typeof r.Puffs === "string" ? r.Puffs : "",
  };
}

/**
 * Normaliza el categoryStatus del draft; drafts viejos usaban boolean.
 * `false` era el default "No trabaja" (nunca preguntado) → sin_dato; `true` → si.
 */
export function normalizeDraftCategoryStatus(raw: unknown): Record<string, CoverageState> {
  const out: Record<string, CoverageState> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [cat, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === "si" || v === "no" || v === "sin_dato") out[cat] = v;
    else if (typeof v === "boolean") out[cat] = v ? "si" : "sin_dato";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

/** Solo filas con dato (si/no); sin_dato se omite. Precio/disp/puffs solo cuando "si". */
export function buildPersistItems(rows: Record<number, CoverageRow>): CoveragePersistItem[] {
  return Object.values(rows)
    .filter((r) => r.State === "si" || r.State === "no")
    .map((r) => {
      const works = r.State === "si";
      return {
        ProductId: r.ProductId,
        Works: works,
        Price: works && r.Price ? Number(r.Price) : undefined,
        Availability: works ? r.Availability : undefined,
        Puffs: works && r.Puffs ? Number(r.Puffs) : undefined,
      };
    });
}

/** Solo categorías en si/no; sin_dato no se envía. */
export function buildCategoryItems(
  states: Record<string, CoverageState>,
): Array<{ Category: string; Status: "trabaja" | "no_trabaja" }> {
  return Object.entries(states)
    .filter(([, s]) => s === "si" || s === "no")
    .map(([cat, s]) => ({ Category: cat, Status: s === "si" ? "trabaja" : "no_trabaja" }));
}

/** Marcas abiertas (tocó "Sí") que no tienen ninguna variante con dato. */
export function brandsWithoutData(
  openBrands: Iterable<string>,
  groups: BrandGroup[],
  rows: Record<number, CoverageRow>,
): string[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const out: string[] = [];
  for (const key of openBrands) {
    const g = byKey.get(key);
    if (!g) continue;
    if (summarizeBrand(g.products, rows).withData === 0) out.push(g.brand);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contadores
// ---------------------------------------------------------------------------

export function countStates(products: Product[], rows: Record<number, CoverageRow>) {
  let si = 0, no = 0, sinDato = 0, ownSi = 0, quiebres = 0;
  for (const p of products) {
    const r = rows[p.ProductId];
    const s = r?.State ?? "sin_dato";
    if (s === "si") {
      si++;
      if (p.IsOwn) ownSi++;
      if (r?.Availability === "quiebre") quiebres++;
    } else if (s === "no") no++;
    else sinDato++;
  }
  return { si, no, sinDato, ownSi, quiebres, withData: si + no, total: products.length };
}
