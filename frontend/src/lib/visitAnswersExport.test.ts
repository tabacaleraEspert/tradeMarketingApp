import { describe, expect, it } from "vitest";
import { buildAnswerSheets, type AnswersExport, type AnswerValue } from "./visitAnswersExport";

const ans = (p: Partial<AnswerValue>): AnswerValue => ({ QType: "text", ValueText: null, ValueNumber: null, ValueBool: null, ValueJson: null, ...p });
const num = (n: number) => ans({ QType: "number", ValueNumber: n });
const q = (key: string, Label: string, QType: string, SortOrder: number, Options: Record<string, string> = {}) =>
  ({ key, FormId: 22, FormName: "Activación", Label, QType, SortOrder, Options });
const visit = (VisitId: number, UserId: number, UserName: string, OpenedAt: string, answers: Record<string, AnswerValue>) => ({
  VisitId, UserId, UserName, Status: "CLOSED", OpenedAt, ClosedAt: OpenedAt, PdvName: `PDV ${VisitId}`, PdvAddress: "Calle 1", answers,
});

const data: AnswersExport = {
  truncated: false,
  questions: [
    q("22:act", "Activó", "radio", 1, { si: "Sí", no: "No" }),
    q("22:atados", "Atados", "number", 2),
    q("22:marca", "Marca", "select", 3, { milenio: "Milenio Vid", bold: "Bold" }),
    q("22:nunca", "Sin respuestas", "text", 4),
    q("22:promo", "Promo", "checkbox", 5, { pb: "Promo Bold", pm: "Promo Milenio" }),
    q("22:foto", "Foto", "photo", 6),
  ],
  visits: [
    visit(1, 144, "Activador U", "2026-11-11T15:00:00Z", {
      "22:act": ans({ ValueText: "si" }), "22:atados": num(4), "22:marca": ans({ ValueText: "milenio" }),
      "22:promo": ans({ ValueJson: '["pb","pm"]' }), "22:foto": ans({ QType: "photo", ValueNumber: 1 }),
    }),
    visit(2, 144, "Activador U", "2026-11-11T16:00:00Z", { "22:act": ans({ ValueText: "no" }) }),
    visit(3, 144, "Activador U", "2026-11-10T16:00:00Z", { "22:act": ans({ ValueBool: true }), "22:atados": num(6) }),
    visit(4, 145, "Activador D", "2026-11-11T14:00:00Z", {
      "22:act": ans({ ValueText: "si" }), "22:atados": num(2), "22:promo": ans({ ValueJson: '["pb"]' }),
    }),
  ],
};

describe("buildAnswerSheets", () => {
  it("arma detalle por visita y resúmenes por vendedor y por día", () => {
    const [detail, byUser, byDay] = buildAnswerSheets(data);
    expect(detail.data).toHaveLength(4);
    expect(detail.data[0]).toMatchObject({
      Vendedor: "Activador U", PDV: "PDV 1", Fecha: "11/11/2026", Hora: "12:00", Estado: "Cerrada",
      "Activó": "Sí", Atados: 4, Marca: "Milenio Vid", Promo: "Promo Bold, Promo Milenio", Foto: "1",
    });
    expect(detail.data[1].Atados).toBe("");
    expect(Object.keys(detail.data[0])).not.toContain("Sin respuestas");

    // La foto (número guardado) no se suma; las opciones nunca elegidas (Bold) no generan columna.
    expect(byUser.data).toEqual([
      { Vendedor: "Activador D", Visitas: 1, PDVs: 1, Atados: 2, "Activó (Sí)": 1, "Marca: Milenio Vid": 0, "Promo: Promo Bold": 1, "Promo: Promo Milenio": 0 },
      { Vendedor: "Activador U", Visitas: 3, PDVs: 3, Atados: 10, "Activó (Sí)": 2, "Marca: Milenio Vid": 1, "Promo: Promo Bold": 1, "Promo: Promo Milenio": 1 },
    ]);
    expect(byDay.data.map((r) => [r.Vendedor, r.Fecha, r.Visitas, r.Atados, r["Activó (Sí)"], r["Promo: Promo Bold"]])).toEqual([
      ["Activador U", "11/11/2026", 2, 4, 1, 1],
      ["Activador U", "10/11/2026", 1, 6, 1, 0],
      ["Activador D", "11/11/2026", 1, 2, 1, 1],
    ]);
  });

  it("aplica la búsqueda de la pantalla y devuelve vacío sin visitas", () => {
    expect(buildAnswerSheets(data, "activador d")[0].data).toHaveLength(1);
    expect(buildAnswerSheets(data, "zzz")).toEqual([]);
  });
});
