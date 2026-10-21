/**
 * Reglas de formulario (RulesJson de FormQuestion).
 *
 * Hoy la única regla es `showIf`: la pregunta se muestra solo si la respuesta a
 * otra pregunta cumple una condición. La arma el editor (FormEditorPage) y la
 * evalúa la visita (SurveyForm / VisitSummaryPage). Una pregunta oculta nunca
 * es requerida ni se exige.
 */

export type ShowIfOperator = "equals" | "notEquals" | "contains" | "notEmpty" | "empty";

export interface ShowIfRule {
  questionId: number;
  operator: ShowIfOperator;
  value?: string;
}

/** Valor de respuesta tal como lo guarda SurveyForm: string (radio/select/text),
 *  number, boolean, string[] (checkbox) u objeto cuyas keys son los valores
 *  tildados (checkbox_price). */
export type AnswerValue = string | number | boolean | string[] | Record<string, unknown> | null | undefined;

export function parseShowIf(rulesJson: string | null | undefined): ShowIfRule | null {
  if (!rulesJson) return null;
  try {
    const parsed = JSON.parse(rulesJson) as { showIf?: Partial<ShowIfRule> } | null;
    const rule = parsed?.showIf;
    if (!rule || typeof rule.questionId !== "number" || !rule.operator) return null;
    return { questionId: rule.questionId, operator: rule.operator, value: rule.value };
  } catch {
    return null;
  }
}

/** Normaliza cualquier respuesta a la lista de valores "seleccionados". */
export function answerValues(value: AnswerValue): string[] {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "object") return Object.keys(value);
  return [String(value)];
}

export function evaluateShowIf(rule: ShowIfRule, value: AnswerValue): boolean {
  const vals = answerValues(value);
  const expected = rule.value ?? "";
  switch (rule.operator) {
    case "equals":
      return vals.includes(expected);
    case "notEquals":
      return !vals.includes(expected);
    case "contains":
      return vals.some((v) => v === expected || v.includes(expected));
    case "notEmpty":
      return vals.length > 0;
    case "empty":
      return vals.length === 0;
    default:
      return true;
  }
}

/** Visible = sin regla, regla inválida, o regla que se cumple con las respuestas actuales. */
export function isQuestionVisible(
  question: { RulesJson?: string | null },
  answers: Record<number, AnswerValue>,
): boolean {
  const rule = parseShowIf(question.RulesJson);
  if (!rule) return true;
  return evaluateShowIf(rule, answers[rule.questionId]);
}
