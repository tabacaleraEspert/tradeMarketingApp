// Helpers compartidos por ResumenTab y sus subcomponentes (anillo, tarjetas KPI).
import type { KpiVariableRow } from "@/lib/api";

// Sentinel para el grupo "Sin territorio asignado" (managerUserId null en el KPI row).
// Los ids reales de manager son positivos, así que -1 no colisiona.
export const NO_MANAGER_ID = -1;

export interface TerritoryGroup {
  managerId: number;
  managerName: string;
  vendors: KpiVariableRow[];
  avg: number;
  highCount: number;
  lowCount: number;
}

// Agrupa las filas de /kpi/variable por managerUserId para el nivel General del tablero.
export function groupByTerritory(rows: KpiVariableRow[]): TerritoryGroup[] {
  const map = new Map<number, KpiVariableRow[]>();
  for (const r of rows) {
    const key = r.managerUserId ?? NO_MANAGER_ID;
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }

  const groups: TerritoryGroup[] = [];
  for (const [managerId, vendors] of map) {
    const avg = vendors.length ? vendors.reduce((s, v) => s + v.variableTotal, 0) / vendors.length : 0;
    const highCount = vendors.filter((v) => v.variableTotal >= 80).length;
    const lowCount = vendors.filter((v) => v.variableTotal < 50).length;
    const managerName =
      managerId === NO_MANAGER_ID
        ? "Sin territorio asignado"
        : vendors.find((v) => v.managerName)?.managerName ?? `Territorio #${managerId}`;
    groups.push({ managerId, managerName, vendors, avg, highCount, lowCount });
  }

  groups.sort((a, b) => {
    if (a.managerId === NO_MANAGER_ID) return 1;
    if (b.managerId === NO_MANAGER_ID) return -1;
    return a.managerName.localeCompare(b.managerName);
  });
  return groups;
}

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
