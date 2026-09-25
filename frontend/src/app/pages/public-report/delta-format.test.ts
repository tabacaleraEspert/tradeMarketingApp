import { describe, expect, it } from "vitest";
import { dayMonth, deltaClass, fmtDelta } from "./delta-format";

describe("fmtDelta", () => {
  it("cantidades con desvío %", () => {
    expect(fmtDelta({ base: 100, diff: 32, pct: 32, unit: "", better: true })).toBe("▲ +32 (+32%)");
    expect(fmtDelta({ base: 10, diff: -4, pct: -40, unit: "", better: false })).toBe("▼ −4 (−40%)");
  });
  it("porcentajes en pp, sin desvío %", () => {
    expect(fmtDelta({ base: 46, diff: -6, pct: null, unit: "pp", better: false })).toBe("▼ −6 pp");
  });
  it("decimales con coma", () => {
    expect(fmtDelta({ base: 20, diff: 1.9, pct: 10, unit: "", better: true })).toBe("▲ +1,9 (+10%)");
  });
  it("sin cambio / sin dato / compacto", () => {
    expect(fmtDelta({ base: 5, diff: 0, pct: 0, unit: "", better: null })).toBe("= sin cambio");
    expect(fmtDelta(null)).toBe("—");
    expect(fmtDelta({ base: 2, diff: 1, pct: 50, unit: "", better: true }, true)).toBe("▲ +1");
  });
});

describe("deltaClass / dayMonth", () => {
  it("color según mejora", () => {
    expect(deltaClass({ base: 1, diff: 1, pct: 100, unit: "", better: true })).toContain("green");
    expect(deltaClass({ base: 1, diff: 1, pct: 100, unit: "", better: false })).toContain("red");
    expect(deltaClass({ base: 1, diff: 1, pct: 100, unit: "", better: null })).toBe("text-muted-foreground");
  });
  it("fecha corta", () => expect(dayMonth("2026-09-07")).toBe("07/09"));
});
