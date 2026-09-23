import { describe, it, expect } from "vitest";
import type { KpiItem, TmrPdvRow, TmrRutaRow } from "@/lib/api";
import {
  DRILLS,
  aggregateRoutes,
  buildQuickWinIndex,
  censoAverage,
  faltan,
  faltanLabel,
  flattenPdvs,
  goalFor,
  isDrillKey,
  parsePeriod,
  pdvsForRoute,
  periodOptions,
  rankPdvs,
  rankRoutes,
  splitEligible,
  toneForGoal,
} from "./mi-gestion-utils";

function ruta(over: Partial<TmrRutaRow> = {}): TmrRutaRow {
  return {
    route_id: 1,
    nombre: "Ruta A",
    trade: "T",
    user_id: 5,
    zona: "Z",
    pdvs: 10,
    relevados: 8,
    buenos: 4,
    vis_pdvs_jul: 6,
    vis_plan: 6,
    planned_mes: 10,
    vende_sueltos: 5,
    con_canje: 2,
    con_promo: 3,
    con_material: 7,
    ef_jul: 60,
    cob_score_pct: 50,
    freq: "S",
    score_dist: {},
    completitud: 50,
    completitud_esp: 70,
    ...over,
  };
}

function pdv(over: Partial<TmrPdvRow> = {}): TmrPdvRow {
  return {
    id: 1,
    n: "Kiosco 1",
    loc: "La Plata",
    canal: "Kiosco",
    vis: 0,
    ha: false,
    at: [],
    vs: "No",
    score: null,
    pr: [],
    ruta: "Ruta A",
    route_id: 1,
    planned: true,
    canje: false,
    promo: false,
    material: false,
    sells_loose: false,
    ...over,
  };
}

function kpi(key: string, target: number): KpiItem {
  return { key, name: key, actual: 0, target, weight: 20, achieved: false, numerator: 0, denominator: 0, scopeApplied: "" };
}

describe("route metrics", () => {
  it("cobertura = buenos/pdvs (los sin relevar cuentan en contra, como el KPI oficial)", () => {
    expect(DRILLS.cobertura_skus.routeMetric(ruta())).toEqual({ num: 4, den: 10, pct: 40 });
  });

  it("efectividad = vis_plan/planned_mes", () => {
    expect(DRILLS.efectividad_visitas.routeMetric(ruta())).toEqual({ num: 6, den: 10, pct: 60 });
  });

  it("sueltos = con_canje/vende_sueltos", () => {
    expect(DRILLS.penetracion_sueltos.routeMetric(ruta())).toEqual({ num: 2, den: 5, pct: 40 });
  });

  it("pop y activaciones sobre pdvs", () => {
    expect(DRILLS.pop_colocado.routeMetric(ruta())).toEqual({ num: 7, den: 10, pct: 70 });
    expect(DRILLS.activaciones_promo.routeMetric(ruta())).toEqual({ num: 3, den: 10, pct: 30 });
  });

  it("censo usa completitud y deriva num = round(completitud*pdvs/100)", () => {
    expect(DRILLS.censo.routeMetric(ruta({ completitud: 55, pdvs: 10 }))).toEqual({ num: 6, den: 10, pct: 55 });
    expect(DRILLS.censo.routeMetric(ruta({ completitud: undefined, pdvs: 0 }))).toEqual({ num: 0, den: 0, pct: 0 });
  });

  it("den = 0 → pct 0 sin NaN", () => {
    expect(DRILLS.cobertura_skus.routeMetric(ruta({ pdvs: 0, relevados: 0, buenos: 0 })).pct).toBe(0);
  });
});

describe("goal / faltan", () => {
  it("goalFor toma el target del KPI si existe, si no el default", () => {
    expect(goalFor(DRILLS.cobertura_skus, [kpi("cobertura_skus", 75)])).toBe(75);
    expect(goalFor(DRILLS.cobertura_skus, [kpi("cobertura_skus", 0)])).toBe(80);
    expect(goalFor(DRILLS.efectividad_visitas, undefined)).toBe(90);
    expect(goalFor(DRILLS.censo, [])).toBe(80);
  });

  it("faltan = ceil(goal*den/100) - num, nunca negativo", () => {
    expect(faltan({ num: 4, den: 8, pct: 50 }, 80)).toBe(3); // ceil(6.4)=7 → 3
    expect(faltan({ num: 8, den: 10, pct: 80 }, 80)).toBe(0); // 0.8*10 exacto, no 9
    expect(faltan({ num: 9, den: 10, pct: 90 }, 80)).toBe(0);
    expect(faltan({ num: 0, den: 0, pct: 0 }, 80)).toBeNull();
  });

  it("faltanLabel", () => {
    expect(faltanLabel({ num: 0, den: 0, pct: 0 }, 80)).toBe("sin PDVs elegibles");
    expect(faltanLabel({ num: 7, den: 8, pct: 87.5 }, 80)).toBe("meta alcanzada");
    expect(faltanLabel({ num: 6, den: 8, pct: 75 }, 80)).toBe("faltan 1 PDV");
    expect(faltanLabel({ num: 4, den: 8, pct: 50 }, 80)).toBe("faltan 3 PDVs");
  });

  it("toneForGoal", () => {
    expect(toneForGoal(80, 80)).toBe("green");
    expect(toneForGoal(60, 80)).toBe("yellow");
    expect(toneForGoal(59.9, 80)).toBe("red");
  });
});

