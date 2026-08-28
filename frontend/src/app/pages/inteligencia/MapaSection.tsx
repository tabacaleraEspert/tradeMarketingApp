import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, InfoWindowF, MarkerF, useJsApiLoader } from "@react-google-maps/api";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { intelligenceApi, type IntelMapResponse } from "@/lib/api";
import { useIntelNav } from "./nav-context";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// Estilo nocturno para que el mapa real no desentone con la app.
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#383838" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#1b1b1b" }] },
];

// Cobre = trabaja Espert · azul = censado sin Espert · gris = sin censo.
const STATUS_COLORS: Record<number, string> = { 2: "#eb6834", 1: "#2a78d6", 0: "#9ca3af" };
const STATUS_KEYS = [
  { status: 2, key: "espert", label: "Trabaja Espert" },
  { status: 1, key: "censadoSin", label: "Censado sin Espert" },
  { status: 0, key: "sinCenso", label: "Sin censo" },
] as const;

// Paleta categórica para rutas (se asigna por orden estable de rutaId).
const RUTA_COLORS = [
  "#eb6834", "#2a78d6", "#1baf7a", "#eda100", "#e87ba4", "#9085e9",
  "#e34948", "#00a6a6", "#b5651d", "#7bb662", "#c95181", "#5b8def",
];

type Pt = [number, number, number, number, number, number, string];

interface View { scale: number; tx: number; ty: number }

/**
 * Mapa de PDVs en canvas: encuadre automático al contenido, zoom con la rueda
 * (centrado en el cursor), pan arrastrando, doble click resetea, hover con
 * ficha del PDV. En la vista de zona colorea por ruta; en la general, por
 * estado del censo con filtro de zonas.
 */
