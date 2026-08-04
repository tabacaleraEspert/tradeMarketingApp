// Helpers compartidos por ResumenTab y sus subcomponentes (anillo, tarjetas KPI).

export function formatPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export type Tone = "green" | "amber" | "red";

// Semáforo de cumplimiento: verde >=80, amarillo >=50, rojo <50.
export function toneFor(pct: number): Tone {
  if (pct >= 80) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

export const toneClasses: Record<Tone, { text: string; bar: string; stroke: string; pillBg: string; pillText: string }> = {
  green: { text: "text-green-600", bar: "bg-green-500", stroke: "#16a34a", pillBg: "bg-green-100", pillText: "text-green-700" },
  amber: { text: "text-amber-600", bar: "bg-amber-500", stroke: "#d97706", pillBg: "bg-amber-100", pillText: "text-amber-700" },
  red: { text: "text-red-600", bar: "bg-red-500", stroke: "#dc2626", pillBg: "bg-red-100", pillText: "text-red-700" },
};
