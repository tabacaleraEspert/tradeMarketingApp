import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { intelligenceApi, type IntelMapResponse } from "@/lib/api";

// Cobre = trabaja Espert · azul = censado sin Espert · gris = sin censo.
const STATUS_COLORS: Record<number, string> = { 2: "#eb6834", 1: "#2a78d6", 0: "#9ca3af" };
const STATUS_LABELS: Array<{ status: number; label: string }> = [
  { status: 2, label: "Trabaja Espert" },
  { status: 1, label: "Censado sin Espert" },
  { status: 0, label: "Sin censo" },
];

/**
 * Mapa de PDVs en canvas puro (proyección equirectangular sobre el bounding
 * box de los puntos). Sin Google Maps: son ~6.500 puntos y acá importa la
 * densidad, no las calles — el canvas los pinta todos en un frame.
 */
export function MapaSection() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<IntelMapResponse | null>(null);
  const [error, setError] = useState(false);
  const [zoneFilter, setZoneFilter] = useState<number | null>(null);

  const load = useCallback(() => {
    setError(false);
    intelligenceApi.map().then(setData).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const zonesWithPoints = useMemo(() => {
    if (!data) return [];
    const ids = new Set(data.puntos.map((p) => p[3]));
    return Object.entries(data.zonas)
      .filter(([id]) => ids.has(Number(id)))
      .map(([id, name]) => ({ id: Number(id), name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const points = zoneFilter == null ? data.puntos : data.puntos.filter((p) => p[3] === zoneFilter);
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 420;
    const cssH = Math.round(cssW * 1.35);
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (points.length === 0) return;

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [, lat, lon] of points) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    const midLat = (minLat + maxLat) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const spanX = Math.max((maxLon - minLon) * kx, 0.01);
    const spanY = Math.max(maxLat - minLat, 0.01);
    const pad = 16;
    const scale = Math.min((cssW - pad * 2) / spanX, (cssH - pad * 2) / spanY);
    const offX = (cssW - spanX * scale) / 2;
    const offY = (cssH - spanY * scale) / 2;
    const project = (lat: number, lon: number): [number, number] => [
      offX + (lon - minLon) * kx * scale,
      offY + (maxLat - lat) * scale,
    ];

    const r = points.length > 2000 ? 1.6 : points.length > 500 ? 2.2 : 3;
    // Los grises abajo, los cobres arriba: que la presencia Espert no quede tapada.
    for (const status of [0, 1, 2]) {
      ctx.fillStyle = STATUS_COLORS[status];
      for (const [, lat, lon, , st] of points) {
        if (st !== status) continue;
        const [x, y] = project(lat, lon);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [data, zoneFilter]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="font-bold text-foreground text-sm">Mapa del censo</h3>
          {data && (
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {STATUS_LABELS.map(({ status, label }) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ background: STATUS_COLORS[status] }}
                  />
                  {label} (
                  {status === 2 ? data.counts.espert : status === 1 ? data.counts.censadoSin : data.counts.sinCenso}
                  )
                </span>
              ))}
            </div>
          )}
        </div>

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
          <div className="grid md:grid-cols-[220px_1fr] gap-4">
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
            <canvas ref={canvasRef} className="w-full rounded-lg bg-muted/30" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
