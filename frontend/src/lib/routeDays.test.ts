import { describe, expect, it } from "vitest";
import { monthlyDates, planRouteDates } from "./routeDays";

const cfg = (o: object) => JSON.stringify(o);
// 2026-09-30 es miércoles.
const TODAY = "2026-09-30";

describe("planRouteDates", () => {
  it("semanal (lunes) 3 semanas", () => {
    expect(planRouteDates({ frequencyType: "weekly", frequencyConfig: cfg({ day: 1 }), today: TODAY, weeksAhead: 3 }))
      .toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
  });
  it("corta en la fecha de fin (inclusive)", () => {
    expect(planRouteDates({ frequencyType: "weekly", frequencyConfig: cfg({ day: 1 }), today: TODAY, endDate: "2026-10-12" }))
      .toEqual(["2026-10-05", "2026-10-12"]);
  });
  it("fin anterior a hoy → nada", () => {
    expect(planRouteDates({ frequencyType: "daily", frequencyConfig: null, today: TODAY, endDate: "2026-09-29" })).toEqual([]);
  });
  it("diaria: lunes a viernes desde el inicio futuro", () => {
    expect(planRouteDates({ frequencyType: "daily", frequencyConfig: cfg({ startDate: "2026-10-02" }), today: TODAY, endDate: "2026-10-06" }))
      .toEqual(["2026-10-02", "2026-10-05", "2026-10-06"]);
  });
  it("quincenal alineada al inicio", () => {
    // Inicio lun 21/09 → 05/10, 19/10 (no 28/09 ni 12/10).
    expect(planRouteDates({ frequencyType: "biweekly", frequencyConfig: cfg({ day: 1, startDate: "2026-09-21" }), today: TODAY, weeksAhead: 4 }))
      .toEqual(["2026-10-05", "2026-10-19"]);
  });
  it("cada X días anclado al inicio", () => {
    expect(planRouteDates({ frequencyType: "every_x_days", frequencyConfig: cfg({ interval: 10, startDate: "2026-09-25" }), today: TODAY, weeksAhead: 3 }))
      .toEqual(["2026-10-05", "2026-10-15"]);
  });
  it("mensual: mismo día del mes (bug: antes no generaba en edición)", () => {
    expect(planRouteDates({ frequencyType: "monthly", frequencyConfig: cfg({ startDate: "2026-09-15" }), today: TODAY, weeksAhead: 9 }))
      .toEqual(["2026-10-15", "2026-11-15"]);
  });
  it("días específicos + fechas existentes salteadas", () => {
    expect(planRouteDates({
      frequencyType: "specific_days", frequencyConfig: cfg({ days: [1, 3] }), today: TODAY, endDate: "2026-10-07",
      skip: new Set(["2026-09-30"]),
    })).toEqual(["2026-10-05", "2026-10-07"]);
  });
  it("sin frecuencia o config rota → nada", () => {
    expect(planRouteDates({ frequencyType: null, frequencyConfig: null, today: TODAY })).toEqual([]);
    expect(planRouteDates({ frequencyType: "weekly", frequencyConfig: "{roto", today: TODAY })).toEqual([]);
  });
});

describe("monthlyDates", () => {
  it("31 → último día en meses cortos", () => {
    expect(monthlyDates("2026-10-01", "2027-03-31", "2026-10-31"))
      .toEqual(["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
  });
  it("no antes del ancla", () => {
    expect(monthlyDates("2026-09-01", "2026-11-30", "2026-10-10")).toEqual(["2026-10-10", "2026-11-10"]);
  });
});

describe("describeOverlaps", () => {
  it("resume rutas y fechas", async () => {
    const { describeOverlaps, shortDay } = await import("./routeDays");
    expect(shortDay("2026-10-05")).toBe("lun 05/10");
    expect(describeOverlaps([
      { routeName: "Ruta Norte", routeType: "regular", overlapDates: ["2026-10-05", "2026-10-12", "2026-10-19"], overlapCount: 5 },
      { routeName: "Verano", routeType: "campaign", overlapDates: ["2026-10-06"], overlapCount: 1 },
    ])).toBe("'Ruta Norte' (lun 05/10, lun 12/10 y 3 más) · campaña 'Verano' (mar 06/10)");
  });
});
