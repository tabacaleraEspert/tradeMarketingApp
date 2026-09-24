import { describe, it, expect } from "vitest";
import {
  addDays,
  dayLabel,
  daysBetween,
  formatRangeLabel,
  hhmm,
  kmFmt,
  minFmt,
  rangeError,
  resolveRange,
} from "./range-utils";

// 2026-09-24 es jueves.
const TODAY = "2026-09-24";

describe("resolveRange", () => {
  it("hoy → mismo día", () => {
    expect(resolveRange({ preset: "hoy" }, TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it("esta_semana → lunes..hoy", () => {
    expect(resolveRange({ preset: "esta_semana" }, TODAY)).toEqual({ from: "2026-09-21", to: TODAY });
  });

  it("esta_semana un lunes → un solo día", () => {
    expect(resolveRange({ preset: "esta_semana" }, "2026-09-21")).toEqual({ from: "2026-09-21", to: "2026-09-21" });
  });

  it("esta_semana un domingo → lunes..domingo (7 días)", () => {
    const r = resolveRange({ preset: "esta_semana" }, "2026-09-27")!;
    expect(r).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(daysBetween(r.from, r.to)).toBe(7);
  });

  it("semana_pasada → última semana cerrada lun–dom", () => {
    expect(resolveRange({ preset: "semana_pasada" }, TODAY)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });

  it("semana_pasada un lunes → la semana anterior completa", () => {
    expect(resolveRange({ preset: "semana_pasada" }, "2026-09-21")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });

  it("este_mes → 1..hoy", () => {
    expect(resolveRange({ preset: "este_mes" }, TODAY)).toEqual({ from: "2026-09-01", to: TODAY });
  });

  it("mes_anterior → mes completo (31 días de agosto)", () => {
    expect(resolveRange({ preset: "mes_anterior" }, TODAY)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("mes_anterior en enero cruza de año", () => {
    expect(resolveRange({ preset: "mes_anterior" }, "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("mes_anterior en marzo → febrero (28 días en 2026)", () => {
    expect(resolveRange({ preset: "mes_anterior" }, "2026-03-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("ultimos_30 → hoy-29..hoy (30 días inclusivos)", () => {
    const r = resolveRange({ preset: "ultimos_30" }, TODAY)!;
    expect(r).toEqual({ from: "2026-08-26", to: TODAY });
    expect(daysBetween(r.from, r.to)).toBe(30);
  });

  it("custom válido devuelve tal cual; incompleto o invertido → null", () => {
    expect(resolveRange({ preset: "custom", from: "2026-09-01", to: "2026-09-10" }, TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-10" });
    expect(resolveRange({ preset: "custom", from: "2026-09-01" }, TODAY)).toBeNull();
    expect(resolveRange({ preset: "custom", from: "2026-09-10", to: "2026-09-01" }, TODAY)).toBeNull();
  });
});

describe("rangeError", () => {
  it("presets nunca dan error", () => {
    expect(rangeError({ preset: "este_mes" }, TODAY)).toBeNull();
  });
  it("custom > 92 días → error; 92 exactos → ok", () => {
    expect(rangeError({ preset: "custom", from: "2026-06-01", to: "2026-09-24" }, TODAY)).toMatch(/Máximo 92/);
    expect(rangeError({ preset: "custom", from: "2026-06-25", to: "2026-09-24" }, TODAY)).toBeNull();
  });
  it("custom incompleto / invertido → mensaje", () => {
    expect(rangeError({ preset: "custom", from: "2026-09-01" }, TODAY)).toMatch(/desde y hasta/);
    expect(rangeError({ preset: "custom", from: "2026-09-10", to: "2026-09-01" }, TODAY)).toMatch(/posterior/);
  });
});

describe("helpers de fecha", () => {
  it("addDays cruza mes y año", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("daysBetween inclusivo", () => {
    expect(daysBetween("2026-09-01", "2026-09-01")).toBe(1);
    expect(daysBetween("2026-09-01", "2026-09-30")).toBe(30);
  });
  it("dayLabel en castellano", () => {
    expect(dayLabel("2026-09-24")).toBe("jue 24 sep");
    expect(dayLabel("2026-09-27")).toBe("dom 27 sep");
  });
  it("formatRangeLabel según mismo mes / año / distintos", () => {
    expect(formatRangeLabel({ from: "2026-09-24", to: "2026-09-24" })).toBe("24 sep 2026");
    expect(formatRangeLabel({ from: "2026-09-01", to: "2026-09-24" })).toBe("1 – 24 sep 2026");
    expect(formatRangeLabel({ from: "2026-08-26", to: "2026-09-24" })).toBe("26 ago – 24 sep 2026");
    expect(formatRangeLabel({ from: "2025-12-01", to: "2026-01-15" })).toBe("1 dic 2025 – 15 ene 2026");
  });
  it("hhmm convierte a hora Argentina", () => {
    expect(hhmm("2026-09-24T12:05:00Z")).toBe("09:05");
    expect(hhmm("2026-09-24T02:30:00Z")).toBe("23:30");
    expect(hhmm(null)).toBe("—");
    expect(hhmm("no-es-fecha")).toBe("—");
  });
  it("kmFmt y minFmt", () => {
    expect(kmFmt(12.34)).toBe("12,3 km");
    expect(kmFmt(null)).toBe("—");
    expect(minFmt(45)).toBe("45 min");
    expect(minFmt(85)).toBe("1 h 25 min");
    expect(minFmt(120)).toBe("2 h");
    expect(minFmt(null)).toBe("—");
  });
});
