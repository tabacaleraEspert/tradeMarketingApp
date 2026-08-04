// Helpers compartidos por PdvsTab y sus subcomponentes (niveles de calificación de PDV).

export type ScoreLevel = "excelente" | "muy_bueno" | "bueno" | "regular" | "no_cuenta" | "sin_relevar";

export const LEVEL_ORDER: ScoreLevel[] = ["excelente", "muy_bueno", "bueno", "regular", "no_cuenta", "sin_relevar"];

export const LEVEL_LABELS: Record<string, string> = {
  excelente: "Excelente",
  muy_bueno: "Muy bueno",
  bueno: "Bueno",
  regular: "Regular",
  no_cuenta: "No cuenta",
  sin_relevar: "Sin relevar",
};

export function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level;
}

export const LEVEL_STYLES: Record<string, { pillBg: string; pillText: string; hex: string }> = {
  excelente: { pillBg: "bg-teal-100", pillText: "text-teal-700", hex: "#0d9488" },
  muy_bueno: { pillBg: "bg-emerald-100", pillText: "text-emerald-700", hex: "#059669" },
  bueno: { pillBg: "bg-green-100", pillText: "text-green-700", hex: "#16a34a" },
  regular: { pillBg: "bg-amber-100", pillText: "text-amber-700", hex: "#d97706" },
  no_cuenta: { pillBg: "bg-red-100", pillText: "text-red-700", hex: "#dc2626" },
  sin_relevar: { pillBg: "bg-gray-100", pillText: "text-gray-600", hex: "#9ca3af" },
};

export function levelStyle(level: string) {
  return LEVEL_STYLES[level] ?? LEVEL_STYLES.sin_relevar;
}
