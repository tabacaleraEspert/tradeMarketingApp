/**
 * Km reales por calle de un día con Google Directions (JS API, misma key del
 * mapa). Backend devuelve `kmLinea` (haversine); acá lo reemplazamos por el
 * recorrido en auto entre los puntos GPS del día y cacheamos en localStorage
 * por (usuario, fecha, hash de coordenadas) para no repagar requests.
 *
 * Directions admite ≤25 waypoints por request: secuencias más largas se parten
 * en tramos encadenados (el destino de uno es el origen del siguiente) y se
 * suman.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJsApiLoader } from "@react-google-maps/api";
import type { IntelBehaviorDia } from "@/lib/api";

export const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
/** Mismas opciones que MapaSection/RouteFocoPage: si difieren, el loader tira. */
export const GMAPS_LOADER_ID = "google-map-script-places";
export const GMAPS_LIBRARIES: ("places")[] = ["places"];

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoadKmResult {
  kmRuta: number;
  path: LatLng[];
}

export type RoadKmStatus = "idle" | "loading" | "done" | "error" | "unavailable";

export interface RoadKmEntry {
  status: RoadKmStatus;
  result?: RoadKmResult;
}

const MAX_WAYPOINTS = 25;
const STORAGE_PREFIX = "espert.roadkm.v1";

/** Coordenadas del día, sin duplicados consecutivos (IN/OUT en el mismo PDV). */
export function dedupeCoords(day: Pick<IntelBehaviorDia, "puntos">): LatLng[] {
  const out: LatLng[] = [];
  for (const p of day.puntos) {
    if (p.lat == null || p.lon == null) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.lat - p.lat) < 1e-6 && Math.abs(last.lng - p.lon) < 1e-6) continue;
    out.push({ lat: p.lat, lng: p.lon });
  }
  return out;
}

/** Hash chico y estable (djb2) de las coordenadas: cambia si cambian los puntos. */
export function coordsHash(coords: LatLng[]): string {
  let h = 5381;
  const s = coords.map((c) => `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`).join(";");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function storageKey(userId: number, fecha: string, coords: LatLng[]): string {
  return `${STORAGE_PREFIX}.${userId}.${fecha}.${coordsHash(coords)}`;
}

function readStored(key: string): RoadKmResult | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as RoadKmResult;
    if (typeof v.kmRuta !== "number" || !Array.isArray(v.path)) return null;
    return v;
  } catch {
    return null;
  }
}

function writeStored(key: string, v: RoadKmResult): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage lleno o bloqueado: seguimos sin cache */
  }
}

/** Parte [a,b,c,...] en tramos de ≤ MAX_WAYPOINTS+2 puntos encadenados por el último. */
export function chunkCoords(coords: LatLng[], maxWaypoints = MAX_WAYPOINTS): LatLng[][] {
  const per = maxWaypoints + 2; // origen + waypoints + destino
  if (coords.length <= per) return [coords];
  const chunks: LatLng[][] = [];
  let i = 0;
  while (i < coords.length - 1) {
    const end = Math.min(i + per, coords.length);
    chunks.push(coords.slice(i, end));
    i = end - 1;
  }
  return chunks;
}

function routeChunk(svc: google.maps.DirectionsService, chunk: LatLng[]): Promise<RoadKmResult> {
  return new Promise((resolve, reject) => {
    svc.route(
      {
        origin: chunk[0],
        destination: chunk[chunk.length - 1],
        waypoints: chunk.slice(1, -1).map((c) => ({ location: c, stopover: true })),
        travelMode: google.maps.TravelMode.DRIVING,
        optimizeWaypoints: false,
      },
      (res, status) => {
        if (status !== google.maps.DirectionsStatus.OK || !res?.routes?.[0]) {
          reject(new Error(`Directions ${status}`));
          return;
        }
        const route = res.routes[0];
        const meters = route.legs.reduce((s, l) => s + (l.distance?.value ?? 0), 0);
        const path = (route.overview_path ?? []).map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
        resolve({ kmRuta: meters / 1000, path });
      }
    );
  });
}

