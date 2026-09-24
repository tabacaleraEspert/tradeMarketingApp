/** Labels y colores de las alertas de comportamiento (mismos tipos que el backend). */
import type { IntelBehaviorAlertTipo, IntelBehaviorSeveridad } from "@/lib/api";

export const ALERT_LABELS: Record<IntelBehaviorAlertTipo, string> = {
  sin_gps: "Sin GPS",
  fuera_perimetro: "Fuera de perímetro",
  visita_corta: "Visita corta",
  visita_abierta: "Visita abierta",
  plan_sin_visitas: "Plan sin visitas",
  plan_no_visitado: "Planificado no visitado",
  orden_distinto: "Orden distinto",
  on_tarde: "ON tarde",
  off_temprano: "OFF temprano",
  bateria_baja: "Batería baja",
};

export const ALERT_ORDER: IntelBehaviorAlertTipo[] = [
  "sin_gps",
  "fuera_perimetro",
  "visita_corta",
  "visita_abierta",
  "plan_sin_visitas",
  "plan_no_visitado",
  "orden_distinto",
  "on_tarde",
  "off_temprano",
  "bateria_baja",
];

export const SEVERITY_CLASS: Record<IntelBehaviorSeveridad, string> = {
  alta: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  media: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  baja: "bg-muted text-muted-foreground",
};

export const SEVERITY_ORDER: IntelBehaviorSeveridad[] = ["alta", "media", "baja"];

export function alertLabel(tipo: string): string {
  return ALERT_LABELS[tipo as IntelBehaviorAlertTipo] ?? tipo;
}

/** Severidad de un tipo (la más alta vista en la lista; default baja). */
export function severityFor(tipo: string, alertas: Array<{ tipo: string; severidad: IntelBehaviorSeveridad }>): IntelBehaviorSeveridad {
  let best: IntelBehaviorSeveridad = "baja";
  for (const a of alertas) {
    if (a.tipo !== tipo) continue;
    if (SEVERITY_ORDER.indexOf(a.severidad) < SEVERITY_ORDER.indexOf(best)) best = a.severidad;
  }
  return best;
}

/** Colores de semáforo para tiles (verde ≥ ok, ámbar ≥ warn, rojo). */
export function semaforo(v: number | null | undefined, ok: number, warn: number, higherIsBetter = true): string {
  if (v == null || Number.isNaN(v)) return "text-foreground";
  const good = higherIsBetter ? v >= ok : v <= ok;
  const mid = higherIsBetter ? v >= warn : v <= warn;
  if (good) return "text-green-600 dark:text-green-400";
  if (mid) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}
