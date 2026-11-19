import { describe, expect, it } from "vitest";
import { sortRows } from "./sort";

const rows = [
  { n: "Córdoba", v: 33 as number | null },
  { n: "amba", v: 48 },
  { n: "Sin zona", v: null },
  { n: "Cuyo", v: 38 },
];

describe("sortRows", () => {
  it("ordena números en las dos direcciones", () => {
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.v)).toEqual([48, 38, 33, null]);
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.v)).toEqual([33, 38, 48, null]);
  });

  it("los vacíos quedan al final en cualquier dirección", () => {
    for (const dir of ["asc", "desc"] as const) {
      expect(sortRows(rows, (r) => r.v, dir).at(-1)?.n).toBe("Sin zona");
    }
  });

  it("ordena texto sin distinguir mayúsculas ni acentos", () => {
    expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.n)).toEqual(["amba", "Córdoba", "Cuyo", "Sin zona"]);
  });

  it("no modifica el arreglo original y es estable en empates", () => {
    const same = [{ id: 1, v: 5 }, { id: 2, v: 5 }, { id: 3, v: 1 }];
    expect(sortRows(same, (r) => r.v, "desc").map((r) => r.id)).toEqual([1, 2, 3]);
    expect(same.map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
