/** Export CSV del período: una fila por día con métricas + conteo de alertas. */
import type { IntelBehaviorDia, IntelBehaviorResponse } from "@/lib/api";
import { ALERT_ORDER, ALERT_LABELS } from "./alert-meta";
import { hhmm } from "./range-utils";

function esc(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const num = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? "" : v.toFixed(digits).replace(".", ",");

export function countAlerts(alertas: Array<{ tipo: string }>): Record<string, number> {
  const c: Record<string, number> = {};
  for (const a of alertas) c[a.tipo] = (c[a.tipo] ?? 0) + 1;
  return c;
}

/** Filas del CSV (header + días). `roadKm` por fecha si se calcularon. */
export function behaviorCsvRows(
  data: Pick<IntelBehaviorResponse, "dias">,
  roadKm: Record<string, number | undefined> = {}
): string[][] {
  const header = [
    "Fecha",
    "Día",
    "ON",
    "Fuente ON",
    "OFF",
    "Fuente OFF",
    "Activo (min)",
    "Visitas",
    "PDVs",
    "Planificados",
    "Plan visitados",
    "Orden respetado",
    "Km línea recta",
    "Km ruta",
    "GPS %",
    "Sin GPS",
    "Fuera perímetro",
    "Cortas",
    "Abiertas",
    "Batería inicio",
    "Batería fin",
    ...ALERT_ORDER.map((t) => `Alerta: ${ALERT_LABELS[t]}`),
  ];
  const rows = data.dias.map((d: IntelBehaviorDia) => {
    const counts = countAlerts(d.alertas);
    return [
      d.fecha,
      d.diaLabel,
      d.on ? hhmm(d.on) : "",
      d.onSource ?? "",
      d.off ? hhmm(d.off) : "",
      d.offSource ?? "",
      d.activoMin == null ? "" : String(Math.round(d.activoMin)),
      String(d.visitas),
      String(d.pdvs),
      String(d.planificados),
      String(d.planVisitados),
      d.ordenRespetado == null ? "" : d.ordenRespetado ? "sí" : "no",
      num(d.kmLinea),
      num(roadKm[d.fecha]),
      String(Math.round(d.gpsPct)),
      String(d.sinGps),
      String(d.fueraPerimetro),
      String(d.cortas),
      String(d.abiertas),
      d.bateriaInicio == null ? "" : String(d.bateriaInicio),
      d.bateriaFin == null ? "" : String(d.bateriaFin),
      ...ALERT_ORDER.map((t) => String(counts[t] ?? 0)),
    ];
  });
  return [header, ...rows];
}

/** Serializa con `;` (Excel es-AR) y BOM para acentos. */
export function toCsv(rows: string[][]): string {
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
}

export function csvFilename(userName: string, from: string, to: string): string {
  const safe = userName.trim().replace(/\s+/g, "_").replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]/g, "");
  return `comportamiento_${safe || "trade"}_${from}_${to}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
