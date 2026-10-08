/**
 * Material POP real (artículos MKT de Bejerman) — helpers puros para censo,
 * colocación y el picker. Sin React salvo `usePopMaterials` (catálogo offline).
 *
 * Reglas:
 *  - Censo: el material Espert sale del catálogo (MaterialCode) o de texto libre
 *    "Otro material Espert (sin código)". La competencia sigue con la lista
 *    genérica + switches de siempre, pero Espert ya no es elegible ahí.
 *  - Censos viejos (sin MaterialCode, Espert dentro de Company) se cargan
 *    partiendo la fila: la parte Espert pasa a ítem Espert sin código.
 *  - Colocación: PUT /visits/{id}/pop-placements REEMPLAZA todo lo de la visita,
 *    así que siempre se manda el conjunto completo de las acciones "pop".
 */
import { useEffect, useState } from "react";
import type { PopMaterial, VisitPOPItem, VisitPOPPlacementInput } from "@/lib/api/types";
import { popMaterialsApi } from "@/lib/api/services";
import { fetchWithCache } from "@/lib/offline/cache";

export const ESPERT = "Espert";
/** Empresas elegibles en las filas genéricas (competencia). Espert va por catálogo. */
export const COMPETITOR_COMPANIES = ["Massalin", "BAT", "TABSA", "Otra"];
export const POP_MATERIALS_CACHE_KEY = "pop_materials";

export type PopMaterialType = "primario" | "secundario";

export const GENERIC_POP_MATERIALS: Record<PopMaterialType, string[]> = {
  primario: ["Cigarrera aérea", "Cigarrera de espalda", "Pantalla / Display", "Otro primario"],
  secundario: ["Móvil / Colgante", "Stopper", "Escalerita", "Exhibidor", "Afiche", "Otro secundario"],
};

// ── Normalización / picker ──────────────────────────────────────────────────

export function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface PopMaterialFilter {
  query?: string;
  line?: string | null;
  type?: string | null;
}

/** Búsqueda por código o descripción (todas las palabras, sin tildes) + chips Línea/Tipo. Stock NO filtra. */
export function filterPopMaterials(materials: PopMaterial[], f: PopMaterialFilter): PopMaterial[] {
  const tokens = normalizeText(f.query).split(" ").filter(Boolean);
  return materials.filter((m) => {
    if (f.line && m.Line !== f.line) return false;
    if (f.type && m.Type !== f.type) return false;
    if (tokens.length === 0) return true;
    const hay = normalizeText(`${m.Code} ${m.Description}`);
    // "211" debe encontrar "MKT-000211"
    return tokens.every((t) => hay.includes(t));
  });
}

