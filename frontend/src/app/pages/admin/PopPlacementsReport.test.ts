import { describe, it, expect } from "vitest";
import { filterByMaterial } from "./PopPlacementsReport";
import type { PopPlacementReportRow } from "@/lib/api/types";

const row = (MaterialCode: string | null, MaterialName: string, Line: string | null = null): PopPlacementReportRow => ({
  VisitId: 1, Date: "2026-10-01", UserId: 1, UserName: "u", PdvId: 1, PdvName: "p", ZoneName: null,
  MaterialCode, MaterialName, Line, Type: null, Quantity: 1, Location: null,
});

describe("filterByMaterial", () => {
  const rows = [
    row("MKT-000008", "(*) Van Kiff_Totem x 6 - ArtEdition2.0_KOON", "VAN KIFF"),
    row("MKT-000190", "MILL - FAMILIA - MOVIE - 2026", "MILENIO"),
    row(null, "Afiche vanKiff"),
  ];
  it("texto libre sin acentos ni mayúsculas, todas las palabras", () => {
    expect(filterByMaterial(rows, "", "van kiff").map((r) => r.MaterialCode)).toEqual(["MKT-000008", null]); // "vanKiff" también
    expect(filterByMaterial(rows, "", "KÍFF totem")).toHaveLength(1);
    expect(filterByMaterial(rows, "", "mkt-000190")).toHaveLength(1);
  });
  it("línea exacta", () => {
    expect(filterByMaterial(rows, "MILENIO", "")).toHaveLength(1);
  });
  it("sin filtros devuelve todo", () => {
    expect(filterByMaterial(rows, "", "  ")).toHaveLength(3);
  });
});
