/**
 * Tests for formRules.ts — evaluación de `showIf` (RulesJson) en la visita.
 */
import { describe, it, expect } from "vitest";
import { parseShowIf, answerValues, evaluateShowIf, isQuestionVisible } from "./formRules";

const rule = (operator: string, value?: string, questionId = 1) =>
  JSON.stringify({ showIf: { questionId, operator, value } });

describe("parseShowIf", () => {
  it("returns null for null/invalid/missing showIf", () => {
    expect(parseShowIf(null)).toBeNull();
    expect(parseShowIf("")).toBeNull();
    expect(parseShowIf("{not json")).toBeNull();
    expect(parseShowIf(JSON.stringify({ scale: { min: 1, max: 5 } }))).toBeNull();
    expect(parseShowIf(JSON.stringify({ showIf: { operator: "equals" } }))).toBeNull();
  });

  it("parses a valid rule", () => {
    expect(parseShowIf(rule("equals", "si", 7))).toEqual({ questionId: 7, operator: "equals", value: "si" });
  });
});

describe("answerValues", () => {
  it("normalizes every answer shape to the selected values", () => {
    expect(answerValues(undefined)).toEqual([]);
    expect(answerValues(null)).toEqual([]);
    expect(answerValues("")).toEqual([]);
    expect(answerValues("si")).toEqual(["si"]);           // radio / select / text
    expect(answerValues(3)).toEqual(["3"]);               // number / scale
    expect(answerValues(true)).toEqual(["true"]);
    expect(answerValues(["a", "b"])).toEqual(["a", "b"]); // checkbox
    expect(answerValues({ bold: 120, milenio: null })).toEqual(["bold", "milenio"]); // checkbox_price: keys
  });
});

describe("evaluateShowIf", () => {
  it("equals: string answer", () => {
    const r = { questionId: 1, operator: "equals" as const, value: "si" };
    expect(evaluateShowIf(r, "si")).toBe(true);
    expect(evaluateShowIf(r, "no")).toBe(false);
    expect(evaluateShowIf(r, undefined)).toBe(false);
  });

  it("equals: included in checkbox array / checkbox_price keys", () => {
    const r = { questionId: 1, operator: "equals" as const, value: "bold" };
    expect(evaluateShowIf(r, ["bold", "milenio"])).toBe(true);
    expect(evaluateShowIf(r, ["milenio"])).toBe(false);
    expect(evaluateShowIf(r, { bold: 100 })).toBe(true);
    expect(evaluateShowIf(r, { milenio: 100 })).toBe(false);
  });

  it("notEquals", () => {
    const r = { questionId: 1, operator: "notEquals" as const, value: "si" };
    expect(evaluateShowIf(r, "no")).toBe(true);
    expect(evaluateShowIf(r, "si")).toBe(false);
    expect(evaluateShowIf(r, undefined)).toBe(true);
    expect(evaluateShowIf(r, ["si", "no"])).toBe(false);
  });

  it("contains: substring on text, membership on arrays", () => {
    const r = { questionId: 1, operator: "contains" as const, value: "esp" };
    expect(evaluateShowIf(r, "Cigarrillos espert")).toBe(true);
    expect(evaluateShowIf(r, "otra cosa")).toBe(false);
    expect(evaluateShowIf(r, ["esp", "x"])).toBe(true);
    expect(evaluateShowIf(r, [])).toBe(false);
  });

  it("notEmpty / empty", () => {
    const ne = { questionId: 1, operator: "notEmpty" as const };
    const em = { questionId: 1, operator: "empty" as const };
    expect(evaluateShowIf(ne, "x")).toBe(true);
    expect(evaluateShowIf(ne, [])).toBe(false);
    expect(evaluateShowIf(ne, {})).toBe(false);
    expect(evaluateShowIf(ne, undefined)).toBe(false);
    expect(evaluateShowIf(em, undefined)).toBe(true);
    expect(evaluateShowIf(em, "")).toBe(true);
    expect(evaluateShowIf(em, "x")).toBe(false);
  });

  it("unknown operator → visible", () => {
    expect(evaluateShowIf({ questionId: 1, operator: "weird" as never }, undefined)).toBe(true);
  });
});

describe("isQuestionVisible", () => {
  it("question without rule is always visible", () => {
    expect(isQuestionVisible({ RulesJson: null }, {})).toBe(true);
    expect(isQuestionVisible({ RulesJson: "{bad" }, {})).toBe(true);
    expect(isQuestionVisible({}, {})).toBe(true);
  });

  it("La Plata: '¿Cuáles?' visible solo si '¿Tiene productos?' = si", () => {
    const q = { RulesJson: rule("equals", "si", 1) };
    expect(isQuestionVisible(q, {})).toBe(false);
    expect(isQuestionVisible(q, { 1: "no" })).toBe(false);
    expect(isQuestionVisible(q, { 1: "si" })).toBe(true);
  });

  it("depends on the referenced question, not on others", () => {
    const q = { RulesJson: rule("equals", "si", 3) };
    expect(isQuestionVisible(q, { 1: "si" })).toBe(false);
    expect(isQuestionVisible(q, { 3: "si" })).toBe(true);
  });
});
