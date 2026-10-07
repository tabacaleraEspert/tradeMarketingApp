import { describe, expect, it } from "vitest";
import type { PdvSupplier, Supplier, SupplierSeller } from "@/lib/api/types";
import {
  buildLinkBody,
  buildOptimisticPdvSupplier,
  filterSuppliers,
  findSellerByName,
  findSupplierByName,
  formatPdvSupplierLabel,
  mergeFetchedZoneSuppliers,
  mergeIntoZoneSuppliers,
  normalizeName,
  nextTempId,
  scopeSuppliersToZone,
  shouldDeactivateLegacy,
  shouldDeactivateOriginal,
  upsertPdvSupplier,
} from "./suppliers";

const seller = (id: number, Name: string, Phone: string | null = null): SupplierSeller => ({
  SupplierSellerId: id, Name, Phone, IsActive: true,
});

const sup = (id: number, Name: string, o: Partial<Supplier> = {}): Supplier => ({
  SupplierId: id, ZoneId: 1, ZoneName: "Cuyo", Name, SupplierTypeId: null, SupplierTypeName: null,
  Products: null, IsActive: true, PdvCount: 0, Sellers: [], ...o,
});

const LIST: Supplier[] = [
  sup(1, "Distribuidora Núñez", { Sellers: [seller(10, "Juan Pérez", "261 555-1234")] }),
  sup(2, "Mayorista Andes"),
  sup(3, "Espert", { Sellers: [seller(30, "Carla")] }),
];

describe("normalizeName", () => {
  it("minúsculas, sin tildes, espacios colapsados", () => {
    expect(normalizeName("  Distribuidora   NÚÑEZ ")).toBe("distribuidora nunez");
    expect(normalizeName(null)).toBe("");
  });
});

describe("filterSuppliers", () => {
  it("sin búsqueda devuelve todo ordenado por nombre", () => {
    expect(filterSuppliers(LIST, "").map((s) => s.Name)).toEqual(["Distribuidora Núñez", "Espert", "Mayorista Andes"]);
  });
  it("matchea por nombre sin tildes", () => {
    expect(filterSuppliers(LIST, "nunez").map((s) => s.SupplierId)).toEqual([1]);
  });
  it("matchea por vendedor", () => {
    expect(filterSuppliers(LIST, "carla").map((s) => s.SupplierId)).toEqual([3]);
    expect(filterSuppliers(LIST, "PEREZ").map((s) => s.SupplierId)).toEqual([1]);
  });
  it("matchea por teléfono (dígitos)", () => {
    expect(filterSuppliers(LIST, "5551234").map((s) => s.SupplierId)).toEqual([1]);
    expect(filterSuppliers(LIST, "26").map((s) => s.SupplierId)).toEqual([]);
  });
  it("prioriza los que empiezan con la búsqueda", () => {
    const l = [sup(1, "La Andina"), sup(2, "Andes")];
    expect(filterSuppliers(l, "and").map((s) => s.Name)).toEqual(["Andes", "La Andina"]);
  });
});

describe("scopeSuppliersToZone", () => {
  it("una sola zona (no-admin): no filtra", () => {
    expect(scopeSuppliersToZone(LIST, 99)).toHaveLength(3);
  });
  it("varias zonas (admin): filtra por la del PDV", () => {
    const l = [...LIST, sup(4, "Otro", { ZoneId: 2 })];
    expect(scopeSuppliersToZone(l, 2).map((s) => s.SupplierId)).toEqual([4]);
    expect(scopeSuppliersToZone(l, null)).toHaveLength(4);
  });
  it("no-admin: zona del PDV + la suya", () => {
    const l = [...LIST, sup(4, "Otro", { ZoneId: 2 }), sup(5, "Tercero", { ZoneId: 3 })];
    expect(scopeSuppliersToZone(l, 2, 1).map((s) => s.SupplierId)).toEqual([1, 2, 3, 4]);
  });
});

