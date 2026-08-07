import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import type { WeeklyActivityDay } from "@/lib/api";

// Fila de un día dentro del acordeón semanal de Actividad: resumen (badge de
// conteo, rango horario, duración promedio) + detalle expandible de PDVs
// visitados ese día. "Efectiva" replica la regla de KPI 2 (cobertura + POP +
// ≥1 acción DONE, ver `_visit_is_effective` en kpi.py), no si fue planificada.
export function ActividadDayRow({ day }: { day: WeeklyActivityDay }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-muted/40 rounded-md px-2"
      >
        {expanded ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
        <span className="text-sm font-medium text-foreground w-24 shrink-0">{day.dayLabel}</span>
        <Badge variant="secondary" className="shrink-0">{day.count} visita{day.count === 1 ? "" : "s"}</Badge>
        <span className="text-xs text-muted-foreground shrink-0">
          {day.firstOpen} – {day.lastClose ?? "—"}
        </span>
        <span className="text-xs text-muted-foreground ml-auto shrink-0">
          {day.avgDurationMin != null ? `Prom. ${day.avgDurationMin} min` : "Sin duración"}
        </span>
      </button>

      {expanded && (
        <div className="overflow-x-auto pl-6 pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1.5 text-muted-foreground font-semibold">PDV</th>
                <th className="text-center py-1.5 text-muted-foreground font-semibold">Entrada</th>
                <th className="text-center py-1.5 text-muted-foreground font-semibold">Salida</th>
                <th className="text-center py-1.5 text-muted-foreground font-semibold">Estado</th>
                <th className="text-center py-1.5 text-muted-foreground font-semibold">Efectiva</th>
              </tr>
            </thead>
            <tbody>
              {day.visits.map((v, i) => (
                <tr key={`${v.pdvId}-${i}`} className="border-b border-border last:border-0">
                  <td className="py-2 font-medium text-foreground">{v.pdvName}</td>
                  <td className="py-2 text-center text-muted-foreground">{v.openedAt}</td>
                  <td className="py-2 text-center text-muted-foreground">{v.closedAt ?? "—"}</td>
                  <td className="py-2 text-center">
                    <Badge className={v.status === "CLOSED" ? "bg-green-600" : "bg-amber-500"}>
                      {v.status === "CLOSED" ? "Cerrada" : "Abierta"}
                    </Badge>
                  </td>
                  <td className="py-2 text-center">
                    <span title="Cumple cobertura + POP + acción">
                      {v.effective ? (
                        <CheckCircle2 size={16} className="inline text-green-600" />
                      ) : (
                        <XCircle size={16} className="inline text-gray-400" />
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
