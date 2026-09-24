/**
 * Vista del comportamiento de un trade (tiles, alertas, km reales, mapa del
 * período, días expandibles, CSV) a partir de un response ya cargado.
 * La usan la pestaña de Inteligencia (con su filtro de rango) y la página
 * pública del reporte por mail (`/r/:token`, con `readOnly` en el contexto:
 * sin links a la ficha del PDV ni a la visita, que requieren login).
 */
import { useCallback, useMemo, useState } from "react";
import { Download, Loader2, Map as MapIcon, Route } from "lucide-react";
import type { IntelBehaviorResponse } from "@/lib/api";
import { Card, CardContent } from "../../../components/ui/card";
import { RoutePathMap, colorForIndex, type RoutePath, type RoutePoint } from "../../../components/RoutePathMap";
import { semaforo } from "./alert-meta";
import { AlertasCard } from "./AlertasCard";
import { DiaRow, dayPoints, visitHref } from "./DiaRow";
import { useIntelNav } from "../nav-context";
import { behaviorCsvRows, csvFilename, downloadCsv, toCsv } from "./csv";
import { kmFmt, minFmt, shortDate } from "./range-utils";
import { useRoadKm } from "./road-km";

interface Props {
  data: IntelBehaviorResponse;
  /** Recargando otro rango: se atenúa la vista actual. */
  loading?: boolean;
  userId: number;
  userName: string;
}

const nf = (n: number, digits = 1) =>
  n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: digits });

