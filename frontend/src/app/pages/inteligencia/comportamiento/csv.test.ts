import { describe, it, expect } from "vitest";
import { behaviorCsvRows, countAlerts, csvFilename, toCsv } from "./csv";
import type { IntelBehaviorDia } from "@/lib/api";

function dia(over: Partial<IntelBehaviorDia> = {}): IntelBehaviorDia {
  return {
    fecha: "2026-09-24",
    diaLabel: "jue 24 sep",
    on: "2026-09-24T11:30:00Z",
    onSource: "gps",
    off: "2026-09-24T20:00:00Z",
    offSource: "visit",
    activoMin: 510,
    visitas: 12,
    pdvs: 11,
    planificados: 14,
    planVisitados: 10,
    ordenRespetado: false,
    kmLinea: 23.456,
    gpsPct: 91.7,
    sinGps: 1,
    fueraPerimetro: 2,
    cortas: 0,
    abiertas: 0,
    bateriaInicio: 95,
    bateriaFin: 40,
    alertas: [
      { tipo: "sin_gps", severidad: "media", fecha: "2026-09-24", visitId: 1, pdvId: 1, pdvName: "A", detalle: "" },
      { tipo: "fuera_perimetro", severidad: "alta", fecha: "2026-09-24", visitId: 2, pdvId: 2, pdvName: "B", detalle: "" },
      { tipo: "fuera_perimetro", severidad: "alta", fecha: "2026-09-24", visitId: 3, pdvId: 3, pdvName: "C", detalle: "" },
    ],
    puntos: [],
    secuencia: [],
    planNoVisitados: [],
    ...over,
  };
}

describe("csv", () => {
  it("countAlerts agrupa por tipo", () => {
    expect(countAlerts(dia().alertas)).toEqual({ sin_gps: 1, fuera_perimetro: 2 });
  });

  it("una fila por día con horas AR, km con coma y conteos de alertas", () => {
    const rows = behaviorCsvRows({ dias: [dia()] }, { "2026-09-24": 31.2 });
    expect(rows).toHaveLength(2);
    const [h, r] = rows;
    expect(r[h.indexOf("ON")]).toBe("08:30");
    expect(r[h.indexOf("OFF")]).toBe("17:00");
    expect(r[h.indexOf("Km línea recta")]).toBe("23,5");
    expect(r[h.indexOf("Km ruta")]).toBe("31,2");
    expect(r[h.indexOf("Alerta: Fuera de perímetro")]).toBe("2");
    expect(r[h.indexOf("Alerta: Batería baja")]).toBe("0");
    expect(r[h.indexOf("Orden respetado")]).toBe("no");
  });

  it("sin km ruta deja la celda vacía", () => {
    const [h, r] = behaviorCsvRows({ dias: [dia()] });
    expect(r[h.indexOf("Km ruta")]).toBe("");
  });

  it("toCsv usa ; y BOM, y escapa comillas/separadores", () => {
    const csv = toCsv([["a", 'b "x"', "c;d"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1)).toBe('a;"b ""x""";"c;d"');
  });

  it("csvFilename normaliza el nombre", () => {
    expect(csvFilename("Juan Pérez", "2026-09-01", "2026-09-24")).toBe("comportamiento_Juan_Pérez_2026-09-01_2026-09-24.csv");
  });
});
