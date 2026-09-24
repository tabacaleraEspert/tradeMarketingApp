/**
 * Mapa reutilizable de recorrido: markers numerados (círculos) + polyline por
 * el camino real (si se pasa `path`) o en línea recta entre puntos. Encuadre
 * por percentil 3–97 para que un outlier no aleje el zoom.
 *
 * Mismo loader que MapaSection/RouteFocoPage (id + libraries idénticos: si
 * difieren, @react-google-maps tira "Loader must not be called again").
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from "@react-google-maps/api";

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

export function RoutePathMap({ points, paths, height = 320, colorByDay = false, groupColors }: Props) {
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
            title={p.title}
          />
        );
      })}
    </GoogleMap>
  );
}