describe("mergeFetchedZoneSuppliers", () => {
  it("reemplaza zonas cubiertas, conserva reales de otras zonas, descarta temporales", () => {
    const cached = [
      sup(1, "Viejo Z1"),                       // zona 1 cubierta → se va
      sup(-9, "Temp Z3", { ZoneId: 3 }),        // temporal → se va
      sup(7, "Real Z3", { ZoneId: 3 }),         // otra zona → queda
      sup(8, "Real Z2 inactivo", { ZoneId: 2 }), // zona 2 pedida (sin resultados) → se va
    ];
    const fresh = [sup(2, "Nuevo Z1")];
    expect(mergeFetchedZoneSuppliers(cached, fresh, [1, 2]).map((s) => s.SupplierId)).toEqual([2, 7]);
  });
  it("no duplica por ID", () => {
    const fresh = [sup(7, "Real Z3", { ZoneId: 3 })];
    expect(mergeFetchedZoneSuppliers([sup(7, "x", { ZoneId: 3 })], fresh, [1])).toHaveLength(1);
  });
});

describe("find por nombre", () => {
  it("proveedor y vendedor por nombre normalizado", () => {
    expect(findSupplierByName(LIST, "distribuidora nuñez")?.SupplierId).toBe(1);
    expect(findSupplierByName(LIST, "")).toBeUndefined();
    expect(findSellerByName(LIST[0], "juan  perez")?.SupplierSellerId).toBe(10);
  });
});

describe("formatPdvSupplierLabel", () => {
  it("proveedor · vendedor (tel)", () => {
    expect(formatPdvSupplierLabel({ Name: "Núñez", Phone: "", SellerName: "Juan", SellerPhone: "123" })).toBe("Núñez · Juan (123)");
    expect(formatPdvSupplierLabel({ Name: "Núñez", Phone: "", SellerName: "Juan", SellerPhone: null })).toBe("Núñez · Juan");
  });
  it("legacy: teléfono del proveedor", () => {
    expect(formatPdvSupplierLabel({ Name: "Viejo", Phone: "456" })).toBe("Viejo (456)");
    expect(formatPdvSupplierLabel({ Name: "Viejo", Phone: "" })).toBe("Viejo");
  });
});

describe("buildLinkBody", () => {
  it("proveedor y vendedor existentes → IDs", () => {
    expect(buildLinkBody(LIST[0], LIST[0].Sellers[0])).toEqual({ SupplierId: 1, SupplierSellerId: 10 });
  });
  it("sin vendedor", () => {
    expect(buildLinkBody(LIST[1], null)).toEqual({ SupplierId: 2 });
  });
  it("vendedor nuevo (ID negativo) en proveedor existente → NewSeller, sin Phone vacío", () => {
    expect(buildLinkBody(LIST[1], seller(-5, " Pepe ", ""))).toEqual({ SupplierId: 2, NewSeller: { Name: "Pepe" } });
    expect(buildLinkBody(LIST[1], seller(-5, "Pepe", "11"))).toEqual({ SupplierId: 2, NewSeller: { Name: "Pepe", Phone: "11" } });
  });
  it("proveedor nuevo → NewSupplier (+ NewSeller)", () => {
    const nuevo = sup(-1, "Nuevo SA", { SupplierTypeId: 3, Products: ["Cigarrillos"] });
    expect(buildLinkBody(nuevo, seller(-2, "Ana"))).toEqual({
      NewSupplier: { Name: "Nuevo SA", SupplierTypeId: 3, Products: ["Cigarrillos"] },
      NewSeller: { Name: "Ana" },
    });
    expect(buildLinkBody(sup(-1, "X"), null)).toEqual({ NewSupplier: { Name: "X" } });
  });
});

describe("mergeIntoZoneSuppliers", () => {
  it("proveedor nuevo offline se agrega con su vendedor", () => {
    const nuevo = sup(-1, "Nuevo SA");
    const out = mergeIntoZoneSuppliers(LIST, nuevo, seller(-2, "Ana"));
    expect(out).toHaveLength(4);
    expect(out[3].Sellers.map((v) => v.Name)).toEqual(["Ana"]);
  });
  it("mismo nombre normalizado en la zona → reusa el proveedor", () => {
    const out = mergeIntoZoneSuppliers(LIST, sup(-1, "mayorista ANDES"), seller(-2, "Leo"));
    expect(out).toHaveLength(3);
    expect(out[1].SupplierId).toBe(2);
    expect(out[1].Sellers.map((v) => v.Name)).toEqual(["Leo"]);
  });
  it("vendedor existente por nombre: no duplica y completa teléfono", () => {
    const out = mergeIntoZoneSuppliers(LIST, LIST[2], seller(-9, "carla", "999"));
    expect(out[2].Sellers).toEqual([{ ...seller(30, "Carla"), Phone: "999" }]);
  });
  it("no muta la lista original", () => {
    mergeIntoZoneSuppliers(LIST, LIST[1], seller(-3, "Z"));
    expect(LIST[1].Sellers).toEqual([]);
  });
});

