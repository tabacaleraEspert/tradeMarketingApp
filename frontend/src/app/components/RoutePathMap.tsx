/**
 * Mapa reutilizable de recorrido: markers numerados (círculos) + polyline por
 * el camino real (si se pasa `path`) o en línea recta entre puntos. Encuadre
 * por percentil 3–97 para que un outlier no aleje el zoom.
 *
 * Mismo loader que MapaSection/RouteFocoPage (id + libraries idénticos: si
 * difieren, @react-google-maps tira "Loader must not be called again").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, InfoWindowF, MarkerF, PolylineF, useJsApiLoader } from "@react-google-maps/api";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const LIBRARIES: ("places")[] = ["places"];

export type RoutePointKind = "in" | "out" | "foto" | "plan";

export interface RoutePoint {
  lat: number;
  lon: number;
  /** Texto dentro del círculo (nº de secuencia). */
  label?: string;
  /** Tooltip. */
  title?: string;
  kind?: RoutePointKind;
  /** Agrupa puntos por día (para `colorByDay`). */
  group?: string;
  /** Datos para el hover (PDV, horario, visita). */
  info?: RoutePointInfo;
}

export interface RoutePointInfo {
  pdvId?: number | null;
  pdvName?: string | null;
  visitId?: number | null;
  /** Hora del punto (HH:MM). */
  time?: string;
  /** Visita: inicio → fin y duración. */
  visitStart?: string | null;
  visitEnd?: string | null;
  durMin?: number | null;
  /** Línea extra (ej: "350 m del PDV", "Planificado no visitado"). */
  note?: string;
}

export interface RoutePath {
  path: Array<{ lat: number; lng: number }>;
  group?: string;
  color?: string;
}

interface Props {
  points: RoutePoint[];
  /**
   * Camino(s) a dibujar. Si no se pasa, se traza una línea recta entre los
   * puntos (no-plan) en orden; con `colorByDay`, una por grupo.
   */
  paths?: RoutePath[];
  height?: string | number;
  /** Colorea cada grupo (día) con una paleta categórica en vez del dorado. */
  colorByDay?: boolean;
  /** Mapa de grupo → color (para mantener consistencia con la leyenda). */
  groupColors?: Record<string, string>;
  /** Link "Ver PDV" del hover (ej: abrir el drill de Inteligencia). */
  onPdvClick?: (pdvId: number) => void;
  /** URL del detalle de la visita/formulario para el hover (se abre en pestaña nueva). */
  visitHref?: (visitId: number) => string;
}

export const GOLD = "#A48242";
const KIND_FILL: Record<RoutePointKind, string> = {
  in: GOLD,
  out: "#64748b",
  foto: "#2a78d6",
  plan: "#ffffff",
};

export const DAY_COLORS = [
  "#A48242", "#2a78d6", "#1baf7a", "#eda100", "#e87ba4", "#9085e9",
  "#e34948", "#00a6a6", "#b5651d", "#7bb662", "#c95181", "#5b8def",
];

/** Color estable por índice de grupo (misma función que usa la leyenda). */
export function colorForIndex(i: number): string {
  return DAY_COLORS[i % DAY_COLORS.length];
}

const MAP_STYLE = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