describe("rankRoutes / aggregate", () => {
  it("peor primero, den=0 al final, empate por nombre", () => {
    const rutas = [
      ruta({ nombre: "B", buenos: 8, pdvs: 10 }),
      ruta({ nombre: "Z", buenos: 0, pdvs: 0 }),
      ruta({ nombre: "A", buenos: 2, pdvs: 10 }),
      ruta({ nombre: "C", buenos: 2, pdvs: 10 }),
    ];
    const names = rankRoutes(rutas, DRILLS.cobertura_skus).map((r) => r.route.nombre);
    expect(names).toEqual(["A", "C", "B", "Z"]);
  });

  it("aggregateRoutes suma num/den", () => {
    const rutas = [ruta({ buenos: 4, pdvs: 8 }), ruta({ buenos: 6, pdvs: 12 })];
    expect(aggregateRoutes(rutas, DRILLS.cobertura_skus)).toEqual({ num: 10, den: 20, pct: 50 });
  });

  it("censoAverage pondera por pdvs", () => {
    const rutas = [ruta({ pdvs: 10, completitud: 100, completitud_esp: 50 }), ruta({ pdvs: 30, completitud: 20, completitud_esp: 10 })];
    const avg = censoAverage(rutas);
    expect(avg.total).toBe(40);
    expect(avg.espert).toBe(20);
    expect(avg.pdvs).toBe(40);
    expect(censoAverage([])).toEqual({ total: 0, espert: 0, pdvs: 0 });
  });
});

describe("pdvRank cobertura", () => {
  it("buenos no elegibles; gaps 1 < gaps 2 < no cuenta < sin relevar", () => {
    const qw = buildQuickWinIndex([
      { n: "G1", loc: "", canal: "", vis: 0, gaps: 1, missing: ["Milenio"], ruta: "Ruta A", trade: "", zona: "" },
      { n: "G2", loc: "", canal: "", vis: 0, gaps: 2, missing: ["Milenio", "Chicago"], ruta: "Ruta A", trade: "", zona: "" },
    ]);
    const list = [
      pdv({ n: "Bueno", score: "Bueno" }),
      pdv({ n: "Sin", score: null }),
      pdv({ n: "NC", score: "No cuenta" }),
      pdv({ n: "G2", score: "Regular" }),
      pdv({ n: "G1", score: "Regular" }),
    ];
    const ranked = rankPdvs(list, DRILLS.cobertura_skus, qw);
    expect(ranked.map((r) => r.pdv.n)).toEqual(["G1", "G2", "NC", "Sin", "Bueno"]);
    expect(ranked[0].rank.reason).toBe("Regular · le falta Milenio");
    expect(ranked[1].rank.reason).toBe("Regular · le faltan Milenio y Chicago");
    expect(ranked[2].rank.reason).toBe("No cuenta · relevar de nuevo");
    expect(ranked[3].rank.reason).toBe("Sin relevar");
    expect(ranked[4].rank).toEqual({ score: 99, reason: "Bueno ✓", eligible: false });
  });

  it("quick win de otra ruta con el mismo nombre no se mezcla", () => {
    const qw = buildQuickWinIndex([
      { n: "K", loc: "", canal: "", vis: 0, gaps: 1, missing: ["Milenio"], ruta: "Otra", trade: "", zona: "" },
    ]);
    const [r] = rankPdvs([pdv({ n: "K", score: "Regular", ruta: "Ruta A" })], DRILLS.cobertura_skus, qw);
    expect(r.rank.reason).toBe("Regular · lejos de Bueno");
  });
});

describe("pdvRank efectividad", () => {
  it("planificado sin visitar primero, visitado sin acción segundo, no planificado no aplica", () => {
    const list = [
      pdv({ n: "Done", planned: true, vis: 2, ha: true }),
      pdv({ n: "NoPlan", planned: false, vis: 0 }),
      pdv({ n: "VisNoAct", planned: true, vis: 1, ha: false }),
      pdv({ n: "Pend", planned: true, vis: 0 }),
    ];
    const ranked = rankPdvs(list, DRILLS.efectividad_visitas, new Map());
    expect(ranked.map((r) => `${r.pdv.n}:${r.rank.eligible ? 1 : 0}`)).toEqual(["Pend:1", "VisNoAct:1", "Done:0", "NoPlan:0"]);
    expect(ranked[0].rank.reason).toBe("Planificado, sin visitar");
    expect(ranked[1].rank.reason).toBe("Visitado, sin acción");
    expect(ranked[3].rank.reason).toBe("No planificado este mes");
  });
});

