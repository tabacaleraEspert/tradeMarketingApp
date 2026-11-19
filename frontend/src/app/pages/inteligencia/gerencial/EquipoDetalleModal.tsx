import type { ReactNode } from "react";
import type { GerencialEquipo, GerencialRepRow } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { DASH, dec1, nf, pct } from "./format";
import { SortTH, TD } from "./parts";
import { useSort, type SortValue } from "./sort";

/** Qué tarjeta de Performance de equipo se abrió. */
export type EquipoDetalle = "planificadas" | "realizadas" | "visitasPorDia" | "duracion" | "efectividad";

type Col = {
  key: string;
  label: string;
  value: (r: GerencialRepRow) => SortValue;
  text: (r: GerencialRepRow) => string;
  /** La columna que explica el indicador: va resaltada. */
  main?: boolean;
};

const C: Record<string, Col> = {
  rutasFoco: { key: "rutasFoco", label: "Rutas foco", value: (r) => r.rutasFoco, text: (r) => nf(r.rutasFoco) },
  planificadas: { key: "planificadas", label: "Planificadas", value: (r) => r.planificadas, text: (r) => nf(r.planificadas) },
  realizadas: { key: "realizadas", label: "Realizadas", value: (r) => r.realizadas, text: (r) => nf(r.realizadas) },
  cumplimiento: { key: "cumplimiento", label: "Cumplim.", value: (r) => r.cumplimientoPct, text: (r) => pct(r.cumplimientoPct) },
  visitasPorDia: { key: "visitasPorDia", label: "Vis./día", value: (r) => r.visitasPorDia, text: (r) => dec1(r.visitasPorDia) },
  duracion: {
    key: "duracion",
    label: "Duración",
    value: (r) => r.duracionMin,
    text: (r) => (r.duracionMin == null ? DASH : `${nf(r.duracionMin)} min`),
  },
  visitados: { key: "visitados", label: "PDVs visitados", value: (r) => r.visitados, text: (r) => nf(r.visitados) },
  efectivos: { key: "efectivos", label: "PDVs efectivos", value: (r) => r.efectivos, text: (r) => nf(r.efectivos) },
  efectividad: { key: "efectividad", label: "Efectividad", value: (r) => r.efectividadPct, text: (r) => pct(r.efectividadPct) },
};
const main = (c: Col): Col => ({ ...c, main: true });

type Spec = {
  title: string;
  /** La cuenta con los números del filtro: "3.484 ÷ 6.770 = 51,5%". */
  cuenta: string;
  /** Qué entra y qué no. */
  notas: string[];
  cols: Col[];
  sortBy: string;
};

function spec(detalle: EquipoDetalle, data: GerencialEquipo): Spec {
  const c = data.cards;
  const dias = data.diasHabiles;
  switch (detalle) {
    case "planificadas":
      return {
        title: "Visitas planificadas",
        cuenta: `${nf(c.planificadas)} visitas programadas en ${data.periodoLabel}`,
        notas: [
          "Suma los PDVs programados en cada día de ruta foco del período.",
          "Cuenta solo hasta hoy: los días que todavía no llegaron no entran.",
          "Solo rutas foco vigentes con TM Rep asignado. Las rutas de campaña quedan afuera.",
        ],
        cols: [C.rutasFoco, main(C.planificadas), C.realizadas, C.cumplimiento],
        sortBy: "planificadas",
      };
    case "realizadas":
      return {
        title: "Visitas realizadas",
        cuenta:
          c.cumplimientoPct == null
            ? `${nf(c.realizadas)} visitas cerradas · sin visitas planificadas`
            : `${nf(c.realizadas)} realizadas ÷ ${nf(c.planificadas)} planificadas = ${pct(c.cumplimientoPct)}`,
        notas: [
          "Cuenta las visitas cerradas en el período. Las abiertas no entran.",
          "Incluye visitas fuera de plan, por eso el cumplimiento puede pasar de 100%.",
        ],
        cols: [C.planificadas, main(C.realizadas), C.cumplimiento],
        sortBy: "realizadas",
      };
    case "visitasPorDia":
      return {
        title: "Visitas por día por rep",
        cuenta: `${nf(c.realizadas)} realizadas ÷ (${nf(dias)} días hábiles × ${nf(c.repsConVisitas)} TM Reps con visitas) = ${dec1(c.visitasPorDiaRep)}`,
        notas: [
          "Días hábiles: lunes a viernes, sin los feriados cargados, hasta hoy.",
          "Solo se divide entre los TM Reps que tuvieron al menos una visita en el período.",
          `En la tabla, cada TM Rep: sus realizadas ÷ ${nf(dias)} días hábiles.`,
        ],
        cols: [C.realizadas, main(C.visitasPorDia)],
        sortBy: "visitasPorDia",
      };
    case "duracion":
      return {
        title: "Tiempo promedio de visita",
        cuenta: c.duracionMin == null ? "Sin visitas con hora de cierre" : `Promedio de ${nf(c.duracionMin)} min por visita`,
        notas: [
          "Duración de una visita: hora de cierre menos hora de apertura.",
          "El total promedia todas las visitas, no los promedios de cada TM Rep: quien hace más visitas pesa más.",
        ],
        cols: [C.realizadas, main(C.duracion)],
        sortBy: "duracion",
      };
    case "efectividad":
      return {
        title: "Efectividad",
        cuenta: `${nf(c.efectivos)} PDVs efectivos ÷ ${nf(c.visitados)} PDVs visitados = ${pct(c.efectividadPct)}`,
        notas: [
          "Se mide sobre los PDVs de rutas foco, no sobre visitas.",
          "Visitado: al menos una visita cerrada en el período.",
          "Efectivo: visitado con cobertura Regular o más y material POP Regular o más, en el mismo mes. No exige acciones.",
          "Un PDV que está en rutas foco de dos TM Reps cuenta para los dos; en el total, una sola vez.",
        ],
        cols: [C.visitados, C.efectivos, main(C.efectividad)],
        sortBy: "efectividad",
      };
  }
}