describe("upsertPdvSupplier / optimista", () => {
  it("reemplaza la fila del mismo proveedor (cambio de vendedor)", () => {
    const a = buildOptimisticPdvSupplier(5, LIST[0], null);
    const b = buildOptimisticPdvSupplier(5, LIST[0], LIST[0].Sellers[0]);
    const out = upsertPdvSupplier([a], b);
    expect(out).toHaveLength(1);
    expect(out[0].SellerName).toBe("Juan Pérez");
    expect(out[0].PdvSupplierId).toBeLessThan(0);
  });
  it("adopta la fila legacy del mismo nombre (como el backend)", () => {
    const legacy = { PdvSupplierId: 7, Name: "distribuidora nunez", SupplierId: null } as PdvSupplier;
    const out = upsertPdvSupplier([legacy], buildOptimisticPdvSupplier(5, LIST[0], null));
    expect(out).toHaveLength(1);
    expect(out[0].SupplierId).toBe(1);
  });
  it("agrega si es otro proveedor", () => {
    const other = { PdvSupplierId: 7, Name: "Otro", SupplierId: null } as PdvSupplier;
    expect(upsertPdvSupplier([other], buildOptimisticPdvSupplier(5, LIST[0], null))).toHaveLength(2);
  });
  it("nextTempId negativo y distinto", () => {
    const a = nextTempId();
    const b = nextTempId();
    expect(a).toBeLessThan(0);
    expect(a).not.toBe(b);
  });
});

describe("shouldDeactivateLegacy", () => {
  const legacy = { PdvSupplierId: 7, Name: "Distrib. Nuñez" };
  it("mismo nombre normalizado → el backend la adopta, no se toca", () => {
    expect(shouldDeactivateLegacy({ PdvSupplierId: 7, Name: "distribuidora nuñez" }, "Distribuidora Núñez")).toBe(false);
  });
  it("nombre distinto → se da de baja", () => {
    expect(shouldDeactivateLegacy(legacy, "Distribuidora Núñez")).toBe(true);
  });
  it("online: si el server devolvió la misma fila, no", () => {
    expect(shouldDeactivateLegacy(legacy, "Distribuidora Núñez", 7)).toBe(false);
    expect(shouldDeactivateLegacy(legacy, "Distribuidora Núñez", 8)).toBe(true);
  });
  it("fila temporal → no", () => {
    expect(shouldDeactivateLegacy({ PdvSupplierId: -3, Name: "x" }, "y")).toBe(false);
  });
});

describe("shouldDeactivateOriginal", () => {
  const linked = { PdvSupplierId: 7, Name: "Distri Norte", SupplierId: 10 };
  it("fila vieja → misma regla que legacy", () => {
    expect(shouldDeactivateOriginal({ ...linked, SupplierId: null }, { SupplierId: 3, Name: "distri norte" })).toBe(false);
    expect(shouldDeactivateOriginal({ ...linked, SupplierId: null }, { SupplierId: 3, Name: "Otro" })).toBe(true);
  });
  it("vinculada, mismo proveedor (cambia vendedor) → no", () => {
    expect(shouldDeactivateOriginal(linked, { SupplierId: 10, Name: "Distri Norte" })).toBe(false);
  });
  it("vinculada, otro proveedor real → sí (aunque el nombre coincida)", () => {
    expect(shouldDeactivateOriginal(linked, { SupplierId: 11, Name: "Distri Norte" })).toBe(true);
  });
  it("vinculada, proveedor nuevo offline → por nombre", () => {
    expect(shouldDeactivateOriginal(linked, { SupplierId: -5, Name: "distri  NORTE" })).toBe(false);
    expect(shouldDeactivateOriginal(linked, { SupplierId: -5, Name: "Distri Sur" })).toBe(true);
  });
  it("el server devolvió la misma fila o fila temporal → no", () => {
    expect(shouldDeactivateOriginal(linked, { SupplierId: 11, Name: "x" }, 7)).toBe(false);
    expect(shouldDeactivateOriginal({ ...linked, PdvSupplierId: -2 }, { SupplierId: 11, Name: "x" })).toBe(false);
  });
});
