import { describe, it, expect } from "vitest";
import type { Product, CoverageDiff } from "@/lib/api/types";
import {
  type CoverageRow,
  EMPTY_ROW,
  brandOf,
  deriveState,
  summarizeBrand,
  groupByBrand,
  deriveCategoryState,
  initialRowFromDiff,
  isInheritedRow,
  normalizeDraftRow,
  normalizeDraftCategoryStatus,
  buildPersistItems,
  buildCategoryItems,
  brandsWithoutData,
  countStates,
} from "./coverage-utils";

const prod = (id: number, name: string, extra: Partial<Product> = {}): Product => ({
  ProductId: id,
  Name: name,
  Category: "Cigarrillos",
  Brand: null,
  Manufacturer: null,
  IsOwn: false,
  IsActive: true,
  SortOrder: id,
  CreatedAt: "",
  ...extra,
});

const row = (pid: number, State: CoverageRow["State"], extra: Partial<CoverageRow> = {}): CoverageRow => ({
  ...EMPTY_ROW(pid),
  State,
  ...extra,
});

const diff = (pid: number, extra: Partial<CoverageDiff> = {}): CoverageDiff => ({
  ProductId: pid,
  ProductName: "x",
  Category: "Cigarrillos",
  Brand: null,
  Manufacturer: null,
  Works: false,
  Price: null,
  Availability: null,
  Puffs: null,
  HasCurrentData: false,
  PrevWorks: null,
  PrevPrice: null,
  PrevAvailability: null,
  PrevPuffs: null,
  ...extra,
});

describe("brandOf", () => {
  it("uses Brand when present, first word of Name otherwise", () => {
    expect(brandOf({ Name: "Marlboro Box 20", Brand: "Marlboro" })).toBe("Marlboro");
    expect(brandOf({ Name: "Marlboro Box 20", Brand: "  " })).toBe("Marlboro");
    expect(brandOf({ Name: "Philip Morris KS", Brand: null })).toBe("Philip");
  });
});

describe("deriveState / summarizeBrand", () => {
  it("si if any si, no if all no, else sin_dato", () => {
    expect(deriveState(["sin_dato", "si", "no"])).toBe("si");
    expect(deriveState(["no", "no"])).toBe("no");
    expect(deriveState(["no", "sin_dato"])).toBe("sin_dato");
    expect(deriveState([])).toBe("sin_dato");
  });

  it("counts variants with data", () => {
    const products = [prod(1, "A"), prod(2, "B"), prod(3, "C")];
    const rows = { 1: row(1, "si"), 2: row(2, "no"), 3: row(3, "sin_dato") };
    expect(summarizeBrand(products, rows)).toEqual({ state: "si", withData: 2, total: 3 });
  });
});

describe("groupByBrand", () => {
  it("groups by brand; Espert first, then brands with sin_dato, then the rest; SortOrder within brand", () => {
    const products = [
      prod(1, "Camel Box", { Brand: "Camel", SortOrder: 5 }),
      prod(2, "Camel Blue", { Brand: "Camel", SortOrder: 1 }),
      prod(3, "Chesterfield KS", { Brand: "Chesterfield" }),
      prod(4, "Fox Box", { Brand: "Fox", IsOwn: true }),
    ];
    const rows = { 1: row(1, "no"), 2: row(2, "no"), 3: row(3, "sin_dato"), 4: row(4, "sin_dato") };
    const groups = groupByBrand("Cigarrillos", products, rows);
    expect(groups.map((g) => g.brand)).toEqual(["Fox", "Chesterfield", "Camel"]);
    expect(groups[0].isOwn).toBe(true);
    expect(groups[0].key).toBe("Cigarrillos::Fox");
    expect(groups[2].products.map((p) => p.ProductId)).toEqual([2, 1]);
  });

  it("orderRows freezes the order: live rows don't reorder brands", () => {
    const products = [
      prod(1, "Camel Box", { Brand: "Camel" }),
      prod(2, "Chesterfield KS", { Brand: "Chesterfield" }),
    ];
    const atLoad = { 1: row(1, "sin_dato"), 2: row(2, "no") };
    // Live: Camel now complete, Chesterfield reset to sin_dato — would swap without the snapshot.
    const live = { 1: row(1, "si"), 2: row(2, "sin_dato") };
    expect(groupByBrand("Cigarrillos", products, live, atLoad).map((g) => g.brand)).toEqual(["Camel", "Chesterfield"]);
    expect(groupByBrand("Cigarrillos", products, live).map((g) => g.brand)).toEqual(["Chesterfield", "Camel"]);
  });
});

describe("deriveCategoryState", () => {
  const products = [prod(1, "A"), prod(2, "B")];

  it("auto-si when any product si, auto-no when all no", () => {
    expect(deriveCategoryState(products, { 1: row(1, "si"), 2: row(2, "no") }, "no")).toBe("si");
    expect(deriveCategoryState(products, { 1: row(1, "no"), 2: row(2, "no") }, "si")).toBe("no");
  });

  it("falls back to explicit state, default sin_dato", () => {
    const rows = { 1: row(1, "sin_dato"), 2: row(2, "no") };
    expect(deriveCategoryState(products, rows, "si")).toBe("si");
    expect(deriveCategoryState(products, rows, "no")).toBe("no");
    expect(deriveCategoryState(products, rows, undefined)).toBe("sin_dato");
  });

  it("si when there are 'otros'", () => {
    expect(deriveCategoryState(products, {}, undefined, true)).toBe("si");
  });
});

