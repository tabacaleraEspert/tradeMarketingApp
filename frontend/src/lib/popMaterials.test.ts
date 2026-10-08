import { describe, expect, it } from "vitest";
import type { PopMaterial, VisitPOPItem } from "@/lib/api/types";
import {
  buildCensusPayload,
  buildCensusState,
  buildPlacementDescription,
  collectPlacementsFromActions,
  distinctValues,
  espertItemFromMaterial,
  espertPhotoKey,
  filterPopMaterials,
  materialTypeFor,
  overlayCensusDraft,
  toPlacementInputs,
  validatePlacements,
  type PlacementRow,
} from "./popMaterials";

const mat = (Code: string, Description: string, Line: string | null, Type: string | null, o: Partial<PopMaterial> = {}): PopMaterial => ({
  Code, Description, Line, Type, Year: 2026, PhotoUrl: null, Stock: 10, IsActive: true, ...o,
});

const CATALOG: PopMaterial[] = [
  mat("MKT-000211", "VLANK CELULOSA - COLGANTE - 2026", "VLANK CELULOSA", "COLGANTE"),
  mat("MKT-000210", "MILENIO - CIGARRERA AEREA - 2025", "MILENIO", "CIGARRERA AEREA", { Stock: 0 }),
  mat("MKT-000150", "MELBOURNE - STOPPER - 2024", "MELBOURNE", "STOPPER"),
  mat("MKT-000149", "Milenio - Display Mostrador", "MILENIO", null),
];

const saved = (o: Partial<VisitPOPItem>): VisitPOPItem => ({
  VisitPOPItemId: 1, VisitId: 1, MaterialType: "primario", MaterialName: "", Company: null,
  Present: true, HasPrice: null, CreatedAt: "2026-10-01", ...o,
});

describe("filterPopMaterials (picker)", () => {
  it("sin filtros devuelve todo (stock 0 incluido)", () => {
    expect(filterPopMaterials(CATALOG, {})).toHaveLength(4);
  });
  it("busca por código parcial", () => {
    expect(filterPopMaterials(CATALOG, { query: "211" }).map((m) => m.Code)).toEqual(["MKT-000211"]);
  });
  it("busca por descripción, multi-palabra, sin tildes ni mayúsculas", () => {
    expect(filterPopMaterials(CATALOG, { query: "milenio aérea" }).map((m) => m.Code)).toEqual(["MKT-000210"]);
  });
  it("filtra por línea y tipo", () => {
    expect(filterPopMaterials(CATALOG, { line: "MILENIO" }).map((m) => m.Code)).toEqual(["MKT-000210", "MKT-000149"]);
    expect(filterPopMaterials(CATALOG, { line: "MILENIO", type: "CIGARRERA AEREA" }).map((m) => m.Code)).toEqual(["MKT-000210"]);
    expect(filterPopMaterials(CATALOG, { type: "STOPPER", query: "milenio" })).toHaveLength(0);
  });
  it("chips: valores distintos ordenados, sin vacíos", () => {
    expect(distinctValues(CATALOG, "Line")).toEqual(["MELBOURNE", "MILENIO", "VLANK CELULOSA"]);
    expect(distinctValues(CATALOG, "Type")).toEqual(["CIGARRERA AEREA", "COLGANTE", "STOPPER"]);
  });
});

describe("materialTypeFor", () => {
  it("cigarrera/display/pantalla → primario; resto secundario", () => {
    expect(materialTypeFor(CATALOG[1])).toBe("primario");
    expect(materialTypeFor(CATALOG[0])).toBe("secundario");
    expect(materialTypeFor(CATALOG[2])).toBe("secundario");
    // sin Type → mira la descripción
    expect(materialTypeFor(CATALOG[3])).toBe("primario");
  });
});

