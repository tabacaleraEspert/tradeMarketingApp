import { useState } from "react";
import type { GerencialUniverso } from "@/lib/api";
import { UniversoDetalleModal, type UniversoDetalle } from "./UniversoDetalleModal";
import { dec1, nf, pct, ratioPct } from "./format";
import { MiniBar, ROW_CLICK, SortTH, StatCard, TableCard, TD, rowKeyHandler } from "./parts";
import { useSort, type SortValue } from "./sort";

type Area = GerencialUniverso["areas"][number];
const AREA_COLS: Record<string, (a: Area) => SortValue> = {
  area: (a) => a.area,
  rastrillado: (a) => a.rastrillado,
  enRutaFoco: (a) => a.enRutaFoco,
  pctEnRuta: (a) => ratioPct(a.enRutaFoco, a.rastrillado),
  visitados: (a) => a.visitados,
  efectivos: (a) => a.efectivos,
  rutas: (a) => a.rutas,
  repsActivos: (a) => a.repsActivos,
  pdvPorRep: (a) => a.pdvPorRep,
};

export function UniversoTab({
  data,
  context,
  onSelectZone,
}: {
  data: GerencialUniverso;
  /** Filtro vigente en texto, para el encabezado de los detalles. */
  context: string;
  onSelectZone: (zoneId: number) => void;
}) {
  const e = data.embudo;
  const pasos = [
    { label: "Rastrillado", value: e.rastrillado, prev: null as number | null, sub: "PDVs activos" },
    { label: "En ruta foco", value: e.enRutaFoco, prev: e.rastrillado, sub: "del rastrillado" },
    { label: "Visitados", value: e.visitados, prev: e.enRutaFoco, sub: "de los en ruta foco" },
    { label: "Efectivos", value: e.efectivos, prev: e.visitados, sub: "de los visitados" },
  ];
  const totalPct = ratioPct(e.enRutaFoco, e.rastrillado);
  const { sorted: areas, sort, toggle } = useSort(data.areas, AREA_COLS, { key: "rastrillado", dir: "desc" });
  const h = { sort, onSort: toggle };
  const [detalle, setDetalle] = useState<UniversoDetalle | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {pasos.map((p) => {
            const share = p.prev == null ? null : ratioPct(p.value, p.prev);
            return (
              <StatCard
                key={p.label}
                label={p.label}
                value={nf(p.value)}
                barPct={p.prev == null ? 100 : share ?? 0}
                sub={p.prev == null ? p.sub : `${pct(share)} ${p.sub}`}
              />
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Efectivo = PDV visitado con cobertura Regular o más y material POP Regular o más.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Rutas foco" value={nf(data.rutasFoco)} sub="rutas armadas en el período" onClick={() => setDetalle("rutas")} />
        <StatCard
          label="TM Reps activos"
          value={nf(data.repsActivos)}
          sub={`de ${nf(data.repsNomina)} en nómina · con visitas en ${data.periodoLabel}`}
          onClick={() => setDetalle("reps")}
        />
        <StatCard label="Promedio PDV por ruta" value={dec1(data.pdvPorRuta)} sub="PDVs por ruta foco" onClick={() => setDetalle("pdvPorRuta")} />
        <StatCard label="Promedio PDV por TM Rep" value={dec1(data.pdvPorRep)} sub="PDVs en ruta por TM Rep activo" onClick={() => setDetalle("pdvPorRep")} />
      </div>
      <UniversoDetalleModal detalle={detalle} data={data} context={context} onClose={() => setDetalle(null)} />

      <TableCard title="Universo por área" hint="Tocá un área para filtrar todo el tablero, o un título para ordenar.">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr>
              <SortTH label="Área" col="area" align="left" {...h} />
              <SortTH label="Rastrillado" col="rastrillado" {...h} />
              <SortTH label="En ruta foco" col="enRutaFoco" {...h} />
              <SortTH label="% en ruta" col="pctEnRuta" {...h} />
              <SortTH label="Visitados" col="visitados" {...h} />
              <SortTH label="Efectivos" col="efectivos" {...h} />
              <SortTH label="Rutas" col="rutas" {...h} />
              <SortTH label="TM Reps activos" col="repsActivos" {...h} />
              <SortTH label="PDV por TM Rep" col="pdvPorRep" {...h} />
            </tr>
          </thead>
          <tbody>
            {areas.length === 0 && (
              <tr className="border-t border-border/60">
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  No hay áreas con datos para este filtro.
                </td>
              </tr>
            )}
            {areas.map((a) => {
              const p = ratioPct(a.enRutaFoco, a.rastrillado);
              const zoneId = a.zoneId;
              const click = zoneId != null ? () => onSelectZone(zoneId) : undefined;
              return (
                <tr
                  key={zoneId ?? a.area}
                  className={click ? `${ROW_CLICK} text-right` : "border-t border-border/60 text-right"}
                  onClick={click}
                  onKeyDown={click ? rowKeyHandler(click) : undefined}
                  tabIndex={click ? 0 : undefined}
                  title={click ? `Filtrar por ${a.area}` : undefined}
                >
                  <td className={`${TD} text-left font-medium text-foreground`}>{a.area}</td>
                  <td className={TD}>{nf(a.rastrillado)}</td>
                  <td className={TD}>{nf(a.enRutaFoco)}</td>
                  <td className={TD}>
                    <span className="inline-flex items-center justify-end gap-2">
                      {pct(p == null ? null : Math.round(p))}
                      <MiniBar pct={p ?? 0} className="w-16" />
                    </span>
                  </td>
                  <td className={TD}>{nf(a.visitados)}</td>
                  <td className={TD}>{nf(a.efectivos)}</td>
                  <td className={TD}>{nf(a.rutas)}</td>
                  <td className={TD}>{nf(a.repsActivos)}</td>
                  <td className={TD}>{dec1(a.pdvPorRep)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border text-right font-bold text-foreground">
              <td className={`${TD} text-left`}>Total</td>
              <td className={TD}>{nf(e.rastrillado)}</td>
              <td className={TD}>{nf(e.enRutaFoco)}</td>
              <td className={TD}>
                <span className="inline-flex items-center justify-end gap-2">
                  {pct(totalPct == null ? null : Math.round(totalPct))}
                  <span className="w-16" />
                </span>
              </td>
              <td className={TD}>{nf(e.visitados)}</td>
              <td className={TD}>{nf(e.efectivos)}</td>
              <td className={TD}>{nf(data.rutasFoco)}</td>
              <td className={TD}>{nf(data.repsActivos)}</td>
              <td className={TD}>{dec1(data.pdvPorRep)}</td>
            </tr>
          </tfoot>
        </table>
      </TableCard>
    </div>
  );
}