export function EquipoDetalleModal({
  detalle,
  data,
  context,
  onClose,
}: {
  detalle: EquipoDetalle | null;
  data: GerencialEquipo;
  /** "Argentina · AMBA · Sep, Oct, Nov": el filtro con el que se calculó. */
  context: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={detalle != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 p-0 sm:max-w-2xl">
        {/* key: cada tarjeta abre con su orden inicial. */}
        {detalle != null && <Detalle key={detalle} spec={spec(detalle, data)} reps={data.reps} context={context} />}
      </DialogContent>
    </Dialog>
  );
}

function Detalle({ spec: s, reps, context }: { spec: Spec; reps: GerencialRepRow[]; context: string }) {
  const columns: Record<string, (r: GerencialRepRow) => SortValue> = {
    nombre: (r) => r.nombre,
    area: (r) => r.area,
    ...Object.fromEntries(s.cols.map((c) => [c.key, c.value])),
  };
  const { sorted, sort, toggle } = useSort(reps, columns, { key: s.sortBy, dir: "desc" });
  const h = { sort, onSort: toggle };
  return (
    <>
      <DialogHeader className="px-5 pt-5 text-left">
        <DialogTitle className="text-base">{s.title}</DialogTitle>
        <DialogDescription className="text-xs">{context}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-auto pb-3">
        <div className="space-y-3 px-5 pb-4">
          <Bloque titulo="Cómo se llega">
            <p className="text-sm font-semibold tabular-nums text-foreground">{s.cuenta}</p>
          </Bloque>
          <Bloque titulo="Qué cuenta">
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {s.notas.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </Bloque>
        </div>
        <p className="px-5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Por TM Rep
        </p>
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr>
              <SortTH label="TM Rep" col="nombre" align="left" {...h} />
              <SortTH label="Área" col="area" align="left" {...h} />
              {s.cols.map((c) => <SortTH key={c.key} label={c.label} col={c.key} {...h} />)}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr className="border-t border-border/60">
                <td colSpan={2 + s.cols.length} className="px-3 py-6 text-center text-muted-foreground">
                  No hay TM Reps para este filtro.
                </td>
              </tr>
            )}
            {sorted.map((r) => (
              <tr key={r.id} className="border-t border-border/60 text-right">
                <td className={`${TD} text-left font-medium text-foreground`}>{r.nombre}</td>
                <td className={`${TD} text-left text-muted-foreground`}>{r.area || DASH}</td>
                {s.cols.map((c) => (
                  <td key={c.key} className={`${TD} ${c.main ? "font-semibold text-foreground" : ""}`}>{c.text(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</p>
      {children}
    </div>
  );
}