describe("censo: payload", () => {
  it("ítem de catálogo → MaterialCode, MaterialName=Description, Company Espert, Present", () => {
    const state = buildCensusState([]);
    state.espert.push({ ...espertItemFromMaterial(CATALOG[0]), HasPrice: true });
    const payload = buildCensusPayload(state);
    expect(payload).toEqual([
      { MaterialType: "secundario", MaterialName: "VLANK CELULOSA - COLGANTE - 2026", Company: "Espert", Present: true, HasPrice: true, MaterialCode: "MKT-000211" },
    ]);
  });

  it("filas de competencia sin cambios (genéricas, sin código) y nunca con Espert", () => {
    const state = buildCensusState([]);
    const row = state.rows.find((r) => r.MaterialName === "Stopper")!;
    row.Present = true;
    row.Companies = ["Massalin", "BAT", "Espert"]; // Espert colado por un draft viejo
    row.HasPrice = false;
    expect(buildCensusPayload(state)).toEqual([
      { MaterialType: "secundario", MaterialName: "Stopper", Company: "Massalin, BAT", Present: true, HasPrice: false, MaterialCode: null },
    ]);
  });

  it("'otro Espert sin código' → MaterialCode null + Company Espert, ida y vuelta", () => {
    const state = buildCensusState([]);
    state.espert.push({ MaterialCode: null, MaterialName: "Cigarrera vieja Mill", MaterialType: "primario", HasPrice: null });
    const payload = buildCensusPayload(state);
    expect(payload[0]).toMatchObject({ MaterialCode: null, Company: "Espert", MaterialName: "Cigarrera vieja Mill" });
    const back = buildCensusState(payload as unknown as VisitPOPItem[]);
    expect(back.espert).toEqual([{ MaterialCode: null, MaterialName: "Cigarrera vieja Mill", MaterialType: "primario", HasPrice: null }]);
    expect(back.rows.some((r) => r.Present)).toBe(false);
  });
});

describe("censo: carga de censos viejos (sin MaterialCode)", () => {
  it("parte Espert de la fila genérica y conserva la competencia", () => {
    const st = buildCensusState([
      saved({ MaterialName: "Cigarrera aérea", Company: "Espert, Massalin", HasPrice: true }),
      saved({ MaterialType: "secundario", MaterialName: "Afiche", Company: "Espert" }),
      saved({ MaterialType: "secundario", MaterialName: "Stopper", Company: "BAT", HasPrice: false }),
    ]);
    expect(st.espert).toEqual([
      { MaterialCode: null, MaterialName: "Cigarrera aérea", MaterialType: "primario", HasPrice: true },
      { MaterialCode: null, MaterialName: "Afiche", MaterialType: "secundario", HasPrice: null },
    ]);
    const cig = st.rows.find((r) => r.MaterialName === "Cigarrera aérea")!;
    expect(cig).toMatchObject({ Companies: ["Massalin"], Present: true, HasPrice: true });
    // Afiche era sólo Espert → la fila genérica queda apagada
    expect(st.rows.find((r) => r.MaterialName === "Afiche")).toMatchObject({ Present: false, Companies: [] });
    expect(st.rows.find((r) => r.MaterialName === "Stopper")).toMatchObject({ Present: true, Companies: ["BAT"], HasPrice: false });
    // La lista genérica completa sigue presente
    expect(st.rows).toHaveLength(10);
    // La foto vieja (pop_{material}_Espert) sigue matcheando
    expect(espertPhotoKey(st.espert[0])).toBe("pop_Cigarrera aérea_Espert");
  });

  it("legado con Espert ausente (Present=false) no se convierte en pieza presente", () => {
    const st = buildCensusState([saved({ MaterialName: "Afiche", MaterialType: "secundario", Company: "Espert, BAT", Present: false })]);
    expect(st.espert).toEqual([]);
    expect(st.rows.find((r) => r.MaterialName === "Afiche")).toMatchObject({ Present: false, Companies: ["BAT"] });
  });

  it("payload recorta MaterialName a 80 (columna del censo)", () => {
    const long = "ESPERT - " + "X".repeat(120);
    const payload = buildCensusPayload({ rows: [], espert: [{ MaterialCode: "MKT-1", MaterialName: long, MaterialType: "secundario", HasPrice: null }] });
    expect(payload[0].MaterialName).toHaveLength(80);
  });

  it("ítems con MaterialCode cargan como Espert de catálogo; foto por código", () => {
    const st = buildCensusState([saved({ MaterialName: "VLANK CELULOSA - COLGANTE - 2026", Company: "Espert", MaterialCode: "MKT-000211", MaterialType: "secundario" })]);
    expect(st.espert[0].MaterialCode).toBe("MKT-000211");
    expect(espertPhotoKey(st.espert[0])).toBe("pop_MKT-000211_Espert");
  });

  it("draft viejo (array de filas) se normaliza y conserva piezas de catálogo del backend", () => {
    const base = buildCensusState([saved({ MaterialName: "X", Company: "Espert", MaterialCode: "MKT-000150", MaterialType: "secundario" })]);
    const oldDraft = [{ MaterialType: "primario", MaterialName: "Cigarrera aérea", Companies: ["Espert", "BAT"], Present: true, HasPrice: null }];
    const st = overlayCensusDraft(base, oldDraft);
    expect(st.espert.map((e) => e.MaterialCode ?? e.MaterialName)).toEqual(["Cigarrera aérea", "MKT-000150"]);
    expect(st.rows.find((r) => r.MaterialName === "Cigarrera aérea")!.Companies).toEqual(["BAT"]);
  });

  it("draft nuevo pisa el estado base; draft inválido se ignora", () => {
    const base = buildCensusState([]);
    const draft = { rows: base.rows, espert: [espertItemFromMaterial(CATALOG[1])] };
    expect(overlayCensusDraft(base, draft).espert).toHaveLength(1);
    expect(overlayCensusDraft(base, { foo: 1 })).toBe(base);
    expect(overlayCensusDraft(base, null)).toBe(base);
  });
});