/**
 * Km por calle de un día. Devuelve null si no hay al menos 2 puntos distintos.
 * Requiere `google.maps` cargado (el hook lo garantiza).
 */
export async function computeRoadKm(userId: number, day: IntelBehaviorDia): Promise<RoadKmResult | null> {
  const coords = dedupeCoords(day);
  if (coords.length < 2) return null;
  const key = storageKey(userId, day.fecha, coords);
  const cached = readStored(key);
  if (cached) return cached;

  const svc = new google.maps.DirectionsService();
  const parts: RoadKmResult[] = [];
  for (const chunk of chunkCoords(coords)) {
    parts.push(await routeChunk(svc, chunk));
  }
  const result: RoadKmResult = {
    kmRuta: Math.round(parts.reduce((s, p) => s + p.kmRuta, 0) * 100) / 100,
    path: parts.flatMap((p) => p.path),
  };
  writeStored(key, result);
  return result;
}

export interface UseRoadKm {
  /** Estado por fecha (yyyy-mm-dd). */
  byDay: Record<string, RoadKmEntry>;
  /** Google disponible (key + script cargado). */
  available: boolean;
  running: boolean;
  done: number;
  total: number;
  /** Calcula todos los días con puntos (los cacheados resuelven al toque). */
  runAll: () => void;
  /** Calcula un solo día. */
  runDay: (fecha: string) => void;
}

/**
 * Orquesta el cálculo de km reales para los días de un período. `enabled=false`
 * no dispara nada (la pestaña no montada). Al cambiar `days` (otro rango) el
 * estado se resetea, y los días ya cacheados en localStorage se hidratan solos.
 */
export function useRoadKm(userId: number, days: IntelBehaviorDia[], enabled: boolean): UseRoadKm {
  const { isLoaded, loadError } = useJsApiLoader({
    id: GMAPS_LOADER_ID,
    googleMapsApiKey: GOOGLE_MAPS_KEY || " ",
    libraries: GMAPS_LIBRARIES,
    preventGoogleFontsLoading: true,
  });
  const available = !!GOOGLE_MAPS_KEY && isLoaded && !loadError;
  const [byDay, setByDay] = useState<Record<string, RoadKmEntry>>({});
  const [running, setRunning] = useState(false);
  const daysRef = useRef(days);
  daysRef.current = days;

  const eligible = useMemo(() => days.filter((d) => dedupeCoords(d).length >= 2), [days]);

  // Hidratación desde localStorage al cambiar el período (sin llamar a Google).
  useEffect(() => {
    if (!enabled) return;
    const next: Record<string, RoadKmEntry> = {};
    for (const d of eligible) {
      const coords = dedupeCoords(d);
      const cached = readStored(storageKey(userId, d.fecha, coords));
      next[d.fecha] = cached ? { status: "done", result: cached } : { status: available ? "idle" : "unavailable" };
    }
    setByDay(next);
  }, [userId, eligible, enabled, available]);

  const runDays = useCallback(
    async (fechas: string[]) => {
      if (!available) return;
      const targets = daysRef.current.filter((d) => fechas.includes(d.fecha));
      if (targets.length === 0) return;
      setRunning(true);
      setByDay((prev) => {
        const n = { ...prev };
        for (const d of targets) if (n[d.fecha]?.status !== "done") n[d.fecha] = { status: "loading" };
        return n;
      });
      for (const d of targets) {
        try {
          const r = await computeRoadKm(userId, d);
          setByDay((prev) => ({ ...prev, [d.fecha]: r ? { status: "done", result: r } : { status: "unavailable" } }));
        } catch {
          setByDay((prev) => ({ ...prev, [d.fecha]: { status: "error" } }));
        }
      }
      setRunning(false);
    },
    [available, userId]
  );

  const runAll = useCallback(() => {
    void runDays(eligible.filter((d) => byDay[d.fecha]?.status !== "done").map((d) => d.fecha));
  }, [eligible, byDay, runDays]);
  const runDay = useCallback((fecha: string) => void runDays([fecha]), [runDays]);

  const done = eligible.filter((d) => byDay[d.fecha]?.status === "done").length;
  return { byDay, available, running, done, total: eligible.length, runAll, runDay };
}