describe("initialRowFromDiff", () => {
  it("current data wins: Works → si/no", () => {
    const r = initialRowFromDiff(1, diff(1, { HasCurrentData: true, Works: false, PrevWorks: true }), true);
    expect(r.State).toBe("no");
    const r2 = initialRowFromDiff(1, diff(1, { HasCurrentData: true, Works: true, Price: 1500, Puffs: 600 }), false);
    expect(r2).toMatchObject({ State: "si", Price: "1500", Puffs: "600" });
  });

  it("inherits from previous visit: true→si, false→no, null→sin_dato", () => {
    expect(initialRowFromDiff(1, diff(1, { PrevWorks: true, PrevPrice: 900, PrevPuffs: 300 }), true))
      .toMatchObject({ State: "si", Price: "900", Puffs: "300" });
    expect(initialRowFromDiff(1, diff(1, { PrevWorks: false }), true).State).toBe("no");
    expect(initialRowFromDiff(1, diff(1, { PrevWorks: null }), true).State).toBe("sin_dato");
  });

  it("no inheritance on first visit / no diff", () => {
    expect(initialRowFromDiff(1, diff(1, { PrevWorks: true }), false).State).toBe("sin_dato");
    expect(initialRowFromDiff(1, undefined, true).State).toBe("sin_dato");
  });
});

describe("isInheritedRow", () => {
  it("chip only when no current data and state matches PrevWorks", () => {
    expect(isInheritedRow(row(1, "si"), diff(1, { PrevWorks: true }))).toBe(true);
    expect(isInheritedRow(row(1, "no"), diff(1, { PrevWorks: false }))).toBe(true);
    expect(isInheritedRow(row(1, "no"), diff(1, { PrevWorks: true }))).toBe(false);
    expect(isInheritedRow(row(1, "si"), diff(1, { PrevWorks: true, HasCurrentData: true }))).toBe(false);
    expect(isInheritedRow(row(1, "si"), undefined)).toBe(false);
  });
});

describe("draft normalization", () => {
  it("keeps new rows, maps old Works rows (true→si, false→sin_dato)", () => {
    expect(normalizeDraftRow({ ProductId: 1, State: "no", Price: "", Availability: "disponible", Puffs: "" }, 1)?.State).toBe("no");
    expect(normalizeDraftRow({ ProductId: 1, Works: true, Price: "800", Availability: "quiebre", Puffs: "" }, 1))
      .toEqual({ ProductId: 1, State: "si", Price: "800", Availability: "quiebre", Puffs: "" });
    expect(normalizeDraftRow({ ProductId: 1, Works: false }, 1)?.State).toBe("sin_dato");
    expect(normalizeDraftRow({ garbage: 1 }, 1)).toBeNull();
    expect(normalizeDraftRow(null, 1)).toBeNull();
  });

  it("maps old boolean category status", () => {
    expect(normalizeDraftCategoryStatus({ A: true, B: false, C: "no", D: "zzz" })).toEqual({ A: "si", B: "sin_dato", C: "no" });
    expect(normalizeDraftCategoryStatus(undefined)).toEqual({});
  });
});

describe("buildPersistItems", () => {
  it("omits sin_dato; price/disp/puffs only when si", () => {
    const rows = {
      1: row(1, "si", { Price: "1200", Availability: "quiebre", Puffs: "500" }),
      2: row(2, "no", { Price: "999", Availability: "quiebre", Puffs: "10" }),
      3: row(3, "sin_dato", { Price: "5" }),
      4: row(4, "si"),
    };
    expect(buildPersistItems(rows)).toEqual([
      { ProductId: 1, Works: true, Price: 1200, Availability: "quiebre", Puffs: 500 },
      { ProductId: 2, Works: false, Price: undefined, Availability: undefined, Puffs: undefined },
      { ProductId: 4, Works: true, Price: undefined, Availability: "disponible", Puffs: undefined },
    ]);
  });
});

describe("buildCategoryItems", () => {
  it("sends only si/no as trabaja/no_trabaja", () => {
    expect(buildCategoryItems({ A: "si", B: "no", C: "sin_dato" })).toEqual([
      { Category: "A", Status: "trabaja" },
      { Category: "B", Status: "no_trabaja" },
    ]);
  });
});

describe("brandsWithoutData", () => {
  it("lists open brands whose variants are all sin_dato", () => {
    const products = [
      prod(1, "Camel Box", { Brand: "Camel" }),
      prod(2, "Camel Blue", { Brand: "Camel" }),
      prod(3, "Fox Box", { Brand: "Fox" }),
      prod(4, "Fox Blue", { Brand: "Fox" }),
    ];
    const rows = { 1: row(1, "sin_dato"), 2: row(2, "sin_dato"), 3: row(3, "no"), 4: row(4, "sin_dato") };
    const groups = groupByBrand("Cigarrillos", products, rows);
    expect(brandsWithoutData(new Set(["Cigarrillos::Camel", "Cigarrillos::Fox", "Cigarrillos::Nope"]), groups, rows))
      .toEqual(["Camel"]);
  });
});

describe("countStates", () => {
  it("counts si/no/sin_dato, Espert si and quiebres", () => {
    const products = [prod(1, "A", { IsOwn: true }), prod(2, "B"), prod(3, "C"), prod(4, "D", { IsOwn: true })];
    const rows = {
      1: row(1, "si", { Availability: "quiebre" }),
      2: row(2, "no"),
      3: row(3, "sin_dato"),
      4: row(4, "no", { Availability: "quiebre" }),
    };
    expect(countStates(products, rows)).toEqual({ si: 1, no: 2, sinDato: 1, ownSi: 1, quiebres: 1, withData: 3, total: 4 });
  });
});