export function ComportamientoView({ data, loading = false, userId, userName }: Props) {
  const dias = data.dias;
  const road = useRoadKm(userId, dias, true);
  const [showPeriodMap, setShowPeriodMap] = useState(false);
  // Leyenda del mapa del período como filtro: días ocultos + "plan" (planificados no visitados).
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((g: string) => {
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }, []);
  const { openPdv, readOnly } = useIntelNav();
  const pdvClick = readOnly ? undefined : openPdv;
  const vHref = readOnly ? undefined : visitHref;

  // Km del período: por calle si TODOS los días con puntos ya se calcularon;
  // si no, línea recta (mezclar sería engañoso).
  const roadKmByDay = useMemo(() => {
    const m: Record<string, number | undefined> = {};
    for (const [f, e] of Object.entries(road.byDay)) if (e.status === "done") m[f] = e.result?.kmRuta;
    return m;
  }, [road.byDay]);
  const allRoad = road.total > 0 && road.done === road.total;
  let kmPeriodo = data?.resumen.kmLinea ?? 0;
  if (allRoad) {
    kmPeriodo = 0;
    for (const v of Object.values(roadKmByDay)) kmPeriodo += v ?? 0;
  }

  const r = data.resumen;
  const gpsPct = r && r.visitas > 0 ? Math.round((1 - r.visitasSinGps / r.visitas) * 100) : null;
  const kmPorDia = r && r.dias > 0 ? kmPeriodo / r.dias : 0;

  const tiles = r
    ? [
        {
          v: String(r.dias),
          l: "Días trabajados",
          d: r.diasConPlanSinVisitas > 0 ? `${r.diasConPlanSinVisitas} con plan sin visitas` : `${r.diasConPlan} con plan`,
          cls: semaforo(r.diasConPlanSinVisitas, 0, 1, false),
        },
        {
          v: `${r.onProm ?? "—"} / ${r.offProm ?? "—"}`,
          l: "ON / OFF prom.",
          d: `${r.onTarde} ON tarde · ${r.offTemprano} OFF temprano`,
          cls: semaforo(r.onTarde + r.offTemprano, 0, 2, false),
        },
        {
          v: nf(r.pdvsPorDia),
          l: "PDVs por día",
          d: `${nf(r.visitasPorDia)} visitas/día · ${r.pdvs} PDVs`,
        },
        {
          v: kmFmt(kmPorDia),
          l: "Km por día",
          d: allRoad ? `por calle · ${kmFmt(kmPeriodo)} total` : `línea recta · ${kmFmt(kmPeriodo)} total`,
        },
        {
          v: gpsPct != null ? `${gpsPct}%` : "—",
          l: "GPS",
          d: `${r.visitasSinGps} sin GPS · ${r.fueraPerimetro} fuera de perímetro`,
          cls: semaforo(gpsPct, 90, 70),
        },
        {
          v: minFmt(r.durPromMin),
          l: "Dur. prom. visita",
          d: `${r.visitasCortas} cortas · ${r.visitasAbiertas} abiertas`,
          cls: semaforo(r.visitasCortas, 0, 3, false),
        },
        {
          v: `${Math.round(r.planPct)}%`,
          l: "Cumplimiento plan",
          d: `${r.planVisitados}/${r.planificados} planificados`,
          cls: semaforo(r.planPct, 80, 50),
        },
        {
          v: r.ordenRespetadoPct != null ? `${Math.round(r.ordenRespetadoPct)}%` : "—",
          l: "Orden respetado",
          d: `activo ${minFmt(r.activoPromMin)}/día`,
          cls: semaforo(r.ordenRespetadoPct, 80, 50),
        },
      ]
    : [];

  const exportCsv = useCallback(() => {
    if (!data) return;
    downloadCsv(csvFilename(userName, data.from, data.to), toCsv(behaviorCsvRows(data, roadKmByDay)));
  }, [data, userName, roadKmByDay]);

  // Mapa del período: puntos de todos los días + una polyline por día.
  const periodMap = useMemo(() => {
    if (!showPeriodMap) return { points: [] as RoutePoint[], paths: undefined as RoutePath[] | undefined, colors: {} as Record<string, string> };
    const ordered = [...dias].reverse(); // asc para que la leyenda lea natural
    const colors: Record<string, string> = {};
    ordered.forEach((d, i) => (colors[d.fecha] = colorForIndex(i)));
    const visible = ordered.filter((d) => !hiddenGroups.has(d.fecha));
    const points = visible
      .flatMap((d) => dayPoints(d, d.fecha))
      .filter((p) => !(p.kind === "plan" && hiddenGroups.has("__plan")));
    const paths: RoutePath[] = visible.map((d) => {
      const e = road.byDay[d.fecha];
      const path =
        e?.status === "done" && e.result && e.result.path.length >= 2
          ? e.result.path
          : d.puntos.map((p) => ({ lat: p.lat, lng: p.lon }));
      return { group: d.fecha, path, color: colors[d.fecha] };
    });
    return { points, paths, colors };
  }, [showPeriodMap, dias, road.byDay, hiddenGroups]);

  return (
    <div className={`space-y-4 transition-opacity ${loading ? "opacity-50" : ""}`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {tiles.map((tile) => (
          <Card key={tile.l}>
            <CardContent className="p-3 sm:p-4">
              <p className={`text-lg sm:text-xl font-bold tabular-nums leading-tight ${tile.cls ?? "text-foreground"}`}>{tile.v}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">{tile.l}</p>
              {tile.d && <p className="text-[11px] text-muted-foreground">{tile.d}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertasCard alertas={data.alertas} />

      <div className="flex items-center gap-2 flex-wrap">
        {road.available ? (
          <button
            onClick={road.runAll}
            disabled={road.running || road.total === 0 || allRoad}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-espert-gold text-white disabled:opacity-60"
            title="Recorrido en auto entre puntos GPS (Google Directions)"
          >
            {road.running ? <Loader2 size={13} className="animate-spin" /> : <Route size={13} />}
            {road.running
              ? `Calculando ${road.done}/${road.total}`
              : allRoad
                ? `Km reales calculados (${road.total} días)`
                : road.done > 0
                  ? `Calcular km reales (${road.done}/${road.total} listos)`
                  : "Calcular km reales del período"}
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">Km en línea recta (sin Google Maps para calcular ruta real)</span>
        )}
        <button
          onClick={() => setShowPeriodMap((s) => !s)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
            showPeriodMap ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          <MapIcon size={13} /> {showPeriodMap ? "Ocultar mapa del período" : "Ver todo el período en el mapa"}
        </button>
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground hover:bg-muted/70 ml-auto"
        >
          <Download size={13} /> Exportar CSV
        </button>
      </div>

      {showPeriodMap && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <RoutePathMap
              points={periodMap.points}
              paths={periodMap.paths}
              height={420}
              colorByDay
              groupColors={periodMap.colors}
              onPdvClick={pdvClick}
              visitHref={vHref}
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="uppercase tracking-wide text-[10px] mr-1">Filtrar:</span>
              {Object.entries(periodMap.colors).map(([f, c]) => {
                const off = hiddenGroups.has(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleGroup(f)}
                    aria-pressed={!off}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border transition-colors ${
                      off ? "opacity-40 line-through border-border" : "border-transparent bg-muted"
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: c }} />
                    {shortDate(f)}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => toggleGroup("__plan")}
                aria-pressed={!hiddenGroups.has("__plan")}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border transition-colors ${
                  hiddenGroups.has("__plan") ? "opacity-40 line-through border-border" : "border-transparent bg-muted"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full inline-block border border-gray-400 bg-white" />
                planificado no visitado
              </button>
              {hiddenGroups.size > 0 && (
                <button type="button" onClick={() => setHiddenGroups(new Set())} className="underline ml-1">
                  mostrar todo
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-2 sm:p-4">
          <h3 className="font-bold text-foreground text-sm mb-2 px-2 sm:px-0">
            Días <span className="text-xs font-semibold text-muted-foreground">({dias.length})</span>
          </h3>
          {dias.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 sm:px-0">Sin actividad en el período.</p>
          ) : (
            dias.map((d) => (
              <DiaRow
                key={d.fecha}
                day={d}
                perimeterM={data.perimeterM}
                road={road.byDay[d.fecha]}
                onComputeRoad={road.runDay}
                roadAvailable={road.available}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
