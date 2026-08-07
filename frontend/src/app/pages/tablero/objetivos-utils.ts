// Helpers compartidos por ObjetivosTab y sus subcomponentes (ABM de KPIs).
import { ApiError } from "@/lib/api";
import { levelLabel } from "./pdvs-utils";

// Niveles válidos para las reglas de scoring (kpi_engine.LEVELS) — distinto de los
// niveles calculados de PDV (que además incluyen no_cuenta/sin_relevar).
export const RULE_LEVELS = ["regular", "bueno", "muy_bueno", "excelente"] as const;
export type RuleLevel = (typeof RULE_LEVELS)[number];
export const ruleLevelLabel = levelLabel;

export interface Kpi422Detail {
  message: string;
  users: Array<{ userId: number; total: number }>;
}

/** Extrae el detail estructurado {message, users} de un 422 de /kpi/config (POST/DELETE).
 * Si el error no tiene esa forma (network error, 404, etc.) devuelve null y el caller
 * debe caer al mensaje genérico de `err.message`. */
export function parseKpi422(err: unknown): Kpi422Detail | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const data = err.data as { detail?: unknown } | null | undefined;
  const detail = data?.detail;
  if (detail && typeof detail === "object" && "users" in detail) {
    const d = detail as { message?: string; users?: Array<{ userId: number; total: number }> };
    return { message: d.message ?? "La suma de pesos resuelta no da 100%", users: d.users ?? [] };
  }
  return null;
}

export function scopeLabel(
  scopeType: string,
  scopeId: number | null,
  zoneNameById: Map<number, string>,
  userNameById: Map<number, string>
): string {
  if (scopeType === "global") return "Global";
  if (scopeType === "zone") return `Zona ${scopeId != null ? zoneNameById.get(scopeId) ?? `#${scopeId}` : "?"}`;
  if (scopeType === "user") return `Usuario ${scopeId != null ? userNameById.get(scopeId) ?? `#${scopeId}` : "?"}`;
  return scopeType;
}
