import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Modal } from "../../components/ui/modal";
import {
  Plus,
  MapPin,
  Calendar,
  Edit,
  Trash2,
  Map as MapIcon,
  List,
  User,
  Clock,
  Repeat,
  ChevronRight,
} from "lucide-react";
import { useApiList, routesApi, useZones, useUsers, useForms, BEJERMAN_ZONES } from "@/lib/api";
import { api } from "@/lib/api/client";
import { useJsApiLoader, GoogleMap, MarkerF, PolylineF, PolygonF } from "@react-google-maps/api";
import { toast } from "sonner";
import { getCurrentUser } from "../../lib/auth";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const LIBRARIES: ("places")[] = ["places"];

// 12 distinct colors for routes
const ROUTE_COLORS = [
  "#A48242", "#2563eb", "#dc2626", "#16a34a", "#9333ea",
  "#ea580c", "#0891b2", "#c026d3", "#4f46e5", "#ca8a04",
  "#059669", "#e11d48",
];

// Convex hull (Graham scan) to create coverage polygon
function convexHull(points: { lat: number; lng: number }[]): { lat: number; lng: number }[] {
  if (points.length < 3) return points;

  const pts = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat);

  const cross = (o: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  const lower: { lat: number; lng: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  const upper: { lat: number; lng: number }[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Expand hull outward by a margin (in degrees, ~0.002 ≈ 200m)
function expandHull(hull: { lat: number; lng: number }[], margin = 0.003): { lat: number; lng: number }[] {
  if (hull.length < 3) return hull;
  // Compute centroid
  const cx = hull.reduce((s, p) => s + p.lat, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.lng, 0) / hull.length;

  return hull.map((p) => {
    const dx = p.lat - cx;
    const dy = p.lng - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      lat: p.lat + (dx / dist) * margin,
      lng: p.lng + (dy / dist) * margin,
    };
  });
}

interface MapRoutePdv {
  pdvId: number;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  channel: string;
  sortOrder: number;
}

interface MapRoute {
  routeId: number;
  name: string;
  assignedUserName: string | null;
  bejermanZone: string | null;
  frequencyType: string | null;
  frequencyConfig: string | null;
  pdvs: MapRoutePdv[];
}

function formatFrequency(type: string | null, config: string | null): string {
  if (!type) return "Sin definir";
  switch (type) {
    case "daily": return "Diaria";
    case "weekly": return "Semanal";
    case "biweekly": return "Quincenal";
    case "monthly": return "Mensual";
    case "specific_days": {
      try {
        const days = JSON.parse(config || "{}").days || [];
        const labels = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        return days.length > 0 ? days.map((d: number) => labels[d]).join(", ") : "Sin días";
      } catch { return "Días específicos"; }
    }
    case "every_x_days": {
      try {
        const interval = JSON.parse(config || "{}").interval || 15;
        return `Cada ${interval} días`;
      } catch { return "Cada X días"; }
    }
    default: return type;
  }
}

export function RouteManagement() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const canDelete = ["admin", "regional_manager", "territory_manager"].includes(currentUser.role);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formZoneId, setFormZoneId] = useState<number | "">("");
  const [formFormId, setFormFormId] = useState<number | "">("");
  const [formBejermanZone, setFormBejermanZone] = useState("");
  const [formEstimatedMinutes, setFormEstimatedMinutes] = useState<number | "">("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [mapRoutes, setMapRoutes] = useState<MapRoute[]>([]);
  const [unroutedPdvs, setUnroutedPdvs] = useState<MapRoutePdv[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  // Map filters
  const [mapFilterTM, setMapFilterTM] = useState<string>("all");
  const [mapFilterZone, setMapFilterZone] = useState<string>("all");
  const [mapFilterFreq, setMapFilterFreq] = useState<string>("all");
  const [hiddenRoutes, setHiddenRoutes] = useState<Set<number>>(new Set());
  const [showUnrouted, setShowUnrouted] = useState(true);
  const [showPolygons, setShowPolygons] = useState(true);
  const [showLines, setShowLines] = useState(true);

  const { data: routes, loading, refetch } = useApiList(() => routesApi.list());
  const { data: zones } = useZones();
  const { data: users } = useUsers();
  const { data: forms } = useForms();

  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: GOOGLE_MAPS_KEY || " ",
    libraries: LIBRARIES,
    preventGoogleFontsLoading: true,
  });

  // Load map data
  useEffect(() => {
    if (viewMode === "map") {
      setMapLoading(true);
      api.get<{ routes: MapRoute[]; unroutedPdvs: MapRoutePdv[] }>("/routes/map-overview")
        .then((data) => {
          setMapRoutes(data.routes);
          setUnroutedPdvs(data.unroutedPdvs);
        })
        .catch(() => toast.error("Error al cargar datos del mapa"))
        .finally(() => setMapLoading(false));
    }
  }, [viewMode, routes]);

  // Color map for routes
  const routeColorMap = useMemo(() => {
    const map = new Map<number, string>();
    mapRoutes.forEach((r, i) => {
      map.set(r.routeId, ROUTE_COLORS[i % ROUTE_COLORS.length]);
    });
    return map;
  }, [mapRoutes]);

  // Unique TM names and zones for filters
  const uniqueTMs = useMemo(() => {
    const names = new Set<string>();
    mapRoutes.forEach((r) => { if (r.assignedUserName) names.add(r.assignedUserName); });
    return Array.from(names).sort();
  }, [mapRoutes]);

  const uniqueZones = useMemo(() => {
    const z = new Set<string>();
    mapRoutes.forEach((r) => { if (r.bejermanZone) z.add(r.bejermanZone); });
    return Array.from(z).sort();
  }, [mapRoutes]);

  // Filtered routes
  const visibleRoutes = useMemo(() => {
    return mapRoutes.filter((r) => {
      if (hiddenRoutes.has(r.routeId)) return false;
      if (mapFilterTM !== "all" && r.assignedUserName !== mapFilterTM) return false;
      if (mapFilterZone !== "all" && r.bejermanZone !== mapFilterZone) return false;
      if (mapFilterFreq !== "all" && r.frequencyType !== mapFilterFreq) return false;
      return true;
    });
  }, [mapRoutes, hiddenRoutes, mapFilterTM, mapFilterZone, mapFilterFreq]);

  const toggleRouteVisibility = (routeId: number) => {
    setHiddenRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  // All PDVs with coords for map center
  const allMapPdvs = useMemo(() => {
    return mapRoutes.flatMap((r) =>
      r.pdvs.filter((p) => p.lat != null && p.lon != null)
    );
  }, [mapRoutes]);

  const mapCenter = useMemo(() => {
    if (allMapPdvs.length === 0) return { lat: -34.6, lng: -58.45 };
    const lat = allMapPdvs.reduce((s, p) => s + p.lat!, 0) / allMapPdvs.length;
    const lng = allMapPdvs.reduce((s, p) => s + p.lon!, 0) / allMapPdvs.length;
    return { lat, lng };
  }, [allMapPdvs]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Gestión de Rutas Foco</h1>
          <p className="text-muted-foreground">Asignar PDV a usuarios y configurar frecuencias</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-[#A48242] text-white"
                  : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              <List size={16} />
              Lista
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === "map"
                  ? "bg-[#A48242] text-white"
                  : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              <MapIcon size={16} />
              Mapa
            </button>
          </div>
          <Button
            onClick={() => {
              setIsCreateModalOpen(true);
              setSelectedRouteId(null);
              setFormName("");
              setFormZoneId("");
              setFormFormId("");
              setFormBejermanZone("");
              setFormEstimatedMinutes("");
              setFormIsActive(true);
            }}
            className="gap-2"
          >
            <Plus size={20} />
            Nueva Ruta
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Rutas Activas</p>
            <p className="text-3xl font-bold text-espert-gold">
              {routes.filter((r) => r.IsActive).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Total PDV en Rutas</p>
            <p className="text-3xl font-bold text-green-600">
              {routes.reduce((acc, r) => acc + (r.PdvCount ?? 0), 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Total Rutas</p>
            <p className="text-3xl font-bold text-espert-gold">{routes.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Promedio PDV/Ruta</p>
            <p className="text-3xl font-bold text-muted-foreground">
              {routes.length > 0
                ? Math.round(
                    routes.reduce((acc, r) => acc + (r.PdvCount ?? 0), 0) / routes.length
                  )
                : 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Map View */}
      {viewMode === "map" && (
        <div className="space-y-4">
          {/* Map Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Trade Marketer</label>
                  <select
                    className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                    value={mapFilterTM}
                    onChange={(e) => setMapFilterTM(e.target.value)}
                  >
                    <option value="all">Todos</option>
                    {uniqueTMs.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Zona</label>
                  <select
                    className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                    value={mapFilterZone}
                    onChange={(e) => setMapFilterZone(e.target.value)}
                  >
                    <option value="all">Todas</option>
                    {uniqueZones.map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Frecuencia</label>
                  <select
                    className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                    value={mapFilterFreq}
                    onChange={(e) => setMapFilterFreq(e.target.value)}
                  >
                    <option value="all">Todas</option>
                    <option value="daily">Diaria</option>
                    <option value="specific_days">Días específicos</option>
                    <option value="weekly">Semanal</option>
                    <option value="every_x_days">Cada X días</option>
                    <option value="biweekly">Quincenal</option>
                    <option value="monthly">Mensual</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={showPolygons} onChange={(e) => setShowPolygons(e.target.checked)} className="rounded" />
                    Zonas de cobertura
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} className="rounded" />
                    Líneas de ruta
                  </label>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={showUnrouted} onChange={(e) => setShowUnrouted(e.target.checked)} className="rounded" />
                    PDVs sin ruta ({unroutedPdvs.length})
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {visibleRoutes.length} de {mapRoutes.length} rutas
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Map + Legend side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            <Card>
              <CardContent className="p-3">
                {mapLoading || !mapsLoaded || !GOOGLE_MAPS_KEY ? (
                  <div className="flex items-center justify-center py-20 text-muted-foreground">
                    {mapLoading ? "Cargando mapa..." : "Configurar Google Maps API Key"}
                  </div>
                ) : (
                  <GoogleMap
                    mapContainerStyle={{ width: "100%", height: "600px", borderRadius: "0.5rem" }}
                    center={mapCenter}
                    zoom={12}
                    options={{
                      disableDefaultUI: false,
                      zoomControl: true,
                      streetViewControl: false,
                      mapTypeControl: false,
                      styles: [
                        { featureType: "poi", stylers: [{ visibility: "off" }] },
                        { featureType: "transit", stylers: [{ visibility: "off" }] },
                      ],
                    }}
                  >
                    {/* Unrouted PDVs */}
                    {showUnrouted && unroutedPdvs.map((p) => (
                      <MarkerF
                        key={`unrouted-${p.pdvId}`}
                        position={{ lat: p.lat!, lng: p.lon! }}
                        icon={{
                          path: google.maps.SymbolPath.CIRCLE,
                          fillColor: "#9ca3af",
                          fillOpacity: 0.4,
                          strokeColor: "#fff",
                          strokeWeight: 1,
                          scale: 6,
                        }}
                        title={`SIN RUTA: ${p.name} — ${p.address}`}
                      />
                    ))}

                    {/* Routes */}
                    {visibleRoutes.map((route) => {
                      const color = routeColorMap.get(route.routeId) || "#A48242";
                      const pdvsWithCoords = route.pdvs.filter((p) => p.lat != null && p.lon != null);
                      const pts = pdvsWithCoords.map((p) => ({ lat: p.lat!, lng: p.lon! }));
                      const hull = pts.length >= 3 ? expandHull(convexHull(pts)) : pts;

                      return (
                        <span key={route.routeId}>
                          {showPolygons && hull.length >= 3 && (
                            <PolygonF
                              paths={hull}
                              options={{
                                fillColor: color,
                                fillOpacity: 0.15,
                                strokeColor: color,
                                strokeOpacity: 0.6,
                                strokeWeight: 2,
                              }}
                            />
                          )}
                          {showLines && pts.length >= 2 && (
                            <PolylineF
                              path={pts}
                              options={{
                                strokeColor: color,
                                strokeOpacity: 0.7,
                                strokeWeight: 2,
                              }}
                            />
                          )}
                          {pdvsWithCoords.map((p, idx) => (
                            <MarkerF
                              key={`${route.routeId}-${p.pdvId}`}
                              position={{ lat: p.lat!, lng: p.lon! }}
                              label={{
                                text: String(idx + 1),
                                color: "#fff",
                                fontWeight: "bold",
                                fontSize: "11px",
                              }}
                              icon={{
                                path: google.maps.SymbolPath.CIRCLE,
                                fillColor: color,
                                fillOpacity: 1,
                                strokeColor: "#fff",
                                strokeWeight: 2,
                                scale: 13,
                              }}
                              title={`${route.name} → #${idx + 1} ${p.name}`}
                            />
                          ))}
                        </span>
                      );
                    })}
                  </GoogleMap>
                )}
              </CardContent>
            </Card>

            {/* Legend Panel */}
            <Card>
              <CardContent className="p-4">
                <h4 className="text-sm font-semibold text-foreground mb-3">Rutas ({visibleRoutes.length})</h4>
                <div className="space-y-1 max-h-[520px] overflow-y-auto">
                  {mapRoutes.map((route) => {
                    const color = routeColorMap.get(route.routeId) || "#A48242";
                    const pdvCount = route.pdvs.filter((p) => p.lat != null).length;
                    const isVisible = visibleRoutes.some((r) => r.routeId === route.routeId);
                    const isFilteredOut = !isVisible && !hiddenRoutes.has(route.routeId);

                    return (
                      <div
                        key={route.routeId}
                        className={`flex items-center gap-2 p-2 rounded-lg text-sm transition-colors ${
                          isFilteredOut ? "opacity-30" : "hover:bg-muted/50"
                        }`}
                      >
                        <button
                          onClick={() => toggleRouteVisibility(route.routeId)}
                          disabled={isFilteredOut}
                          className="shrink-0"
                        >
                          <span
                            className={`w-3.5 h-3.5 rounded-full inline-block border-2 ${
                              hiddenRoutes.has(route.routeId) ? "border-gray-300 bg-transparent" : ""
                            }`}
                            style={!hiddenRoutes.has(route.routeId) ? { backgroundColor: color, borderColor: color } : undefined}
                          />
                        </button>
                        <button
                          onClick={() => navigate(`/admin/routes/${route.routeId}/edit`)}
                          className="flex-1 text-left min-w-0"
                        >
                          <p className="font-medium text-foreground truncate text-xs">{route.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {route.assignedUserName || "Sin TM"} · {pdvCount} PDVs
                          </p>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Coverage stats */}
                <div className="mt-4 pt-3 border-t border-border space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase">Cobertura</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-green-50 rounded-lg p-2 text-center">
                      <p className="text-lg font-bold text-green-700">
                        {mapRoutes.reduce((s, r) => s + r.pdvs.filter((p) => p.lat).length, 0)}
                      </p>
                      <p className="text-green-600">En ruta</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-2 text-center">
                      <p className="text-lg font-bold text-red-600">{unroutedPdvs.length}</p>
                      <p className="text-red-500">Sin ruta</p>
                    </div>
                  </div>
                  {(unroutedPdvs.length + mapRoutes.reduce((s, r) => s + r.pdvs.length, 0)) > 0 && (
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{
                          width: `${Math.round(
                            (mapRoutes.reduce((s, r) => s + r.pdvs.length, 0) /
                              (mapRoutes.reduce((s, r) => s + r.pdvs.length, 0) + unroutedPdvs.length)) *
                              100
                          )}%`,
                        }}
                      />
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground text-center">
                    {Math.round(
                      (mapRoutes.reduce((s, r) => s + r.pdvs.length, 0) /
                        Math.max(1, mapRoutes.reduce((s, r) => s + r.pdvs.length, 0) + unroutedPdvs.length)) *
                        100
                    )}% de PDVs con ruta asignada
                  </p>

                  {showUnrouted && unroutedPdvs.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-gray-400/50 inline-block" />
                      <span className="text-[10px] text-muted-foreground">
                        Puntos grises = sin ruta
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Routes List */}
      {viewMode === "list" && (
        <>
          {loading && (
            <p className="text-muted-foreground">Cargando rutas...</p>
          )}
          <Card>
            <CardContent className="p-0">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_140px_140px_120px_80px_100px_60px] gap-3 px-4 py-3 border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <span>Ruta</span>
                <span>Trade Marketer</span>
                <span>Frecuencia</span>
                <span>Zona</span>
                <span className="text-center">PDVs</span>
                <span>Tiempo</span>
                <span></span>
              </div>

              {/* Rows */}
              {routes.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <MapPin size={40} className="opacity-30 mb-2" />
                  <p className="font-medium">No hay rutas creadas</p>
                  <p className="text-sm">Creá una nueva ruta para empezar</p>
                </div>
              )}
              {routes.map((route) => (
                <div
                  key={route.RouteId}
                  className="grid grid-cols-[1fr_140px_140px_120px_80px_100px_60px] gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer items-center"
                  onClick={() => navigate(`/admin/routes/${route.RouteId}/edit`)}
                >
                  {/* Name + status */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground truncate">{route.Name}</p>
                      <Badge
                        variant={route.IsActive ? "default" : "secondary"}
                        className="text-[10px] px-1.5 py-0 shrink-0"
                      >
                        {route.IsActive ? "Activa" : "Inactiva"}
                      </Badge>
                      {route.IsOptimized && (
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] px-1.5 py-0 shrink-0" title="Orden de PDVs optimizado">
                          ⚡ Optimizada
                        </Badge>
                      )}
                    </div>
                    {route.FormId && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {forms.find((f) => f.FormId === route.FormId)?.Name ?? ""}
                      </p>
                    )}
                  </div>

                  {/* Trade Marketer */}
                  <div className="min-w-0">
                    {route.AssignedUserName ? (
                      <div className="flex items-center gap-1.5">
                        <User size={13} className="text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground truncate">{route.AssignedUserName}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-destructive">Sin asignar</span>
                    )}
                  </div>

                  {/* Frequency */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Repeat size={13} className="text-muted-foreground shrink-0" />
                      <span className="text-sm text-foreground truncate">
                        {formatFrequency(route.FrequencyType, route.FrequencyConfig)}
                      </span>
                    </div>
                  </div>

                  {/* Zone */}
                  <div>
                    <span className="text-sm text-foreground">
                      {route.BejermanZone ?? "-"}
                    </span>
                  </div>

                  {/* PDV count */}
                  <div className="text-center">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#A48242]/10 text-[#A48242] font-bold text-sm">
                      {route.PdvCount ?? 0}
                    </span>
                  </div>

                  {/* Time */}
                  <div>
                    {route.EstimatedMinutes != null ? (
                      <div className="flex items-center gap-1 text-sm text-foreground">
                        <Clock size={13} className="text-muted-foreground" />
                        {route.EstimatedMinutes} min
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1">
                    {canDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("¿Eliminar esta ruta?")) {
                          routesApi.delete(route.RouteId)
                            .then(() => { toast.success("Ruta eliminada"); refetch(); })
                            .catch((err) => toast.error(err instanceof Error ? err.message : "Error"));
                        }
                      }}
                      className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                    )}
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isCreateModalOpen || selectedRouteId !== null}
        onClose={() => {
          setIsCreateModalOpen(false);
          setSelectedRouteId(null);
        }}
        title={selectedRouteId ? "Editar Ruta" : "Nueva Ruta"}
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateModalOpen(false);
                setSelectedRouteId(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={saving || !formName.trim()}
              onClick={async () => {
                setSaving(true);
                try {
                  if (selectedRouteId) {
                    await routesApi.update(selectedRouteId, {
                      Name: formName,
                      ZoneId: formZoneId || undefined,
                      FormId: formFormId || undefined,
                      BejermanZone: formBejermanZone || undefined,
                      EstimatedMinutes: formEstimatedMinutes !== "" ? Number(formEstimatedMinutes) : undefined,
                      IsActive: formIsActive,
                    });
                    toast.success("Ruta actualizada");
                    setIsCreateModalOpen(false);
                    setSelectedRouteId(null);
                    refetch();
                  } else {
                    const newRoute = await routesApi.create({
                      Name: formName,
                      ZoneId: formZoneId || undefined,
                      FormId: formFormId || undefined,
                      BejermanZone: formBejermanZone || undefined,
                      EstimatedMinutes: formEstimatedMinutes !== "" ? Number(formEstimatedMinutes) : undefined,
                      IsActive: formIsActive,
                    });
                    toast.success("Ruta creada");
                    setIsCreateModalOpen(false);
                    setSelectedRouteId(null);
                    refetch();
                    navigate(`/admin/routes/${newRoute.RouteId}/edit`);
                  }
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Error");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Guardando..." : "Guardar Ruta"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Nombre de la Ruta
            </label>
            <Input
              placeholder="Ej: Ruta Norte - Kioscos"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Zona</label>
            <select
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
              value={formZoneId}
              onChange={(e) =>
                setFormZoneId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">Sin zona</option>
              {zones.map((z) => (
                <option key={z.ZoneId} value={z.ZoneId}>
                  {z.Name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Zona Bejerman</label>
            <select
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
              value={formBejermanZone}
              onChange={(e) => setFormBejermanZone(e.target.value)}
            >
              <option value="">Sin zona</option>
              {BEJERMAN_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Tiempo estimado (min) — solo Admin
            </label>
            <Input
              type="number"
              placeholder="Ej: 120"
              value={formEstimatedMinutes}
              onChange={(e) =>
                setFormEstimatedMinutes(e.target.value ? Number(e.target.value) : "")
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Formulario</label>
            <select
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
              value={formFormId}
              onChange={(e) =>
                setFormFormId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">Sin formulario</option>
              {forms.map((f) => (
                <option key={f.FormId} value={f.FormId}>
                  {f.Name} {f.Channel ? `(${f.Channel})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Estado</label>
            <select
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-espert-gold"
              value={formIsActive ? "active" : "inactive"}
              onChange={(e) => setFormIsActive(e.target.value === "active")}
            >
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
