import { useMemo } from "react";
import type { GerencialRepRow } from "@/lib/api";
import { DASH, dec1, nf, pct } from "./format";
import { terciles } from "./heat";
import { HeatPill } from "./HeatPill";
import { ROW_CLICK, TableCard, TD, TH, rowKeyHandler } from "./parts";

const ESTADO_CLS = {
  ok: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  off: "bg-muted text-muted-foreground",
};

/**
 * Estado del TM Rep en el período. Misma lógica y umbrales que `estado()` de
 * EquipoTablaCruda (GPS < 80, foto < 40), más "Bajo plan" cuando cumple menos
 * del 60% de lo planificado. Gana la primera condición que se cumple.
 */
export function estadoRep(r: GerencialRepRow): { label: string; cls: string } {
  if (r.realizadas === 0) return { label: "Sin actividad", cls: ESTADO_CLS.off };
  if (r.gpsPct != null && r.gpsPct < 80) return { label: "GPS bajo", cls: ESTADO_CLS.bad };
  if (r.fotoPct != null && r.fotoPct < 40) return { label: "Foto baja", cls: ESTADO_CLS.warn };
  if (r.cumplimientoPct != null && r.cumplimientoPct < 60) return { label: "Bajo plan", cls: ESTADO_CLS.warn };
  return { label: "OK", cls: ESTADO_CLS.ok };
}

export function ActividadTable({
  reps,
  onSelectRep,
}: {
  reps: GerencialRepRow[];
  onSelectRep: (rep: GerencialRepRow) => void;
}) {
  const rows = useMemo(() => [...reps].sort((a, b) => b.realizadas - a.realizadas), [reps]);
  const heat = useMemo(
    () => ({
      cumpl: terciles(rows.map((r) => r.cumplimientoPct)),
      visDia: terciles(rows.map((r) => r.visitasPorDia)),
      efect: terciles(rows.map((r) => r.efectividadPct)),
      gps: terciles(rows.map((r) => r.gpsPct)),
      foto: terciles(rows.map((r) => r.fotoPct)),
      mov: terciles(rows.map((r) => r.movimientos)),
    }),
    [rows],
  );

  return (
    <TableCard title="Detalle por TM Rep" hint="Tocá un TM Rep para ver solo su gestión en todas las solapas.">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-right">
            <th className={`${TH} text-left`}>TM Rep</th>
            <th className={`${TH} text-left`}>Área</th>
            <th className={TH}>Clientes activos</th>
            <th className={TH}>Rutas foco</th>
            <th className={TH}>Planif.</th>
            <th className={TH}>Realizadas</th>
            <th className={`${TH} text-center`}>Cumplim.</th>
            <th className={`${TH} text-center`}>Vis./día</th>
            <th className={TH}>Duración</th>
            <th className={`${TH} text-center`}>Efectividad</th>
            <th className={`${TH} text-center`}>GPS</th>
            <th className={`${TH} text-center`}>Foto</th>
            <th className={`${TH} text-center`}>Mov. en la app</th>
            <th className={`${TH} text-center`}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="border-t border-border/60">
              <td colSpan={14} className="px-3 py-6 text-center text-muted-foreground">
                No hay TM Reps para este filtro.
              </td>
            </tr>
          )}
          {rows.map((r, i) => {
            const st = estadoRep(r);
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
                <td className={TD}>{nf(r.rutasFoco)}</td>
                <td className={TD}>{nf(r.planificadas)}</td>
                <td className={`${TD} font-semibold text-foreground`}>{nf(r.realizadas)}</td>
                <td className={`${TD} text-center`}><HeatPill text={pct(r.cumplimientoPct)} band={heat.cumpl[i]} /></td>
                <td className={`${TD} text-center`}><HeatPill text={dec1(r.visitasPorDia)} band={heat.visDia[i]} /></td>
                <td className={TD}>
                  {r.duracionMin == null ? <span className="text-muted-foreground">{DASH}</span> : `${nf(r.duracionMin)} min`}
                </td>
                <td className={`${TD} text-center`}><HeatPill text={pct(r.efectividadPct)} band={heat.efect[i]} /></td>
                <td className={`${TD} text-center`}><HeatPill text={pct(r.gpsPct)} band={heat.gps[i]} /></td>
                <td className={`${TD} text-center`}><HeatPill text={pct(r.fotoPct)} band={heat.foto[i]} /></td>
                <td className={`${TD} text-center`}><HeatPill text={nf(r.movimientos)} band={heat.mov[i]} /></td>
                <td className={`${TD} text-center`}>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}