export function RoutePathMap({ points, paths, height = 320, colorByDay = false, groupColors, onPdvClick, visitHref }: Props) {
  // Hover abre el InfoWindow; click lo deja fijo (para poder tocar los links).
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const showInfo = (i: number) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    setActive(i);
  };
  const hideInfo = () => {
    if (pinned) return;
    hoverTimer.current = window.setTimeout(() => setActive(null), 250);
  };
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: GOOGLE_MAPS_KEY || " ",
    libraries: LIBRARIES,
    preventGoogleFontsLoading: true,
  });
  const mapRef = useRef<google.maps.Map | null>(null);
  const h = typeof height === "number" ? `${height}px` : height;

  const valid = useMemo(() => points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)), [points]);

  const groupColor = useCallback(
    (g: string | undefined): string => {
      if (!colorByDay || !g) return GOLD;
      if (groupColors?.[g]) return groupColors[g];
      const groups = Array.from(new Set(valid.map((p) => p.group).filter(Boolean))) as string[];
      return colorForIndex(Math.max(0, groups.indexOf(g)));
    },
    [colorByDay, groupColors, valid]
  );

  // Polylines: las pasadas, o rectas por grupo entre puntos no-plan.
  const lines = useMemo<RoutePath[]>(() => {
    if (paths && paths.length > 0) return paths;
    const byGroup = new Map<string, Array<{ lat: number; lng: number }>>();
    for (const p of valid) {
      if (p.kind === "plan") continue;
      const g = p.group ?? "";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push({ lat: p.lat, lng: p.lon });
    }
    return Array.from(byGroup.entries()).map(([group, path]) => ({ group, path }));
  }, [paths, valid]);

  const fitTo = useCallback(
    (map: google.maps.Map) => {
      if (valid.length === 0) return;
      if (valid.length === 1) {
        map.setCenter({ lat: valid[0].lat, lng: valid[0].lon });
        map.setZoom(15);
        return;
      }
      const lats = valid.map((p) => p.lat).sort((a, b) => a - b);
      const lons = valid.map((p) => p.lon).sort((a, b) => a - b);
      const q = (arr: number[], t: number) => arr[Math.round((arr.length - 1) * t)];
      const bounds = new google.maps.LatLngBounds(
        { lat: q(lats, 0.03), lng: q(lons, 0.03) },
        { lat: q(lats, 0.97), lng: q(lons, 0.97) }
      );
      map.fitBounds(bounds, 40);
    },
    [valid]
  );

  useEffect(() => {
    if (mapRef.current) fitTo(mapRef.current);
  }, [fitTo]);

  if (!GOOGLE_MAPS_KEY || loadError) {
    return (
      <div className="rounded-xl bg-muted flex items-center justify-center text-xs text-muted-foreground" style={{ height: h }}>
        {loadError ? "Error al cargar el mapa" : "Configurá VITE_GOOGLE_MAPS_API_KEY para ver el mapa"}
      </div>
    );
  }
  if (!isLoaded) {
    return (
      <div className="rounded-xl bg-muted flex items-center justify-center text-xs text-muted-foreground" style={{ height: h }}>
        Cargando mapa...
      </div>
    );
  }
  if (valid.length === 0) {
    return (
      <div className="rounded-xl bg-muted flex items-center justify-center text-xs text-muted-foreground" style={{ height: h }}>
        Sin puntos GPS para mostrar
      </div>
    );
  }

  const center = { lat: valid[0].lat, lng: valid[0].lon };

  return (
    <GoogleMap
      mapContainerStyle={{ width: "100%", height: h, borderRadius: "12px" }}
      center={center}
      zoom={13}
      options={{ disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy", styles: MAP_STYLE }}
      onLoad={(map) => {
        mapRef.current = map;
        fitTo(map);
      }}
      onUnmount={() => {
        mapRef.current = null;
      }}
    >
      {lines.map((l, i) =>
        l.path.length >= 2 ? (
          <PolylineF
            key={`${l.group ?? "p"}-${i}`}
            path={l.path}
            options={{
              strokeColor: l.color ?? groupColor(l.group),
              strokeOpacity: 0.75,
              strokeWeight: 3,
              geodesic: true,
            }}
          />
        ) : null
      )}
      {valid.map((p, i) => {
        const kind = p.kind ?? "in";
        const isPlan = kind === "plan";
        const fill = isPlan ? KIND_FILL.plan : colorByDay ? groupColor(p.group) : KIND_FILL[kind];
        return (
          <MarkerF
            key={`${p.group ?? ""}-${kind}-${i}`}
            position={{ lat: p.lat, lng: p.lon }}
            zIndex={isPlan ? 1 : kind === "foto" ? 2 : 3}
            label={
              p.label
                ? { text: p.label, color: isPlan ? "#6b7280" : "#fff", fontWeight: "bold", fontSize: "11px" }
                : undefined
            }
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: fill,
              fillOpacity: isPlan ? 0.9 : 1,
              strokeColor: isPlan ? "#9ca3af" : "#fff",
              strokeWeight: 2,
              scale: kind === "foto" ? 9 : 13,
            }}
            title={p.info ? undefined : p.title}
            onMouseOver={() => showInfo(i)}
            onMouseOut={hideInfo}
            onClick={() => {
              setPinned((was) => !(was && active === i));
              setActive(i);
            }}
          />
        );
      })}
      {active !== null && valid[active] && (
        <InfoWindowF
          position={{ lat: valid[active].lat, lng: valid[active].lon }}
          options={{ pixelOffset: new google.maps.Size(0, -14), disableAutoPan: !pinned }}
          onCloseClick={() => {
            setPinned(false);
            setActive(null);
          }}
        >
          <div
            className="text-[12px] leading-snug text-gray-800 min-w-[180px] max-w-[240px]"
            onMouseEnter={() => hoverTimer.current && window.clearTimeout(hoverTimer.current)}
            onMouseLeave={hideInfo}
          >
            <PointInfo p={valid[active]} onPdvClick={onPdvClick} visitHref={visitHref} />
          </div>
        </InfoWindowF>
      )}
    </GoogleMap>
  );
}


function PointInfo({
  p,
  onPdvClick,
  visitHref,
}: {
  p: RoutePoint;
  onPdvClick?: (pdvId: number) => void;
  visitHref?: (visitId: number) => string;
}) {
  const info = p.info;
  if (!info) return <div className="font-semibold">{p.title ?? p.label}</div>;
  const dur = info.durMin != null ? `${info.durMin} min` : info.visitEnd ? "" : "abierta";
  const header =
    p.kind === "plan"
      ? "Planificado no visitado"
      : info.visitStart
        ? `${info.visitStart} → ${info.visitEnd ?? "abierta"}${dur ? ` · ${dur}` : ""}`
        : `${(p.kind ?? "in").toUpperCase()} ${info.time ?? ""}`;
  return (
    <div className="space-y-1">
      <div className="font-semibold">
        {p.label ? `#${p.label} · ` : ""}
        {header}
      </div>
      {info.pdvName && (
        <div>
          {info.pdvId != null && onPdvClick ? (
            <button type="button" onClick={() => onPdvClick(info.pdvId!)} className="font-medium underline text-[#A48242]">
              {info.pdvName}
            </button>
          ) : info.pdvId != null ? (
            <a href={`/pos/${info.pdvId}`} target="_blank" rel="noreferrer" className="font-medium underline text-[#A48242]">
              {info.pdvName}
            </a>
          ) : (
            <span className="font-medium">{info.pdvName}</span>
          )}
        </div>
      )}
      {info.visitStart && (
        <div className="text-gray-600">
          Entrada {info.visitStart} · Salida {info.visitEnd ?? "—"}
          {info.durMin != null ? ` · Duración ${info.durMin} min` : ""}
        </div>
      )}
      {info.note && <div className="text-gray-500">{info.note}</div>}
      {info.visitId != null && visitHref && (
        <a href={visitHref(info.visitId)} target="_blank" rel="noreferrer" className="inline-block mt-0.5 underline text-[#A48242]">
          Ver formulario de la visita ↗
        </a>
      )}
    </div>
  );
}
