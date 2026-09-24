/**
 * "Alertas de comportamiento" del período: chips con conteo por tipo (color
 * por severidad) + lista colapsable de las alertas (fecha, PDV, detalle).
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import type { IntelBehaviorAlerta } from "@/lib/api";
import { ALERT_ORDER, SEVERITY_CLASS, alertLabel, severityFor } from "./alert-meta";
import { countAlerts } from "./csv";
import { shortDate } from "./range-utils";

export function AlertasCard({ alertas }: { alertas: IntelBehaviorAlerta[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const counts = useMemo(() => countAlerts(alertas), [alertas]);
  const tipos = ALERT_ORDER.filter((t) => counts[t]);
  const shown = useMemo(
    () => (filter ? alertas.filter((a) => a.tipo === filter) : alertas),
    [alertas, filter]
  );

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-foreground text-sm">
            Alertas de comportamiento
            {alertas.length > 0 && (
              <span className="ml-2 text-xs font-semibold text-muted-foreground">{alertas.length}</span>
            )}
          </h3>
          {alertas.length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-espert-gold hover:underline"
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {open ? "Ocultar detalle" : "Ver detalle"}
            </button>
          )}
        </div>

        {alertas.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-2">Sin alertas en el período</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {tipos.map((t) => {
                const sev = severityFor(t, alertas);
                const active = filter === t;
                return (
                  <button
                    key={t}
                    onClick={() => {
                      setFilter(active ? null : t);
                      if (!active) setOpen(true);
                    }}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${SEVERITY_CLASS[sev]} ${
                      active ? "ring-2 ring-espert-gold" : ""
                    }`}
                    title={`Severidad ${sev}`}
                  >
                    {alertLabel(t)} <span className="tabular-nums">{counts[t]}</span>
                  </button>
                );
              })}
            </div>

            {open && (
              <ul className="mt-3 divide-y divide-border max-h-80 overflow-y-auto text-xs">
                {shown.map((a, i) => (
                  <li key={`${a.tipo}-${a.visitId ?? a.pdvId ?? i}-${i}`} className="py-1.5 flex items-start gap-2">
                    <span className="text-muted-foreground tabular-nums w-14 shrink-0">{shortDate(a.fecha)}</span>
                    <span className={`px-1.5 rounded-full text-[10px] font-semibold shrink-0 ${SEVERITY_CLASS[a.severidad]}`}>
                      {alertLabel(a.tipo)}
                    </span>
                    <span className="min-w-0">
                      {a.pdvName && <span className="font-medium text-foreground">{a.pdvName}</span>}
                      {a.pdvName && a.detalle && <span className="text-muted-foreground"> · </span>}
                      {a.detalle && <span className="text-muted-foreground">{a.detalle}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
