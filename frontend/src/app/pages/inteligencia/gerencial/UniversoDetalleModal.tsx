import type { GerencialUniverso } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { DASH, dec1, nf, pct, ratioPct } from "./format";
import { SortTH, TD } from "./parts";
import { useSort, type SortState, type SortValue } from "./sort";

/** Qué tarjeta de Universo se abrió. Dos listas, cada una con dos entradas. */
export type UniversoDetalle = "rutas" | "pdvPorRuta" | "reps" | "pdvPorRep";

type Ruta = GerencialUniverso["rutasDetalle"][number];
type Rep = GerencialUniverso["repsDetalle"][number];

const RUTA_COLS: Record<string, (r: Ruta) => SortValue> = {
  nombre: (r) => r.nombre,
  rep: (r) => r.rep,
  area: (r) => r.area,
  pdvs: (r) => r.pdvs,
  visitados: (r) => r.visitados,
  pctVisitados: (r) => ratioPct(r.visitados, r.pdvs),
  efectivos: (r) => r.efectivos,
};

const REP_COLS: Record<string, (r: Rep) => SortValue> = {
  nombre: (r) => r.nombre,
  area: (r) => r.area,
  estado: (r) => (r.activo ? "Activo" : "Sin visitas"),
  realizadas: (r) => r.realizadas,
  rutasFoco: (r) => r.rutasFoco,
  pdvs: (r) => r.pdvs,
  visitados: (r) => r.visitados,
  efectivos: (r) => r.efectivos,
};

const ROW = "border-t border-border/60 text-right";

