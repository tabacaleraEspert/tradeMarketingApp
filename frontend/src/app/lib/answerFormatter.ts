import type { VisitAnswer } from "@/lib/api";

/**
 * Format a numeric answer value, stripping trailing zeros from decimals.
 * 5.0000 → "5"
 * 5.5000 → "5,5"
 * 0.1230 → "0,123"
 */
export function formatAnswerNumber(n: number): string {
  if (!isFinite(n)) return String(n);
  // Round to 2 decimals max, then strip trailing zeros
  const rounded = Math.round(n * 100) / 100;
  const str = String(rounded);
  return str.replace(".", ",");
}

/**
 * Try to parse a JSON string and render it as a human-readable list.
 * Returns null if it can't be parsed as a meaningful structure.
 */
export function formatJsonValue(json: string): string | null {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return "—";
      return parsed
        .map((item) => {
          if (item == null) return "—";
          if (typeof item === "string") return item;
          if (typeof item === "number") return formatAnswerNumber(item);
          if (typeof item === "boolean") return item ? "Sí" : "No";
          if (typeof item === "object") {
            // {label, value} or {name} pattern
            const obj = item as Record<string, unknown>;
            return String(obj.label ?? obj.name ?? obj.value ?? JSON.stringify(item));
          }
          return String(item);
        })
        .join(", ");
    }
    if (typeof parsed === "object" && parsed !== null) {
      // Check if it's a coverage-type object: { key: { covered, price, stockout } }
      const entries = Object.entries(parsed);
      const isCoverage = entries.length > 0 && entries.every(
        ([, v]) => typeof v === "object" && v !== null && "covered" in (v as Record<string, unknown>)
      );
      if (isCoverage) {
        const working = entries.filter(([, v]) => (v as { covered: boolean }).covered);
        if (working.length === 0) return "Ninguno trabaja";
        return working
          .map(([k, v]) => {
            const item = v as { covered: boolean; price?: number | null; stockout?: boolean };
            const name = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            let text = name;
            if (item.price != null) text += ` $${item.price}`;
            if (item.stockout) text += " (quiebre)";
            return text;
          })
          .join(", ");
      }
      // Check if it's a checkbox_price object: { key: number | null }
      const isCheckboxPrice = entries.length > 0 && entries.every(
        ([, v]) => v === null || typeof v === "number"
      );
      if (isCheckboxPrice) {
        return entries
          .map(([k, v]) => {
            const name = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            return v != null ? `${name} $${v}` : name;
          })
          .join(", ");
      }
      // Generic object: "key: value" pairs
      return Object.entries(parsed)
        .map(([k, v]) => {
          if (typeof v === "object" && v !== null) return `${k}: ${JSON.stringify(v)}`;
          return `${k}: ${v}`;
        })
        .join(" · ");
    }
    if (typeof parsed === "number") return formatAnswerNumber(parsed);
    if (typeof parsed === "boolean") return parsed ? "Sí" : "No";
    return String(parsed);
  } catch {
    return null;
  }
}

/**
 * Render a VisitAnswer's value as a clean human-readable string.
 * Handles bool / number / text / JSON arrays / option references.
 */
export function renderAnswerValue(a: VisitAnswer): string {
  if (a.ValueBool !== null && a.ValueBool !== undefined) {
    return a.ValueBool ? "Sí" : "No";
  }
  if (a.ValueNumber !== null && a.ValueNumber !== undefined) {
    return formatAnswerNumber(Number(a.ValueNumber));
  }
  if (a.ValueText) {
    // ValueText sometimes holds a stringified JSON array (e.g. multi-select)
    if (a.ValueText.trim().startsWith("[") || a.ValueText.trim().startsWith("{")) {
      const formatted = formatJsonValue(a.ValueText);
      if (formatted) return formatted;
    }
    return a.ValueText;
  }
  if (a.ValueJson) {
    const formatted = formatJsonValue(a.ValueJson);
    if (formatted) return formatted;
    return a.ValueJson;
  }
  return "—";
}
