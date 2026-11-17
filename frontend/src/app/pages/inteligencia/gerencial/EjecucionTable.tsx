import { useMemo } from "react";
import type { GerencialRepRow } from "@/lib/api";
import { DASH, nf, pct } from "./format";
import { terciles } from "./heat";
import { HeatPill } from "./HeatPill";
import { ROW_CLICK, TableCard, TD, TH, rowKeyHandler } from "./parts";

export function EjecucionTable({
  reps,
  onSelectRep,
}: {
  reps: GerencialRepRow[];
  onSelectRep: (rep: GerencialRepRow) => void;
}) {
  const rows = useMemo(() => [...reps].sort((a, b) => b.realizadas - a.realizadas), [reps]);
  const heat = useMemo(
    () => ({
      com: terciles(rows.map((r) => r.comunicacionPct)),
      sueltos: terciles(rows.map((r) => r.sueltosPct)),
      activ: terciles(rows.map((r) => r.activacionesPct)),
    }),
    [rows],
  );

  return (
    <TableCard
      title="Ejecución en PDV por TM Rep"
      hint="% sobre los clientes activos de cada TM Rep. Promedio mensual del período."
    >
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-right">
            <th className={`${TH} text-left`}>TM Rep</th>
            <th className={`${TH} text-left`}>Área</th>
            <th className={TH}>Clientes activos</th>
            <th className={`${TH} text-center`}>Comunicación</th>
            <th className={`${TH} text-center`}>Sueltos</th>
            <th className={`${TH} text-center`}>Activaciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="border-t border-border/60">
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                No hay TM Reps para este filtro.
              </td>
            </tr>
          )}
          {rows.map((r, i) => {
            const click = () => onSelectRep(r);
            return (
              <tr
                key={r.id}
                className={`${ROW_CLICK} text-right`}
                onClick={click}
                onKeyDown={rowKeyHandler(click)}
                tabIndex={0}
                title={`Filtrar por ${r.nombre}`}
              >
                <td className={`${TD} text-left font-medium text-foreground`}>{r.nombre}</td>
                <td className={`${TD} text-left text-muted-foreground`}>{r.area || DASH}</td>
                <td className={TD}>{nf(r.clientes)}</td>
                <td className={`${TD} text-center`}><HeatPill text={pct(r.comunicacionPct)} band={heat.com[i]} /></td>
                <td className={`${TD} text-center`}><HeatPill text={pct(r.sueltosPct)} band={heat.sueltos[i]} /></td>
                <td className={`${TD} text-center`}><HeatPill text={pct(r.activacionesPct)} band={heat.activ[i]} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}
