import { describe, expect, it } from "vitest";
import type { BoardDay, BoardRep, BoardRoute } from "@/lib/api/routeBoard";
import {
  addDaysISO,
  filterAndGroupReps,
  groupByCell,
  cellKey,
  mondayOf,
  overlapText,
  planMove,
  routesForDate,
  sameWeek,
  weekColumns,
  weekLabel,
} from "./boardUtils";

const day = (over: Partial<BoardDay>): BoardDay => ({
  routeDayId: 1,
  routeId: 1,
  routeName: "Ruta",
  routeType: "regular",
  workDate: "2026-11-23",
  userId: 10,
  status: "PLANNED",
  pdvCount: 5,
  doneCount: 0,
  hasVisits: false,
  locked: false,
  ...over,
});

const rep = (over: Partial<BoardRep>): BoardRep => ({
  userId: 1,
  name: "Trade",
  zoneId: null,
  zoneName: null,
  managerId: null,
  managerName: null,
  role: "vendedor",
  isActive: true,
  ...over,
});

describe("semana", () => {
  it("mondayOf: lunes de la semana lun–dom", () => {
    expect(mondayOf("2026-11-19")).toBe("2026-11-16"); // jueves
    expect(mondayOf("2026-11-16")).toBe("2026-11-16"); // lunes
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // domingo
    expect(sameWeek("2026-11-16", "2026-11-22")).toBe(true);
    expect(sameWeek("2026-11-22", "2026-11-23")).toBe(false);
  });

  it("weekColumns: lun a sáb, y domingo solo si tiene días", () => {
    expect(weekColumns("2026-11-23", [])).toEqual([
      "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28",
    ]);
    expect(weekColumns("2026-11-23", [{ workDate: "2026-11-29" }])).toHaveLength(7);
  });

  it("weekLabel y cruce de mes / año", () => {
    expect(weekLabel("2026-11-23", "2026-11-28")).toBe("23 – 28 nov 2026");
    expect(weekLabel("2026-11-30", "2026-12-05")).toBe("30 nov – 5 dic 2026");
    expect(addDaysISO("2026-12-28", 7)).toBe("2027-01-04");
  });
});

describe("celdas y solapamientos", () => {
  it("agrupa por trade + fecha y avisa con 2 o más rutas", () => {
    const cells = groupByCell([
      day({ routeDayId: 1, routeName: "Zeta" }),
      day({ routeDayId: 2, routeName: "Alfa" }),
      day({ routeDayId: 3, userId: 11 }),
      day({ routeDayId: 4, workDate: "2026-11-24" }),
    ]);
    const cell = cells.get(cellKey(10, "2026-11-23"))!;
    expect(cell.map((d) => d.routeName)).toEqual(["Alfa", "Zeta"]);
    expect(overlapText(cell)).toBe("2 rutas el mismo día: Alfa · Zeta");
    expect(overlapText(cells.get(cellKey(11, "2026-11-23"))!)).toBeNull();
  });
});

describe("filterAndGroupReps", () => {
  const reps = [
    rep({ userId: 1, name: "Zoe", managerId: 5, managerName: "Nahuel", zoneName: "AMBA" }),
    rep({ userId: 2, name: "Ángel", managerId: 5, managerName: "Nahuel", zoneName: "Cuyo" }),
    rep({ userId: 3, name: "Bruno", managerId: 6, managerName: "Franco", zoneName: "AMBA" }),
    rep({ userId: 4, name: "Suelto" }),
  ];

  it("agrupa por responsable, ordena y deja 'Sin responsable' al final", () => {
    const g = filterAndGroupReps(reps, {});
    expect(g.map((x) => x.label)).toEqual(["Equipo de Franco", "Equipo de Nahuel", "Sin responsable"]);
    expect(g[1].reps.map((r) => r.name)).toEqual(["Ángel", "Zoe"]);
  });

  it("filtra por nombre (sin tildes), zona y 'solo con días'", () => {
    expect(filterAndGroupReps(reps, { search: "angel" }).flatMap((g) => g.reps.map((r) => r.userId))).toEqual([2]);
    expect(filterAndGroupReps(reps, { zone: "AMBA" }).flatMap((g) => g.reps.map((r) => r.userId))).toEqual([3, 1]);
    expect(
      filterAndGroupReps(reps, { onlyWithDays: true, repsWithDays: new Set([4]) }).flatMap((g) => g.reps.map((r) => r.userId)),
    ).toEqual([4]);
    // Buscar por el responsable trae a su equipo.
    expect(filterAndGroupReps(reps, { search: "nahuel" })[0].reps).toHaveLength(2);
  });
});

