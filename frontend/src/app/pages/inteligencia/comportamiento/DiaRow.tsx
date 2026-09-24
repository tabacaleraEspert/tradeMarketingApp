/**
 * Fila de un día del período (patrón ActividadDayRow): resumen + detalle
 * expandible con timeline secuencial, planificados no visitados y mapa.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { IntelBehaviorDia } from "@/lib/api";
import { RoutePathMap, type RoutePoint } from "../../../components/RoutePathMap";
import { SEVERITY_CLASS, alertLabel, severityFor } from "./alert-meta";
import { countAlerts } from "./csv";
import { hhmm, kmFmt, minFmt } from "./range-utils";
import type { RoadKmEntry } from "./road-km";

interface Props {
  day: IntelBehaviorDia;
  perimeterM: number;
  road?: RoadKmEntry;
  onComputeRoad?: (fecha: string) => void;
  roadAvailable: boolean;
}

export function dayPoints(day: IntelBehaviorDia, group?: string): RoutePoint[] {
  const pts: RoutePoint[] = day.puntos.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    label: String(p.seq),
    kind: p.tipo,
    group,
    title: `#${p.seq} ${p.tipo.toUpperCase()} ${hhmm(p.ts)}${p.pdvName ? ` · ${p.pdvName}` : ""}${
      p.distPdv != null ? ` · ${Math.round(p.distPdv)} m del PDV` : ""
    }`,
  }));
  for (const pnv of day.planNoVisitados) {
    if (pnv.lat == null || pnv.lon == null) continue;
    pts.push({
      lat: pnv.lat,
      lon: pnv.lon,
      label: pnv.plannedOrder != null ? `P${pnv.plannedOrder}` : "P",
      kind: "plan",
      group,
      title: `Planificado no visitado · ${pnv.pdvName}`,
    });
  }
  return pts;
}

export function DiaRow({ day, perimeterM, road, onComputeRoad, roadAvailable }: Props) {
  const [expanded, setExpanded] = useState(false);
  const counts = useMemo(() => countAlerts(day.alertas), [day.alertas]);
  const tipos = Object.keys(counts);
  const kmRoad = road?.status === "done" ? road.result?.kmRuta : undefined;
  const points = useMemo(() => (expanded ? dayPoints(day) : []), [expanded, day]);
  const roadPath = road?.status === "done" && road.result && road.result.path.length >= 2 ? [{ path: road.result.path }] : undefined;

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 sm:gap-3 py-2.5 text-left hover:bg-muted/40 rounded-md px-2"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground w-20 sm:w-24 shrink-0">{day.diaLabel}</span>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums inline-flex items-center gap-1">
          {hhmm(day.on)} – {hhmm(day.off)}
          {(day.onSource === "visit" || day.offSource === "visit") && (
            <span className="px-1 rounded bg-muted text-[10px] text-muted-foreground" title="Horario de la visita, no del GPS">
              sin GPS
            </span>
          )}
        </span>
        <span className="text-xs text-foreground shrink-0 tabular-nums" title="PDVs visitados / planificados">
          {day.pdvs}/{day.planificados} PDV
        </span>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums hidden sm:inline">
          {kmRoad != null ? kmFmt(kmRoad) : kmFmt(day.kmLinea)}
          {kmRoad == null && day.kmLinea > 0 && <span className="ml-1 text-[10px]">recta</span>}
        </span>
        <span className="ml-auto flex items-center gap-1 flex-wrap justify-end">
          {tipos.map((t) => (
            <span
              key={t}
              className={`px-1.5 rounded-full text-[10px] font-semibold ${SEVERITY_CLASS[severityFor(t, day.alertas)]}`}
              title={alertLabel(t)}
            >
              {alertLabel(t)} {counts[t]}
            </span>
          ))}
        </span>
      </button>

      {expanded && (
        <div className="pl-2 sm:pl-8 pr-2 pb-4 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Activo {minFmt(day.activoMin)}</span>
            <span>{day.visitas} visitas · {day.pdvs} PDVs</span>
            <span>
              Km: {kmRoad != null ? `${kmFmt(kmRoad)} por calle` : `${kmFmt(day.kmLinea)} línea recta`}
              {kmRoad == null && roadAvailable && onComputeRoad && day.puntos.length >= 2 && (
                <button
                  onClick={() => onComputeRoad(day.fecha)}
                  disabled={road?.status === "loading"}
                  className="ml-2 text-espert-gold font-semibold hover:underline disabled:opacity-60 inline-flex items-center gap-1"
                >
                  {road?.status === "loading" && <Loader2 size={12} className="animate-spin" />}
                  {road?.status === "error" ? "Reintentar km reales" : "Calcular km reales"}
                </button>
              )}
            </span>
            <span>GPS {Math.round(day.gpsPct)}%</span>
            {day.bateriaInicio != null && (
              <span>
                Batería {day.bateriaInicio}% → {day.bateriaFin ?? "—"}%
              </span>
            )}
            {day.ordenRespetado != null && <span>Orden {day.ordenRespetado ? "respetado" : "distinto al plan"}</span>}
          </div>

          {day.secuencia.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 font-semibold w-7">#</th>
                    <th className="text-left py-1.5 font-semibold">Horario</th>
                    <th className="text-left py-1.5 font-semibold">PDV</th>
                    <th className="text-right py-1.5 font-semibold">Dur.</th>
                    <th className="text-right py-1.5 font-semibold" title={`Distancia al PDV (perímetro ${perimeterM} m)`}>
                      Dist.
                    </th>
                    <th className="text-right py-1.5 font-semibold hidden sm:table-cell">Bat.</th>
                    <th className="text-right py-1.5 font-semibold hidden sm:table-cell">Km ant.</th>
                    <th className="text-left py-1.5 font-semibold pl-2">Alertas</th>
                  </tr>
                </thead>
                <tbody>
                  {day.secuencia.map((s) => {
                    const far = s.distPdv != null && s.distPdv > perimeterM;
                    const bat = day.puntos.find((p) => p.visitId === s.visitId && p.bateria != null)?.bateria ?? null;
                    return (
                      <tr key={s.visitId} className="border-b border-border last:border-0">
                        <td className="py-1.5 text-muted-foreground tabular-nums">{s.seq}</td>
                        <td className="py-1.5 tabular-nums whitespace-nowrap">
                          {hhmm(s.openedAt)} → {s.closedAt ? hhmm(s.closedAt) : <span className="text-amber-600">abierta</span>}
                        </td>
                        <td className="py-1.5 font-medium text-foreground">
                          {s.pdvName}
                          {s.plannedOrder != null && (
                            <span className="ml-1 text-[10px] text-muted-foreground" title="Orden planificado">
                              (plan #{s.plannedOrder})
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{s.durMin != null ? `${Math.round(s.durMin)}'` : "—"}</td>
                        <td className={`py-1.5 text-right tabular-nums ${far ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                          {s.hasGps && s.distPdv != null ? `${Math.round(s.distPdv)} m` : <span className="text-muted-foreground">sin GPS</span>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums hidden sm:table-cell">{bat != null ? `${bat}%` : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums hidden sm:table-cell">
                          {s.kmDesdeAnterior != null ? kmFmt(s.kmDesdeAnterior) : "—"}
                        </td>
                        <td className="py-1.5 pl-2">
                          <span className="flex flex-wrap gap-1">
                            {s.alertas.map((a) => (
                              <span key={a} className={`px-1.5 rounded-full text-[10px] font-semibold ${SEVERITY_CLASS[severityFor(a, day.alertas)]}`}>
                                {alertLabel(a)}
                              </span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sin visitas este día.</p>
          )}

          {day.planNoVisitados.length > 0 && (
            <div className="text-xs">
              <p className="font-semibold text-foreground mb-1">Planificados no visitados ({day.planNoVisitados.length})</p>
              <ul className="flex flex-wrap gap-1.5">
                {day.planNoVisitados.map((p) => (
                  <li key={p.pdvId} className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {p.plannedOrder != null && <span className="tabular-nums mr-1">#{p.plannedOrder}</span>}
                    {p.pdvName}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <RoutePathMap points={points} paths={roadPath} height={300} />
        </div>
      )}
    </div>
  );
}