describe("colocación", () => {
  const rows: PlacementRow[] = [
    { MaterialCode: "MKT-000211", MaterialName: "VLANK CELULOSA - COLGANTE", Quantity: 3, Location: "" },
    { MaterialCode: null, MaterialName: " Cigarrera vieja ", Quantity: 1, Location: " Mostrador " },
  ];

  it("Description legible", () => {
    expect(buildPlacementDescription(rows)).toBe("MKT-000211 VLANK CELULOSA - COLGANTE x3; Cigarrera vieja x1 (Mostrador)");
  });

  it("Description se corta a 500 (columna String(500))", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ MaterialCode: `MKT-000${100 + i}`, MaterialName: "MILENIO - CIGARRERA AEREA - 2025", Quantity: 1, Location: "" }));
    const d = buildPlacementDescription(many);
    expect(d.length).toBe(500);
    expect(d.endsWith("…")).toBe(true);
  });

  it("payload: trim, Location vacía → null", () => {
    expect(toPlacementInputs(rows)).toEqual([
      { MaterialCode: "MKT-000211", MaterialName: "VLANK CELULOSA - COLGANTE", Quantity: 3, Location: null },
      { MaterialCode: null, MaterialName: "Cigarrera vieja", Quantity: 1, Location: "Mostrador" },
    ]);
  });

  it("validación", () => {
    expect(validatePlacements([])).toMatch(/al menos/);
    expect(validatePlacements([{ ...rows[0], Quantity: 0 }])).toMatch(/Cantidad/);
    expect(validatePlacements(rows)).toBeNull();
  });

  it("conjunto completo desde todas las acciones pop (ignora otras y las viejas)", () => {
    const actions = [
      { ActionType: "pop", DetailsJson: JSON.stringify({ placements: [rows[0]] }) },
      { ActionType: "pop", DetailsJson: JSON.stringify({ tipo: "Primario", material: "Cigarrera aérea" }) }, // vieja
      { ActionType: "promo", DetailsJson: JSON.stringify({ placements: [rows[1]] }) },
      { ActionType: "pop", DetailsJson: "{corrupto" },
      { ActionType: "pop", DetailsJson: JSON.stringify({ placements: [rows[1]] }) },
    ];
    expect(collectPlacementsFromActions(actions)).toEqual(toPlacementInputs(rows));
  });
});