describe("pdvRank sueltos / pop / promo", () => {
  it("sueltos: solo vende-sin-canje es elegible; fallback a vs cuando falta sells_loose", () => {
    const d = DRILLS.penetracion_sueltos;
    expect(d.pdvRank(pdv({ sells_loose: true, canje: false }), {})).toEqual({ score: 0, reason: "Vende sueltos, sin canje", eligible: true });
    expect(d.pdvRank(pdv({ sells_loose: true, canje: true }), {}).reason).toBe("Con canje ✓");
    expect(d.pdvRank(pdv({ sells_loose: false }), {}).reason).toBe("No vende sueltos");
    expect(d.pdvRank(pdv({ sells_loose: undefined, vs: "Sí", canje: false }), {}).eligible).toBe(true);
    expect(d.pdvRank(pdv({ sells_loose: undefined, vs: "Sin dato" }), {}).eligible).toBe(false);
  });

  it("pop y promo por booleano", () => {
    expect(DRILLS.pop_colocado.pdvRank(pdv({ material: false }), {})).toEqual({ score: 0, reason: "Sin material POP", eligible: true });
    expect(DRILLS.pop_colocado.pdvRank(pdv({ material: true }), {}).eligible).toBe(false);
    expect(DRILLS.activaciones_promo.pdvRank(pdv({ promo: false }), {}).reason).toBe("Sin promo activada");
    expect(DRILLS.activaciones_promo.pdvRank(pdv({ promo: true }), {}).reason).toBe("Promo activada ✓");
  });

  it("censo: comp asc, completo no aplica", () => {
    const list = [
      pdv({ n: "Full", comp: 100, sin_dato: 0 }),
      pdv({ n: "Half", comp: 50, sin_dato: 3 }),
      pdv({ n: "Zero", comp: 0, sin_dato: 6 }),
    ];
    const ranked = rankPdvs(list, DRILLS.censo, new Map());
    expect(ranked.map((r) => r.pdv.n)).toEqual(["Zero", "Half", "Full"]);
    expect(ranked[0].rank.reason).toBe("Censo 0% · 6 Espert sin dato");
    expect(ranked[2].rank.eligible).toBe(false);
  });
});

describe("ordering within tier", () => {
  it("mismo tier: vis desc, luego nombre", () => {
    const list = [
      pdv({ n: "B", vis: 0 }),
      pdv({ n: "A", vis: 0 }),
      pdv({ n: "C", vis: 2 }),
    ];
    const ranked = rankPdvs(list, DRILLS.pop_colocado, new Map());
    expect(ranked.map((r) => r.pdv.n)).toEqual(["C", "A", "B"]);
    const { eligible, rest } = splitEligible(ranked);
    expect(eligible).toHaveLength(3);
    expect(rest).toHaveLength(0);
  });
});

describe("pdv selection", () => {
  it("flattenPdvs junta todos los trades; pdvsForRoute por id, fallback por nombre", () => {
    const all = flattenPdvs({
      tmr_pdvs: {
        T1: [pdv({ n: "A", route_id: 1, ruta: "Ruta A" }), pdv({ n: "B", route_id: 2, ruta: "Ruta B" })],
        T2: [pdv({ n: "C", route_id: undefined, ruta: "Ruta C" })],
      },
    });
    expect(all).toHaveLength(3);
    expect(pdvsForRoute(all, 2, "Ruta B").map((p) => p.n)).toEqual(["B"]);
    expect(pdvsForRoute(all, 3, "Ruta C").map((p) => p.n)).toEqual(["C"]);
    expect(pdvsForRoute(all, 9, "Nada")).toEqual([]);
    expect(flattenPdvs(null)).toEqual([]);
  });
});

describe("period", () => {
  it("opciones = actual y anterior, cruzando el año", () => {
    expect(periodOptions(new Date(2026, 0, 15))).toEqual([{ year: 2026, month: 1 }, { year: 2025, month: 12 }]);
  });

  it("parsePeriod acepta solo opciones válidas", () => {
    const now = new Date(2026, 8, 23);
    expect(parsePeriod("2026-8", now)).toEqual({ year: 2026, month: 8 });
    expect(parsePeriod("2026-09", now)).toEqual({ year: 2026, month: 9 });
    expect(parsePeriod("2025-1", now)).toEqual({ year: 2026, month: 9 });
    expect(parsePeriod(null, now)).toEqual({ year: 2026, month: 9 });
    expect(parsePeriod("garbage", now)).toEqual({ year: 2026, month: 9 });
  });

  it("isDrillKey", () => {
    expect(isDrillKey("censo")).toBe(true);
    expect(isDrillKey("cobertura_skus")).toBe(true);
    expect(isDrillKey("toString")).toBe(false);
    expect(isDrillKey(undefined)).toBe(false);
  });
});
