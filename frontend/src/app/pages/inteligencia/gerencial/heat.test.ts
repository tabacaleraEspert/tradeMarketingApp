import { describe, expect, it } from "vitest";
import { terciles } from "./heat";

describe("terciles", () => {
  it("reparte en tercio superior, medio e inferior", () => {
    expect(terciles([10, 20, 30])).toEqual(["bajo", "medio", "alto"]);
    expect(terciles([60, 10, 50, 20, 40, 30])).toEqual(["alto", "bajo", "alto", "bajo", "medio", "medio"]);
  });

  it("no depende del orden de entrada", () => {
    expect(terciles([30, 10, 20])).toEqual(["alto", "bajo", "medio"]);
  });

  it("los empates comparten banda", () => {
    const r = terciles([5, 5, 5, 9, 1, 1]);
    expect(r[0]).toBe(r[1]);
    expect(r[1]).toBe(r[2]);
    expect(r[4]).toBe(r[5]);
    expect(r[3]).toBe("alto");
    expect(r[4]).toBe("bajo");
  });

  it("si todos empatan, todos quedan en el medio", () => {
    expect(terciles([7, 7, 7, 7])).toEqual(["medio", "medio", "medio", "medio"]);
  });

  it("los null quedan en null y no cuentan para el reparto", () => {
    expect(terciles([null, 10, 20, null, 30])).toEqual([null, "bajo", "medio", null, "alto"]);
  });

  it("invert: el más bajo es el mejor", () => {
    expect(terciles([10, 20, 30], { invert: true })).toEqual(["alto", "medio", "bajo"]);
    expect(terciles([null, 3, 1, 2], { invert: true })).toEqual([null, "bajo", "alto", "medio"]);
  });

  it("con menos de 3 valores no nulos no colorea nada", () => {
    expect(terciles([])).toEqual([]);
    expect(terciles([50])).toEqual([null]);
    expect(terciles([10, 90])).toEqual([null, null]);
    expect(terciles([10, null, 90, null])).toEqual([null, null, null, null]);
  });
});
