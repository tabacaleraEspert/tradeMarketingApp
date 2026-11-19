import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import type { GerencialEquipo, GerencialRepRow } from "@/lib/api";
import { ActividadTable } from "./ActividadTable";
import { EjecucionTable } from "./EjecucionTable";
import { EquipoDetalleModal, type EquipoDetalle } from "./EquipoDetalleModal";
import { dec1, nf, pct } from "./format";
import { HeatLegend } from "./HeatPill";
import { StatCard } from "./parts";

export const EQUIPO_SUBTABS = ["actividad", "ejecucion"] as const;
export type EquipoSubtab = (typeof EQUIPO_SUBTABS)[number];

const PROXIMAMENTE = ["Cobertura", "Categorización", "Variable mensual"];

export function EquipoTab({
  data,
  context,
  subtab,
  onSubtabChange,
  onSelectRep,
}: {
  data: GerencialEquipo;
  /** Filtro vigente en texto, para el encabezado de los detalles. */
  context: string;
  subtab: EquipoSubtab;
  onSubtabChange: (s: EquipoSubtab) => void;
  onSelectRep: (rep: GerencialRepRow) => void;
}) {
  const c = data.cards;
  const [detalle, setDetalle] = useState<EquipoDetalle | null>(null);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard label="Visitas planificadas" value={nf(c.planificadas)} sub={`en ${data.periodoLabel}`} onClick={() => setDetalle("planificadas")} />
        <StatCard
          label="Visitas realizadas"
          value={nf(c.realizadas)}
          barPct={c.cumplimientoPct}
          sub={c.cumplimientoPct == null ? "sin visitas planificadas" : `${pct(c.cumplimientoPct)} de lo planificado`}
          onClick={() => setDetalle("realizadas")}
        />
        <StatCard
          label="Visitas por día por rep"
          value={dec1(c.visitasPorDiaRep)}
          sub={`${nf(data.diasHabiles)} días hábiles del período`}
          onClick={() => setDetalle("visitasPorDia")}
        />
        <StatCard
          label="Tiempo promedio de visita"
          value={c.duracionMin == null ? "—" : `${nf(c.duracionMin)} min`}
          sub="por visita realizada"
          onClick={() => setDetalle("duracion")}
        />
        <StatCard
          label="Efectividad"
          value={pct(c.efectividadPct)}
          barPct={c.efectividadPct}
          sub={`PDVs efectivos sobre visitados · ${nf(c.efectivos)} de ${nf(c.visitados)}`}
          onClick={() => setDetalle("efectividad")}
        />
      </div>
      <EquipoDetalleModal detalle={detalle} data={data} context={context} onClose={() => setDetalle(null)} />

      <div className="overflow-x-auto [contain:inline-size]">
        <Tabs value={subtab} onValueChange={(v) => onSubtabChange(v as EquipoSubtab)}>
          <TabsList>
            <TabsTrigger value="actividad" className="px-3">Actividad</TabsTrigger>
            <TabsTrigger value="ejecucion" className="px-3">Ejecución en PDV</TabsTrigger>
            {PROXIMAMENTE.map((t) => (
              <TabsTrigger key={t} value={t} disabled title="Próximamente" className="px-3">
                {t}
                <span className="text-[9px] font-semibold uppercase tracking-wider">· Próximamente</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <HeatLegend />

      {subtab === "actividad" ? (
        <ActividadTable reps={data.reps} onSelectRep={onSelectRep} />
      ) : (
        <EjecucionTable reps={data.reps} onSelectRep={onSelectRep} />
      )}
    </div>
  );
}