export function MapaSection({ fixedZoneId }: { fixedZoneId?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<IntelMapResponse | null>(null);
  const [error, setError] = useState(false);
  const [zoneFilter, setZoneFilter] = useState<number | null>(fixedZoneId ?? null);
  const [statusOff, setStatusOff] = useState<Set<number>>(new Set());
  const [rutaOff, setRutaOff] = useState<Set<number>>(new Set());
  const [colorBy, setColorBy] = useState<"estado" | "ruta">(fixedZoneId != null ? "ruta" : "estado");
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; p: Pt } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const load = useCallback(() => {
    setError(false);
    intelligenceApi.map().then(setData).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const { isLoaded: gmapsReady, loadError: gmapsError } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: apiKey || " ",
    libraries: ["places"],
    preventGoogleFontsLoading: true,
  });
  // Con una zona elegida hay contexto geográfico que mostrar: mapa REAL con
  // calles. El canvas queda para la vista país (silueta de Argentina) y como
  // fallback sin API key.
  const useGoogle = (fixedZoneId != null || zoneFilter != null) && !!apiKey && gmapsReady && !gmapsError;

  const zonesWithPoints = useMemo(() => {
    if (!data) return [];
    const ids = new Set(data.puntos.map((p) => p[3]));
    return Object.entries(data.zonas)
      .filter(([id]) => ids.has(Number(id)))
      .map(([id, name]) => ({ id: Number(id), name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const points = useMemo(() => {
    if (!data) return [] as Pt[];
    let pts = data.puntos as Pt[];
    if (zoneFilter != null) pts = pts.filter((p) => p[3] === zoneFilter);
    pts = pts.filter((p) => !statusOff.has(p[4]));
    if (colorBy === "ruta") pts = pts.filter((p) => !rutaOff.has(p[5]));
    return pts;
  }, [data, zoneFilter, statusOff, rutaOff, colorBy]);

  // Rutas presentes en el recorte actual (para leyenda/filtro por ruta).
  const rutasPresentes = useMemo(() => {
    if (!data || colorBy !== "ruta") return [];
    const base = zoneFilter != null ? (data.puntos as Pt[]).filter((p) => p[3] === zoneFilter) : (data.puntos as Pt[]);
    const counts = new Map<number, number>();
    base.forEach((p) => counts.set(p[5], (counts.get(p[5]) ?? 0) + 1));
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ id, n, name: id === 0 ? "Sin ruta" : data.rutas[id] ?? `Ruta ${id}` }));
  }, [data, zoneFilter, colorBy]);

  const rutaColor = useCallback(
    (rid: number) => (rid === 0 ? "#6b7280" : RUTA_COLORS[rid % RUTA_COLORS.length]),
    []
  );

  // Default liviano: arrancar con ~6 rutas elegidas para CUBRIR la extensión
  // del mapa (la más grande + las de centroide más lejano entre sí), el resto
  // apagadas — se suman desde la leyenda. Menos markers = mapa fluido.
  const defaultApplied = useRef<string>("");
  useEffect(() => {
    if (!data || colorBy !== "ruta") return;
    const key = `${zoneFilter ?? "all"}`;
    if (defaultApplied.current === key) return;
    defaultApplied.current = key;

    const base = zoneFilter != null ? (data.puntos as Pt[]).filter((p) => p[3] === zoneFilter) : (data.puntos as Pt[]);
    const porRuta = new Map<number, { n: number; lat: number; lon: number }>();
    for (const p of base) {
      const e = porRuta.get(p[5]) ?? { n: 0, lat: 0, lon: 0 };
      e.n += 1; e.lat += p[1]; e.lon += p[2];
      porRuta.set(p[5], e);
    }
    const rutasInfo = [...porRuta.entries()]
      .filter(([id]) => id !== 0)
      .map(([id, e]) => ({ id, n: e.n, lat: e.lat / e.n, lon: e.lon / e.n }));
    if (rutasInfo.length <= 6) {
      setRutaOff(new Set([0])); // pocas rutas: todas prendidas, sin-ruta apagada
      return;
    }
    // Greedy: la más grande primero, después la de centroide más lejano al set.
    const picked = [rutasInfo.reduce((a, b) => (b.n > a.n ? b : a))];
    while (picked.length < 6) {
      let best = null as (typeof rutasInfo)[number] | null;
      let bestD = -1;
      for (const r of rutasInfo) {
        if (picked.some((p) => p.id === r.id)) continue;
        const d = Math.min(...picked.map((p) => (p.lat - r.lat) ** 2 + (p.lon - r.lon) ** 2));
        if (d > bestD) { bestD = d; best = r; }
      }
      if (!best) break;
      picked.push(best);
    }
    const on = new Set(picked.map((p) => p.id));
    setRutaOff(new Set([0, ...rutasInfo.filter((r) => !on.has(r.id)).map((r) => r.id)]));
  }, [data, colorBy, zoneFilter]);

  // Proyección base ROBUSTA: encuadra el percentil 3-97 de los puntos — un PDV
  // con coordenadas malas no puede achicar el cluster real a un puntito. Los
  // outliers quedan fuera del encuadre inicial (se llega paneando).
  const projection = useMemo(() => {
    if (points.length === 0) return null;
    const lats = points.map((p) => p[1]).sort((a, b) => a - b);
    const lons = points.map((p) => p[2]).sort((a, b) => a - b);
    const q = (arr: number[], t: number) => arr[Math.round((arr.length - 1) * t)];
    let minLat = q(lats, 0.03), maxLat = q(lats, 0.97);
    let minLon = q(lons, 0.03), maxLon = q(lons, 0.97);
    // Margen del 10% alrededor del cluster denso.
    const padLat = (maxLat - minLat) * 0.1 || 0.02;
    const padLon = (maxLon - minLon) * 0.1 || 0.02;
    minLat -= padLat; maxLat += padLat;
    minLon -= padLon; maxLon += padLon;
    const midLat = (minLat + maxLat) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const spanX = Math.max((maxLon - minLon) * kx, 0.005);
    const spanY = Math.max(maxLat - minLat, 0.005);
    return { minLat, maxLat, minLon, kx, spanX, spanY, aspect: spanY / spanX };
  }, [points]);

  useEffect(() => { setView({ scale: 1, tx: 0, ty: 0 }); }, [zoneFilter, fixedZoneId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projection) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 420;
    // El alto acompaña la forma de los datos, acotado para no romper el layout.
    const cssH = Math.round(cssW * Math.min(1.35, Math.max(0.45, projection.aspect)));
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const pad = 20;
    const scale0 = Math.min((cssW - pad * 2) / projection.spanX, (cssH - pad * 2) / projection.spanY);
    const offX = (cssW - projection.spanX * scale0) / 2;
    const offY = (cssH - projection.spanY * scale0) / 2;
    const s = scale0 * view.scale;

    const px = (lat: number, lon: number): [number, number] => [
      (offX + (lon - projection.minLon) * projection.kx * scale0) * view.scale + view.tx,
      (offY + (projection.maxLat - lat) * scale0) * view.scale + view.ty,
    ];

    const r = Math.max(1.6, Math.min(5, (points.length > 1500 ? 2 : 3.2) * Math.sqrt(view.scale)));
    // Orden de pintado: grises abajo, cobres arriba (modo estado).
    const orden = colorBy === "estado" ? [0, 1, 2] : [null];
    for (const st of orden) {
      for (const p of points) {
        if (st != null && p[4] !== st) continue;
        const [x, y] = px(p[1], p[2]);
        if (x < -10 || y < -10 || x > cssW + 10 || y > cssH + 10) continue;
        ctx.fillStyle = colorBy === "ruta" ? rutaColor(p[5]) : STATUS_COLORS[p[4]];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Anillo sobre el punto en hover.
    if (hover) {
      const [x, y] = px(hover.p[1], hover.p[2]);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    return { px, cssW, cssH, scale0 };
  }, [points, projection, view, colorBy, rutaColor, hover]);

  useEffect(() => { draw(); }, [draw]);

  // --- Interacción ---------------------------------------------------------
  const toCanvas = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const findNear = useCallback(
    (x: number, y: number): Pt | null => {
      const canvas = canvasRef.current;
      if (!canvas || !projection) return null;
      const cssW = canvas.clientWidth;
      const cssH = parseFloat(canvas.style.height) || canvas.clientHeight;
      const pad = 20;
      const scale0 = Math.min((cssW - pad * 2) / projection.spanX, (cssH - pad * 2) / projection.spanY);
      const offX = (cssW - projection.spanX * scale0) / 2;
      const offY = (cssH - projection.spanY * scale0) / 2;
      let best: Pt | null = null;
      let bestD = 100; // 10px
      for (const p of points) {
        const px = (offX + (p[2] - projection.minLon) * projection.kx * scale0) * view.scale + view.tx;
        const py = (offY + (projection.maxLat - p[1]) * scale0) * view.scale + view.ty;
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    },
    [points, projection, view]
  );

  // Listener nativo no-pasivo: el wheel de React no puede frenar el scroll de
  // la página mientras zoomeás el mapa.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        const scale = Math.min(40, Math.max(1, v.scale * factor));
        const k = scale / v.scale;
        // Zoom centrado en el cursor.
        return { scale, tx: x - (x - v.tx) * k, ty: y - (y - v.ty) * k };
      });
    };
    canvas.addEventListener("wheel", onWheelNative, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheelNative);
  }, [data]);
  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { ...toCanvas(e), moved: false };
  };
  // El pan acumula el delta y actualiza una vez por frame (rAF): arrastrar no
  // dispara un render por cada pixel de movimiento.
  const panPending = useRef<{ dx: number; dy: number; raf: number | null }>({ dx: 0, dy: 0, raf: null });
  const onMouseMove = (e: React.MouseEvent) => {
    const pos = toCanvas(e);
    if (drag.current) {
      const dx = pos.x - drag.current.x;
      const dy = pos.y - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
      drag.current = { ...pos, moved: drag.current.moved };
      panPending.current.dx += dx;
      panPending.current.dy += dy;
      if (panPending.current.raf == null) {
        panPending.current.raf = requestAnimationFrame(() => {
          const { dx: pdx, dy: pdy } = panPending.current;
          panPending.current = { dx: 0, dy: 0, raf: null };
          setView((v) => ({ ...v, tx: v.tx + pdx, ty: v.ty + pdy }));
        });
      }
      setHover(null);
      return;
    }
    const p = findNear(pos.x, pos.y);
    setHover(p ? { x: pos.x, y: pos.y, p } : null);
  };
  const endDrag = () => { drag.current = null; };
  const onDoubleClick = () => setView({ scale: 1, tx: 0, ty: 0 });

  const toggleStatus = (st: number) =>
    setStatusOff((prev) => {
      const next = new Set(prev);
      if (next.has(st)) next.delete(st);
      else next.add(st);
      return next;
    });
  const toggleRuta = (rid: number) =>
    setRutaOff((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h3 className="font-bold text-foreground text-sm">¿Dónde estamos parados?</h3>
          <div className="flex items-center gap-2 flex-wrap">
            {fixedZoneId != null && (
              <div className="inline-flex rounded-full overflow-hidden border border-border text-[11px] font-semibold">
                <button
                  onClick={() => setColorBy("ruta")}
                  className={`px-2.5 py-1 ${colorBy === "ruta" ? "bg-espert-gold text-white" : "text-muted-foreground hover:bg-muted"}`}
                >
                  Por ruta
                </button>
                <button
                  onClick={() => setColorBy("estado")}
                  className={`px-2.5 py-1 ${colorBy === "estado" ? "bg-espert-gold text-white" : "text-muted-foreground hover:bg-muted"}`}
                >
                  Por estado
                </button>
              </div>
            )}
            {data && colorBy === "estado" && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {STATUS_KEYS.map(({ status, key, label }) => {
                  const off = statusOff.has(status);
                  return (
                    <button
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-colors ${off ? "opacity-40 line-through" : "hover:bg-muted"}`}
                    >
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS[status] }} />
                      {label} ({data.counts[key]})
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Rueda para hacer zoom, arrastrá para moverte, doble click resetea. Pasá el mouse por un punto para ver el PDV.
        </p>

        {error && (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-muted-foreground">No se pudo cargar el mapa.</p>
            <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
              <RefreshCw size={12} /> Reintentar
            </button>
          </div>
        )}
        {!error && !data && (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {data && (
          <div className={fixedZoneId != null ? "" : "grid md:grid-cols-[210px_1fr] gap-4"}>
            {fixedZoneId == null && (
              <div className="flex md:flex-col flex-wrap gap-1.5 content-start">
                <button
                  onClick={() => setZoneFilter(null)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold text-left ${zoneFilter == null ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
                >
                  Todas las zonas
                </button>
                {zonesWithPoints.map((z) => (
                  <button
                    key={z.id}
                    onClick={() => setZoneFilter(z.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold text-left ${zoneFilter === z.id ? "bg-espert-gold text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
                  >
                    {z.name}
                  </button>
                ))}
              </div>
            )}

            {useGoogle ? (
              <ZonaGoogleMap
                points={points}
                colorBy={colorBy}
                rutaColor={rutaColor}
                rutas={data.rutas}
              />
            ) : (
            <div className="relative">
              <canvas
                ref={canvasRef}
                className={`w-full rounded-lg bg-muted/30 ${drag.current ? "cursor-grabbing" : hover ? "cursor-pointer" : "cursor-grab"}`}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={() => { endDrag(); setHover(null); }}
                onDoubleClick={onDoubleClick}
              />
              {hover && (
                <div
                  className="absolute z-30 pointer-events-none rounded-lg border border-border bg-card shadow-lg px-3 py-2 text-xs max-w-[220px]"
                  style={{
                    left: Math.min(hover.x + 12, (canvasRef.current?.clientWidth ?? 300) - 200),
                    top: hover.y + 12,
                  }}
                >
                  <p className="font-semibold text-foreground truncate">{hover.p[6]}</p>
                  <p className="text-muted-foreground">
                    {hover.p[5] !== 0 ? data.rutas[hover.p[5]] ?? "" : "Sin ruta"}
                  </p>
                  <p style={{ color: STATUS_COLORS[hover.p[4]] }}>
                    {STATUS_KEYS.find((s) => s.status === hover.p[4])?.label}
                  </p>
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {useGoogle === false && fixedZoneId != null && apiKey == null && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Configurá VITE_GOOGLE_MAPS_API_KEY para ver el mapa con calles.
          </p>
        )}

        {/* Leyenda/filtro de rutas (modo por ruta) */}
        {data && colorBy === "ruta" && rutasPresentes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3 text-xs items-center">
            <button
              onClick={() => setRutaOff(new Set())}
              className="px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:bg-muted font-semibold"
            >
              Todas
            </button>
            <button
              onClick={() => setRutaOff(new Set(rutasPresentes.map((r) => r.id)))}
              className="px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:bg-muted font-semibold"
            >
              Ninguna
            </button>
            {rutasPresentes.map((r) => {
              const off = rutaOff.has(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => toggleRuta(r.id)}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-colors ${off ? "opacity-40 line-through" : "hover:bg-muted"}`}
                >
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: rutaColor(r.id) }} />
                  {r.name} ({r.n})
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Mapa real (Google) para la vista de zona: calles debajo de los puntos,
 * encuadre robusto (percentil 3-97), hover/click con ficha del PDV. */
function ZonaGoogleMap({
  points, colorBy, rutaColor, rutas,
}: {
  points: Pt[];
  colorBy: "estado" | "ruta";
  rutaColor: (rid: number) => string;
  rutas: Record<string, string>;
}) {
  const [selected, setSelected] = useState<Pt | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const onSelect = useCallback((p: Pt) => setSelected(p), []);

  // Tope de markers por fluidez: si el recorte supera el máximo se muestra una
  // muestra pareja (1 de cada k) — prendé menos rutas para ver el detalle.
  const MAX_MARKERS = 1200;
  const shown = useMemo(() => {
    if (points.length <= MAX_MARKERS) return points;
    const k = Math.ceil(points.length / MAX_MARKERS);
    return points.filter((_, i) => i % k === 0);
  }, [points]);

  const fitTo = useCallback((map: google.maps.Map) => {
    if (points.length === 0) return;
    const lats = points.map((p) => p[1]).sort((a, b) => a - b);
    const lons = points.map((p) => p[2]).sort((a, b) => a - b);
    const q = (arr: number[], t: number) => arr[Math.round((arr.length - 1) * t)];
    const bounds = new google.maps.LatLngBounds(
      { lat: q(lats, 0.03), lng: q(lons, 0.03) },
      { lat: q(lats, 0.97), lng: q(lons, 0.97) }
    );
    map.fitBounds(bounds, 40);
  }, [points]);

  useEffect(() => {
    if (mapRef.current) fitTo(mapRef.current);
  }, [fitTo]);

  return (
    <GoogleMap
      mapContainerStyle={{ width: "100%", height: "520px", borderRadius: "12px" }}
      options={{
        styles: DARK_MAP_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
        backgroundColor: "#1b1b1b",
        clickableIcons: false,
      }}
      onLoad={(map) => {
        mapRef.current = map;
        fitTo(map);
      }}
      onClick={() => setSelected(null)}
    >
      <MarkerLayer points={shown} colorBy={colorBy} rutaColor={rutaColor} onSelect={onSelect} />
      {selected && (
        <InfoWindowF
          position={{ lat: selected[1], lng: selected[2] }}
          onCloseClick={() => setSelected(null)}
          options={{ pixelOffset: new google.maps.Size(0, -8) }}
        >
          <InfoContent p={selected} rutas={rutas} />
        </InfoWindowF>
      )}
    </GoogleMap>
  );
}

/** Capa de markers memoizada: el hover/selección NO re-renderiza los cientos
 * de puntos — solo cambia el InfoWindow de arriba. Iconos cacheados por color. */
const MarkerLayer = memo(function MarkerLayer({
  points, colorBy, rutaColor, onSelect,
}: {
  points: Pt[];
  colorBy: "estado" | "ruta";
  rutaColor: (rid: number) => string;
  onSelect: (p: Pt) => void;
}) {
  const iconCache = useMemo(() => new Map<string, google.maps.Symbol>(), []);
  const iconFor = (color: string): google.maps.Symbol => {
    let icon = iconCache.get(color);
    if (!icon) {
      icon = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 5.5,
        fillColor: color,
        fillOpacity: 0.95,
        strokeColor: "#141310",
        strokeWeight: 1,
      };
      iconCache.set(color, icon);
    }
    return icon;
  };
  return (
    <>
      {points.map((p) => (
        <MarkerF
          key={p[0]}
          position={{ lat: p[1], lng: p[2] }}
          icon={iconFor(colorBy === "ruta" ? rutaColor(p[5]) : STATUS_COLORS[p[4]])}
          title={p[6]}
          onMouseOver={() => onSelect(p)}
          onClick={() => onSelect(p)}
        />
      ))}
    </>
  );
});

/** Contenido del InfoWindow con acceso a la navegación (ficha del PDV). */
function InfoContent({ p, rutas }: { p: Pt; rutas: Record<string, string> }) {
  const { openPdv } = useIntelNav();
  return (
    <div className="text-xs text-neutral-900 pr-1">
      <p className="font-bold">{p[6]}</p>
      <p>{p[5] !== 0 ? rutas[p[5]] ?? "" : "Sin ruta"}</p>
      <p style={{ color: STATUS_COLORS[p[4]] }}>
        {STATUS_KEYS.find((s) => s.status === p[4])?.label}
      </p>
      <button
        onClick={() => openPdv(p[0])}
        className="mt-1 font-bold text-[#A48242] hover:underline"
      >
        Ver ficha →
      </button>
    </div>
  );
}