export function UniversoDetalleModal({
  detalle,
  data,
  context,
  onClose,
}: {
  detalle: UniversoDetalle | null;
  data: GerencialUniverso;
  /** "Argentina · AMBA · Sep, Oct, Nov": el filtro con el que se calculó. */
  context: string;
  onClose: () => void;
}) {
  const esRutas = detalle === "rutas" || detalle === "pdvPorRuta";
  return (
    <Dialog open={detalle != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 p-0 sm:max-w-4xl">
        {detalle != null &&
          (esRutas ? (
            // key: cada tarjeta abre con su orden inicial.
            <RutasDetalle key={detalle} data={data} context={context} porPdvs={detalle === "pdvPorRuta"} />
          ) : (
            <RepsDetalle key={detalle} data={data} context={context} porPdvs={detalle === "pdvPorRep"} />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function Header({ title, context, resumen }: { title: string; context: string; resumen: string }) {
  return (
    <DialogHeader className="px-5 pt-5 text-left">
      <DialogTitle className="text-base">{title}</DialogTitle>
      <DialogDescription className="text-xs">{context}</DialogDescription>
      <p className="text-sm font-medium text-foreground">{resumen}</p>
    </DialogHeader>
  );
}

function Vacio({ cols, text }: { cols: number; text: string }) {
  return (
    <tr className="border-t border-border/60">
      <td colSpan={cols} className="px-3 py-6 text-center text-muted-foreground">{text}</td>
    </tr>
  );
}

function RutasDetalle({ data, context, porPdvs }: { data: GerencialUniverso; context: string; porPdvs: boolean }) {
  const initial: SortState<string> = porPdvs ? { key: "pdvs", dir: "desc" } : { key: "nombre", dir: "asc" };
  const { sorted, sort, toggle } = useSort(data.rutasDetalle, RUTA_COLS, initial);
  const h = { sort, onSort: toggle };
  const pdvs = data.rutasDetalle.map((r) => r.pdvs);
  const resumen = porPdvs
    ? `Promedio ${dec1(data.pdvPorRuta)} PDVs por ruta · de ${pdvs.length ? nf(Math.min(...pdvs)) : DASH} a ${pdvs.length ? nf(Math.max(...pdvs)) : DASH}`
    : `${nf(data.rutasFoco)} rutas foco con PDVs activos`;
  return (
    <>
      <Header title={porPdvs ? "PDVs por ruta foco" : "Rutas foco"} context={context} resumen={resumen} />
      <div className="min-h-0 flex-1 overflow-auto pb-3">
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 bg-background">
            <tr>
              <SortTH label="Ruta" col="nombre" align="left" {...h} />
              <SortTH label="TM Rep" col="rep" align="left" {...h} />
              <SortTH label="Área" col="area" align="left" {...h} />
              <SortTH label="PDVs" col="pdvs" {...h} />
              <SortTH label="Visitados" col="visitados" {...h} />
              <SortTH label="% visit." col="pctVisitados" {...h} />
              <SortTH label="Efectivos" col="efectivos" {...h} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <Vacio cols={7} text="No hay rutas foco para este filtro." />}
            {sorted.map((r) => (
              <tr key={r.id} className={ROW}>
                <td className={`${TD} text-left font-medium text-foreground`}>{r.nombre}</td>
                <td className={`${TD} text-left`}>{r.rep ?? <span className="text-muted-foreground">Sin asignar</span>}</td>
                <td className={`${TD} text-left text-muted-foreground`}>{r.area}</td>
                <td className={`${TD} font-semibold text-foreground`}>{nf(r.pdvs)}</td>
                <td className={TD}>{nf(r.visitados)}</td>
                <td className={TD}>{pct(roundPct(r.visitados, r.pdvs))}</td>
                <td className={TD}>{nf(r.efectivos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RepsDetalle({ data, context, porPdvs }: { data: GerencialUniverso; context: string; porPdvs: boolean }) {
  const initial: SortState<string> = porPdvs ? { key: "pdvs", dir: "desc" } : { key: "realizadas", dir: "desc" };
  const { sorted, sort, toggle } = useSort(data.repsDetalle, REP_COLS, initial);
  const h = { sort, onSort: toggle };
  const resumen = porPdvs
    ? `Promedio ${dec1(data.pdvPorRep)} PDVs en ruta foco por TM Rep activo`
    : `${nf(data.repsActivos)} activos de ${nf(data.repsNomina)} en nómina · activo = con visitas cerradas en ${data.periodoLabel}`;
  return (
    <>
      <Header title={porPdvs ? "PDVs en ruta foco por TM Rep" : "TM Reps de la nómina"} context={context} resumen={resumen} />
      <div className="min-h-0 flex-1 overflow-auto pb-3">
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 bg-background">
            <tr>
              <SortTH label="TM Rep" col="nombre" align="left" {...h} />
              <SortTH label="Área" col="area" align="left" {...h} />
              <SortTH label="Estado" col="estado" align="center" {...h} />
              <SortTH label="Visitas" col="realizadas" {...h} />
              <SortTH label="Rutas foco" col="rutasFoco" {...h} />
              <SortTH label="PDVs en ruta" col="pdvs" {...h} />
              <SortTH label="Visitados" col="visitados" {...h} />
              <SortTH label="Efectivos" col="efectivos" {...h} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <Vacio cols={8} text="No hay TM Reps para este filtro." />}
            {sorted.map((r) => (
              <tr key={r.id} className={ROW}>
                <td className={`${TD} text-left font-medium text-foreground`}>{r.nombre}</td>
                <td className={`${TD} text-left text-muted-foreground`}>{r.area}</td>
                <td className={`${TD} text-center`}>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      r.activo
                        ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.activo ? "Activo" : "Sin visitas"}
                  </span>
                </td>
                <td className={TD}>{nf(r.realizadas)}</td>
                <td className={TD}>{nf(r.rutasFoco)}</td>
                <td className={`${TD} font-semibold text-foreground`}>{nf(r.pdvs)}</td>
                <td className={TD}>{nf(r.visitados)}</td>
                <td className={TD}>{nf(r.efectivos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function roundPct(a: number, b: number): number | null {
  const p = ratioPct(a, b);
  return p == null ? null : Math.round(p);
}