/** Valores distintos (no vacíos) de un campo, ordenados — para los chips. */
export function distinctValues(materials: PopMaterial[], field: "Line" | "Type"): string[] {
  const set = new Set<string>();
  for (const m of materials) {
    const v = m[field];
    if (v && v.trim()) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Tipo de material (primario/secundario) para un artículo del catálogo.
 * Primario = piezas de exhibición fija (cigarrera, display, pantalla); todo lo
 * demás (colgantes, stoppers, afiches, etc.) = secundario. Mira Type y, si no
 * hay, la descripción.
 */
const PRIMARY_KEYWORDS = ["cigarrera", "display", "pantalla"];
export function materialTypeFor(m: Pick<PopMaterial, "Type" | "Description">): PopMaterialType {
  const t = normalizeText(m.Type) || normalizeText(m.Description);
  return PRIMARY_KEYWORDS.some((k) => t.includes(k)) ? "primario" : "secundario";
}

/** Clave de foto POP por material+empresa. Para ítems de catálogo `material` = Code. */
export function popPhotoKey(material: string, company: string) {
  return `pop_${material}_${company}`;
}

// ── Censo ───────────────────────────────────────────────────────────────────

/** Fila genérica de competencia (lista fija + switches). */
export interface CompetitorRow {
  MaterialType: string;
  MaterialName: string;
  Companies: string[];
  Present: boolean;
  HasPrice: boolean | null;
}

/** Pieza Espert presente (catálogo o "otro sin código"). */
export interface EspertItem {
  MaterialCode: string | null;
  MaterialName: string;
  MaterialType: string;
  HasPrice: boolean | null;
}

export interface CensusState {
  rows: CompetitorRow[];
  espert: EspertItem[];
}

export interface CensusItemPayload {
  MaterialType: string;
  MaterialName: string;
  Company?: string;
  Present: boolean;
  HasPrice?: boolean;
  MaterialCode?: string | null;
}

function splitCompanies(company: string | null | undefined): string[] {
  return company ? company.split(",").map((c) => c.trim()).filter(Boolean) : [];
}

function emptyGenericRows(): CompetitorRow[] {
  const out: CompetitorRow[] = [];
  for (const [type, names] of Object.entries(GENERIC_POP_MATERIALS)) {
    for (const name of names) {
      out.push({ MaterialType: type, MaterialName: name, Companies: [], Present: false, HasPrice: null });
    }
  }
  return out;
}

/** Clave estable de un ítem Espert (código o nombre libre). */
export function espertKey(e: Pick<EspertItem, "MaterialCode" | "MaterialName">): string {
  return e.MaterialCode ? `code:${e.MaterialCode}` : `name:${normalizeText(e.MaterialName)}`;
}

/** Clave de foto de un ítem Espert. */
export function espertPhotoKey(e: Pick<EspertItem, "MaterialCode" | "MaterialName">): string {
  return popPhotoKey(e.MaterialCode || e.MaterialName, ESPERT);
}

/**
 * Arma el estado del censo desde lo guardado. Compatible con censos viejos:
 * fila sin código con "Espert" en Company → se parte en ítem Espert sin código
 * + fila de competencia con las demás empresas.
 */
export function buildCensusState(saved: VisitPOPItem[] | Array<Partial<VisitPOPItem>>): CensusState {
  const rows = emptyGenericRows();
  const espert: EspertItem[] = [];
  const seen = new Set<string>();
  const addEspert = (e: EspertItem) => {
    const k = espertKey(e);
    if (seen.has(k)) return;
    seen.add(k);
    espert.push(e);
  };

  for (const s of saved) {
    const name = s.MaterialName ?? "";
    const type = s.MaterialType || "secundario";
    const companies = splitCompanies(s.Company);
    if (s.MaterialCode) {
      addEspert({ MaterialCode: s.MaterialCode, MaterialName: name, MaterialType: type, HasPrice: s.HasPrice ?? null });
      continue;
    }
    const hasEspert = companies.some((c) => normalizeText(c) === "espert");
    const others = companies.filter((c) => normalizeText(c) !== "espert");
    // Legado con Espert marcado ausente: no se convierte en pieza (las piezas se mandan Present=true
    // y subirían el KPI de comunicación al re-guardar).
    if (hasEspert && s.Present) {
      addEspert({ MaterialCode: null, MaterialName: name, MaterialType: type, HasPrice: s.HasPrice ?? null });
    }
    // Ítem Espert-only (nuevo "otro sin código" o legado sólo Espert): no toca la fila genérica.
    if (hasEspert && others.length === 0) continue;

    let row = rows.find((r) => r.MaterialName === name);
    if (!row) {
      row = { MaterialType: type, MaterialName: name, Companies: [], Present: false, HasPrice: null };
      rows.push(row);
    }
    row.Companies = [...new Set([...row.Companies, ...others])];
    row.Present = row.Present || !!s.Present;
    if (s.HasPrice !== undefined && s.HasPrice !== null) row.HasPrice = s.HasPrice;
  }
  return { rows, espert };
}

/**
 * Draft local: formato nuevo {rows, espert}; los drafts viejos eran CompetitorRow[]
 * (con Espert posiblemente en Companies) → se normalizan igual que un censo viejo.
 */
export function overlayCensusDraft(base: CensusState, draft: unknown): CensusState {
  if (!draft) return base;
  if (Array.isArray(draft)) {
    const asItems = (draft as CompetitorRow[]).map((d) => ({
      MaterialType: d.MaterialType,
      MaterialName: d.MaterialName,
      Company: (d.Companies ?? []).join(", "),
      Present: d.Present,
      HasPrice: d.HasPrice,
    }));
    const fromDraft = buildCensusState(asItems);
    // Las piezas de catálogo guardadas en backend se conservan.
    const keys = new Set(fromDraft.espert.map(espertKey));
    return { rows: fromDraft.rows, espert: [...fromDraft.espert, ...base.espert.filter((e) => !keys.has(espertKey(e)))] };
  }
  const d = draft as Partial<CensusState>;
  if (!Array.isArray(d.rows) || !Array.isArray(d.espert)) return base;
  return { rows: d.rows, espert: d.espert };
}

const CENSUS_NAME_MAX = 80;

/** Payload de PUT /visits/{id}/pop. */
export function buildCensusPayload(state: CensusState): CensusItemPayload[] {
  const competitor = state.rows
    .filter((r) => r.Present || r.Companies.length > 0)
    .map((r) => {
      const companies = r.Companies.filter((c) => normalizeText(c) !== "espert");
      return {
        MaterialType: r.MaterialType,
        MaterialName: r.MaterialName,
        Company: companies.length > 0 ? companies.join(", ") : undefined,
        Present: r.Present,
        HasPrice: r.HasPrice ?? undefined,
        MaterialCode: null,
      };
    });
  const espert = state.espert.map((e) => ({
    MaterialType: e.MaterialType,
    // VisitPOPItem.MaterialName es String(80); las descripciones del catálogo pueden ser más largas.
    MaterialName: e.MaterialName.slice(0, CENSUS_NAME_MAX),
    Company: ESPERT,
    Present: true,
    HasPrice: e.HasPrice ?? undefined,
    MaterialCode: e.MaterialCode,
  }));
  return [...espert, ...competitor];
}

/** Ítem Espert a partir de un artículo del catálogo. */
export function espertItemFromMaterial(m: PopMaterial): EspertItem {
  return { MaterialCode: m.Code, MaterialName: m.Description, MaterialType: materialTypeFor(m), HasPrice: null };
}

// ── Colocación ──────────────────────────────────────────────────────────────

export interface PlacementRow {
  MaterialCode: string | null;
  MaterialName: string;
  Quantity: number;
  Location: string;
}

export function placementLabel(p: Pick<PlacementRow, "MaterialCode" | "MaterialName">): string {
  return p.MaterialCode ? `${p.MaterialCode} ${p.MaterialName}` : p.MaterialName;
}

/** Valida renglones: al menos uno, nombre no vacío, cantidad entera ≥ 1. Devuelve mensaje de error o null. */
export function validatePlacements(rows: PlacementRow[]): string | null {
  if (rows.length === 0) return "Agregá al menos un material";
  for (const r of rows) {
    if (!r.MaterialName.trim()) return "Hay un material sin nombre";
    if (!Number.isInteger(r.Quantity) || r.Quantity < 1) return `Cantidad inválida en ${placementLabel(r)}`;
  }
  return null;
}

export function toPlacementInputs(rows: PlacementRow[]): VisitPOPPlacementInput[] {
  return rows.map((r) => ({
    MaterialCode: r.MaterialCode,
    MaterialName: r.MaterialName.trim(),
    Quantity: Math.max(1, Math.floor(r.Quantity)),
    Location: r.Location.trim() ? r.Location.trim() : null,
  }));
}

/** VisitAction.Description es String(500) en la DB. */
export const ACTION_DESCRIPTION_MAX = 500;

/** Description legible de la acción: "MKT-000211 VLANK CELULOSA - COLGANTE x3 (Mostrador); ..." */
export function buildPlacementDescription(rows: PlacementRow[], max = ACTION_DESCRIPTION_MAX): string {
  const text = rows
    .map((r) => `${placementLabel({ ...r, MaterialName: r.MaterialName.trim() })} x${r.Quantity}${r.Location.trim() ? ` (${r.Location.trim()})` : ""}`)
    .join("; ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Conjunto completo de colocaciones de la visita a partir de las acciones "pop"
 * (cada una guarda sus renglones en DetailsJson.placements). Acciones viejas
 * (sin placements) no aportan nada.
 */
export function collectPlacementsFromActions(
  actions: Array<{ ActionType: string; DetailsJson?: string | null }>,
): VisitPOPPlacementInput[] {
  const out: VisitPOPPlacementInput[] = [];
  for (const a of actions) {
    if (a.ActionType !== "pop" || !a.DetailsJson) continue;
    try {
      const d = JSON.parse(a.DetailsJson) as { placements?: PlacementRow[] };
      if (Array.isArray(d.placements)) out.push(...toPlacementInputs(d.placements));
    } catch { /* DetailsJson corrupto: ignorar */ }
  }
  return out;
}

// ── Catálogo offline ────────────────────────────────────────────────────────

/** Catálogo MKT con cache offline (fetchWithCache: write-through, fallback a cache). */
export function loadPopMaterials(): Promise<PopMaterial[]> {
  return fetchWithCache(POP_MATERIALS_CACHE_KEY, () => popMaterialsApi.list());
}

export function usePopMaterials(): { materials: PopMaterial[]; loading: boolean; error: boolean } {
  const [materials, setMaterials] = useState<PopMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    loadPopMaterials()
      .then((m) => { if (alive) setMaterials(m.filter((x) => x.IsActive !== false)); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { materials, loading, error };
}