describe("planMove", () => {
  const weekly = { frequencyType: "weekly", frequencyConfig: JSON.stringify({ day: 1 }), assignedUserId: 10 };
  const monday = day({ workDate: "2026-11-23" });

  it("semanal, otro día de la misma semana: ofrece toda la ruta", () => {
    const p = planMove(monday, weekly, "2026-11-26", 10);
    expect(p).toMatchObject({ dateChanged: true, repChanged: false, dayOnly: true, wholeRoute: true, wholeRouteReason: null });
  });

  it("otro trade: solo toda la ruta (prestar un día no está disponible)", () => {
    const monthly = { frequencyType: "monthly", frequencyConfig: null, assignedUserId: 10 };
    const p = planMove(monday, monthly, "2026-11-23", 11);
    expect(p).toMatchObject({ dateChanged: false, repChanged: true, dayOnly: false, wholeRoute: true });
    expect(p.dayOnlyReason).toMatch(/todavía no está disponible/);
    // Otro trade + otro día de la misma semana, ruta semanal: toda la ruta (una sola operación).
    expect(planMove(monday, weekly, "2026-11-26", 11)).toMatchObject({ dayOnly: false, wholeRoute: true });
    // Otro trade + otro día, sin día fijo: no hay nada para ofrecer.
    expect(planMove(monday, monthly, "2026-11-24", 11)).toMatchObject({ dayOnly: false, wholeRoute: false });
    expect(planMove(monday, undefined, "2026-11-23", 11)).toMatchObject({ dayOnly: false });
  });

  it("devolver un día al dueño de la ruta: solo este día", () => {
    const lent = day({ workDate: "2026-11-23", userId: 11 }); // la ruta es de 10
    const p = planMove(lent, weekly, "2026-11-23", 10);
    expect(p).toMatchObject({ repChanged: true, dayOnly: true, wholeRoute: false });
    expect(p.wholeRouteReason).toMatch(/ya es de ese trade/);
  });

  it("frecuencia sin día de semana, otra semana o día que no es el de la frecuencia: solo este día", () => {
    expect(planMove(monday, { frequencyType: "monthly", frequencyConfig: null, assignedUserId: 10 }, "2026-11-24", 10)).toMatchObject({ dayOnly: true, wholeRoute: false });
    expect(planMove(monday, { frequencyType: null, frequencyConfig: null, assignedUserId: 10 }, "2026-11-24", 10).wholeRoute).toBe(false);
    expect(planMove(monday, undefined, "2026-11-24", 11).wholeRoute).toBe(false);
    expect(planMove(monday, weekly, "2026-12-01", 10).wholeRoute).toBe(false);
    const tuesday = day({ workDate: "2026-11-24" }); // cargado a mano
    expect(planMove(tuesday, weekly, "2026-11-26", 10).wholeRouteReason).toMatch(/martes/);
  });

  it("días específicos: el origen debe estar y el destino no", () => {
    const spec = { frequencyType: "specific_days", frequencyConfig: JSON.stringify({ days: [1, 3] }), assignedUserId: 10 };
    expect(planMove(monday, spec, "2026-11-27", 10).wholeRoute).toBe(true);
    expect(planMove(monday, spec, "2026-11-25", 10).wholeRouteReason).toMatch(/miércoles/);
  });

  it("sin cambios no ofrece nada", () => {
    expect(planMove(monday, weekly, "2026-11-23", 10)).toMatchObject({ dateChanged: false, repChanged: false, dayOnly: false, wholeRoute: false });
  });
});

describe("routesForDate", () => {
  it("solo vigentes y que no vencen antes de la fecha", () => {
    const r = (over: Partial<BoardRoute>): BoardRoute => ({
      routeId: 1, name: "R", routeType: "regular", assignedUserId: 1, zoneId: null,
      frequencyType: null, frequencyConfig: null, endDate: null, pdvCount: 0, isLive: true, ...over,
    });
    const out = routesForDate(
      [r({ routeId: 1 }), r({ routeId: 2, isLive: false }), r({ routeId: 3, endDate: "2026-11-22" }), r({ routeId: 4, endDate: "2026-11-23" })],
      "2026-11-23",
    );
    expect(out.map((x) => x.routeId)).toEqual([1, 4]);
  });
});
