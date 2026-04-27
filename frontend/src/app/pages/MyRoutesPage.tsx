import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  CalendarDays,
  Clock,
  Route as RouteIcon,
  Zap,
  ChevronRight,
  Map as MapIcon,
  List,
  Store,
  Search,
  Filter,
  X,
  Navigation,
  Crosshair,
  ExternalLink,
  Plus,
} from "lucide-react";
import { RouteCalendar } from "../components/RouteCalendar";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { useMyRoutes, routesApi, pdvsApi } from "@/lib/api";
import type { Pdv, RoutePdv } from "@/lib/api";
import { getCurrentUser } from "../lib/auth";
import { useJsApiLoader, GoogleMap, MarkerF, PolylineF, InfoWindowF } from "@react-google-maps/api";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const LIBRARIES: ("places")[] = ["places"];

// 5 colores para distinguir hasta 5 rutas en el mapa
const ROUTE_COLORS = ["#A48242", "#2E86AB", "#22c55e", "#f59e0b", "#dc2626"];

interface PdvWithRouteInfo {
  pdv: Pdv;
  routeId: number;
  routeName: string;
  color: string;
  sortOrder: number;
  priority: number;
}

interface RouteWithPdvs {
  routeId: number;
  name: string;
  pdvCount: number;
  bejermanZone: string | null;
  frequencyType: string | null;
  estimatedMinutes: number | null;
  isOptimized: boolean;
  pdvs: Pdv[];
  routePdvs: RoutePdv[];
  color: string;
}

const PRIORITY_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "Alta",        color: "text-red-600 bg-red-50 border-red-200" },
  2: { label: "Alta-Media",  color: "text-orange-600 bg-orange-50 border-orange-200" },
  3: { label: "Normal",      color: "text-amber-600 bg-amber-50 border-amber-200" },
  4: { label: "Media-Baja",  color: "text-yellow-700 bg-yellow-50 border-yellow-200" },
  5: { label: "Baja",        color: "text-green-700 bg-green-50 border-green-200" },
};

function formatFrequency(type: string | null): string {
  switch (type) {
    case "daily": return "Diaria";
    case "weekly": return "Semanal";
    case "biweekly": return "Quincenal";
    case "monthly": return "Mensual";
    case "every_x_days": return "Cada X días";
    case "specific_days": return "Días específicos";
    default: return "Sin definir";
  }
}

export function MyRoutesPage() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const userId = Number(currentUser.id) || undefined;

  const { data: myRoutes, loading } = useMyRoutes(userId);
  const [enrichedRoutes, setEnrichedRoutes] = useState<RouteWithPdvs[]>([]);
  const [enriching, setEnriching] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [selectedMarker, setSelectedMarker] = useState<{ pdvId: number; routeId: number } | null>(null);

  // ----- Filtros (sólo aplican en vista mapa) -----
  const [searchTerm, setSearchTerm] = useState("");
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [activeRouteIds, setActiveRouteIds] = useState<Set<number> | null>(null);
  const [showRouteLine, setShowRouteLine] = useState(true);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: GOOGLE_MAPS_KEY || " ",
    libraries: LIBRARIES,
    preventGoogleFontsLoading: true,
  });

  // Cargar PDVs de cada ruta
  useEffect(() => {
    if (myRoutes.length === 0) {
      setEnrichedRoutes([]);
      return;
    }
    setEnriching(true);
    (async () => {
      const enriched: RouteWithPdvs[] = [];
      for (let i = 0; i < myRoutes.length; i++) {
        const r = myRoutes[i];
        try {
          const rps = await routesApi.listPdvs(r.RouteId);
          const sorted = [...rps].sort((a, b) => a.SortOrder - b.SortOrder);
          const pdvs: Pdv[] = [];
          for (const rp of sorted) {
            try {
              const p = await pdvsApi.get(rp.PdvId);
              pdvs.push(p);
            } catch {
              // PDV deleted
            }
          }
          enriched.push({
            routeId: r.RouteId,
            name: r.Name,
            pdvCount: r.PdvCount,
            bejermanZone: r.BejermanZone,
            frequencyType: r.FrequencyType,
            estimatedMinutes: r.EstimatedMinutes,
            isOptimized: r.IsOptimized,
            pdvs,
            routePdvs: sorted,
            color: ROUTE_COLORS[i % ROUTE_COLORS.length],
          });
        } catch {
          // route load failed
        }
      }
      setEnrichedRoutes(enriched);
      setEnriching(false);
    })();
  }, [myRoutes]);

  // Lista plana de PDVs con info de ruta (para filtros del mapa)
  const allPdvsFlat = useMemo<PdvWithRouteInfo[]>(() => {
    const flat: PdvWithRouteInfo[] = [];
    for (const r of enrichedRoutes) {
      r.pdvs.forEach((p, idx) => {
        const rp = r.routePdvs.find((x) => x.PdvId === p.PdvId);
        flat.push({
          pdv: p,
          routeId: r.routeId,
          routeName: r.name,
          color: r.color,
          sortOrder: idx,
          priority: rp?.Priority ?? 3,
        });
      });
    }
    return flat;
  }, [enrichedRoutes]);

  // Canales únicos de los PDVs del rep
  const availableChannels = useMemo(() => {
    const set = new Set<string>();
    allPdvsFlat.forEach(({ pdv }) => {
      const ch = pdv.ChannelName || pdv.Channel;
      if (ch) set.add(ch);
    });
    return Array.from(set).sort();
  }, [allPdvsFlat]);

  // PDVs después de aplicar filtros
  const filteredPdvs = useMemo<PdvWithRouteInfo[]>(() => {
    const term = searchTerm.toLowerCase().trim();
    return allPdvsFlat.filter(({ pdv, routeId, priority }) => {
      if (activeRouteIds && !activeRouteIds.has(routeId)) return false;
      if (filterChannel !== "all" && (pdv.ChannelName || pdv.Channel) !== filterChannel) return false;
      if (filterPriority !== "all" && String(priority) !== filterPriority) return false;
      if (term) {
        const hay =
          pdv.Name.toLowerCase().includes(term) ||
          (pdv.Address || "").toLowerCase().includes(term) ||
          (pdv.City || "").toLowerCase().includes(term);
        if (!hay) return false;
      }
      return pdv.Lat != null && pdv.Lon != null;
    });
  }, [allPdvsFlat, activeRouteIds, filterChannel, filterPriority, searchTerm]);

  // Centro del mapa: PDVs filtrados (o todos si hay 0 filtrados)
  const mapCenter = useMemo(() => {
    const source = filteredPdvs.length > 0 ? filteredPdvs : allPdvsFlat;
    const coords = source
      .filter(({ pdv }) => pdv.Lat != null && pdv.Lon != null)
      .map(({ pdv }) => ({ lat: Number(pdv.Lat), lng: Number(pdv.Lon) }));
    if (coords.length === 0) return { lat: -34.6, lng: -58.45 };
    const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
    const lng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
    return { lat, lng };
  }, [filteredPdvs, allPdvsFlat]);

  // Polilíneas filtradas: una por ruta, sólo con los PDVs visibles de esa ruta
  const filteredPolylines = useMemo(() => {
    if (!showRouteLine) return [];
    const byRoute = new Map<number, PdvWithRouteInfo[]>();
    filteredPdvs.forEach((item) => {
      if (!byRoute.has(item.routeId)) byRoute.set(item.routeId, []);
      byRoute.get(item.routeId)!.push(item);
    });
    return Array.from(byRoute.entries()).map(([routeId, items]) => {
      const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        routeId,
        color: sorted[0]?.color ?? "#A48242",
        path: sorted.map((it) => ({ lat: Number(it.pdv.Lat), lng: Number(it.pdv.Lon) })),
      };
    });
  }, [filteredPdvs, showRouteLine]);

  const activeFilterCount =
    (filterChannel !== "all" ? 1 : 0) +
    (filterPriority !== "all" ? 1 : 0) +
    (searchTerm ? 1 : 0) +
    (activeRouteIds && activeRouteIds.size < enrichedRoutes.length ? 1 : 0);

  const handleClearFilters = () => {
    setSearchTerm("");
    setFilterChannel("all");
    setFilterPriority("all");
    setActiveRouteIds(null);
  };

  const handleCenterOnMe = () => {
    if (!navigator.geolocation || !mapInstance) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        mapInstance.panTo(loc);
        mapInstance.setZoom(15);
      },
      () => {
        // GPS denied/unavailable
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const openInGoogleMaps = (lat: number, lng: number) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, "_blank");
  };

  const toggleRouteFilter = (routeId: number) => {
    setActiveRouteIds((prev) => {
      const all = new Set(enrichedRoutes.map((r) => r.routeId));
      const current = prev ?? all;
      const next = new Set(current);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next.size === enrichedRoutes.length ? null : next;
    });
  };

  const totalPdvs = enrichedRoutes.reduce((s, r) => s + r.pdvs.length, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Mis Rutas Foco</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enrichedRoutes.length} {enrichedRoutes.length === 1 ? "ruta asignada" : "rutas asignadas"}
              {totalPdvs > 0 && ` · ${totalPdvs} PDVs en total`}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => navigate("/my-routes/generate")}
          >
            <Zap size={16} />
            <span className="hidden sm:inline">Generar</span>
          </Button>
          <Button
            size="sm"
            className="bg-[#A48242] hover:bg-[#8a6d35] text-white gap-1.5"
            onClick={() => navigate("/my-routes/new")}
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Crear</span>
          </Button>
          {/* View toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-2 transition-colors ${
                viewMode === "list" ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted"
              }`}
              title="Lista"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`px-3 py-2 transition-colors ${
                viewMode === "map" ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted"
              }`}
              title="Mapa"
            >
              <MapIcon size={16} />
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className={`px-3 py-2 transition-colors ${
                viewMode === "calendar" ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted"
              }`}
              title="Calendario"
            >
              <CalendarDays size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 max-w-2xl mx-auto">
        {(loading || enriching) && (
          <p className="text-muted-foreground text-center py-8">Cargando rutas...</p>
        )}

        {!loading && !enriching && enrichedRoutes.length === 0 && (
          <Card className="border-dashed border-2 border-border bg-muted/30">
            <CardContent className="p-10 text-center">
              <RouteIcon size={36} className="mx-auto text-muted-foreground/40 mb-2" />
              <p className="font-semibold text-muted-foreground mb-1">
                No tenés rutas todavía
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Creá tu primera ruta foco para empezar a organizar tus visitas.
              </p>
              <Button
                size="sm"
                className="bg-[#A48242] hover:bg-[#8a6d35] text-white gap-1.5"
                onClick={() => navigate("/my-routes/new")}
              >
                <Plus size={16} />
                Crear Ruta
              </Button>
            </CardContent>
          </Card>
        )}

        {/* === MAP VIEW === */}
        {!loading && !enriching && viewMode === "calendar" && (
          <RouteCalendar userId={Number(getCurrentUser().id)} compact />
        )}

        {!loading && !enriching && enrichedRoutes.length > 0 && viewMode === "map" && (
          <div className="space-y-3">
            {/* Filter bar */}
            <Card>
              <CardContent className="p-3 space-y-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                  <Input
                    placeholder="Buscar PDV por nombre, dirección o ciudad..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>

                {/* Filter selects */}
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                    value={filterChannel}
                    onChange={(e) => setFilterChannel(e.target.value)}
                  >
                    <option value="all">Todos los canales</option>
                    {availableChannels.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:ring-2 focus:ring-espert-gold"
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value)}
                  >
                    <option value="all">Todas las prioridades</option>
                    <option value="1">Alta</option>
                    <option value="2">Alta-Media</option>
                    <option value="3">Normal</option>
                    <option value="4">Media-Baja</option>
                    <option value="5">Baja</option>
                  </select>
                </div>

                {/* Route toggles (sólo si hay más de 1 ruta) */}
                {enrichedRoutes.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {enrichedRoutes.map((r) => {
                      const isActive = !activeRouteIds || activeRouteIds.has(r.routeId);
                      return (
                        <button
                          key={r.routeId}
                          onClick={() => toggleRouteFilter(r.routeId)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                            isActive
                              ? "border-transparent text-white"
                              : "border-border text-muted-foreground bg-card"
                          }`}
                          style={isActive ? { background: r.color } : undefined}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ background: isActive ? "white" : r.color }} />
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Stats + actions row */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                  <div className="flex items-center gap-2">
                    <Filter size={12} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{filteredPdvs.length}</span> de {allPdvsFlat.length} PDVs
                    </span>
                    {activeFilterCount > 0 && (
                      <button
                        onClick={handleClearFilters}
                        className="text-[11px] text-destructive hover:underline"
                      >
                        Limpiar ({activeFilterCount})
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowRouteLine((v) => !v)}
                      className={`p-1.5 rounded-lg border transition-colors ${
                        showRouteLine
                          ? "border-[#A48242]/40 bg-[#A48242]/10 text-[#A48242]"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                      title={showRouteLine ? "Ocultar línea de ruta" : "Mostrar línea de ruta"}
                    >
                      <RouteIcon size={14} />
                    </button>
                    <button
                      onClick={handleCenterOnMe}
                      className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted"
                      title="Centrar en mi ubicación"
                    >
                      <Crosshair size={14} />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Map */}
            <Card>
              <CardContent className="p-3">
                {!mapsLoaded || !GOOGLE_MAPS_KEY ? (
                  <div className="h-[500px] flex items-center justify-center text-muted-foreground text-sm">
                    Cargando mapa...
                  </div>
                ) : (
                  <GoogleMap
                    mapContainerStyle={{ width: "100%", height: "500px", borderRadius: "0.5rem" }}
                    center={mapCenter}
                    zoom={13}
                    onLoad={(m) => setMapInstance(m)}
                    options={{
                      streetViewControl: false,
                      mapTypeControl: false,
                      fullscreenControl: true,
                      styles: [
                        { featureType: "poi", stylers: [{ visibility: "off" }] },
                        { featureType: "transit", stylers: [{ visibility: "off" }] },
                      ],
                    }}
                  >
                    {filteredPolylines.map((line) => (
                      line.path.length > 1 && (
                        <PolylineF
                          key={line.routeId}
                          path={line.path}
                          options={{
                            strokeColor: line.color,
                            strokeOpacity: 0.7,
                            strokeWeight: 3,
                          }}
                        />
                      )
                    ))}

                    {filteredPdvs.map((item) => (
                      <MarkerF
                        key={`${item.routeId}-${item.pdv.PdvId}`}
                        position={{ lat: Number(item.pdv.Lat), lng: Number(item.pdv.Lon) }}
                        label={{
                          text: String(item.sortOrder + 1),
                          color: "white",
                          fontWeight: "bold",
                          fontSize: "12px",
                        }}
                        icon={{
                          path: 0,
                          scale: 14,
                          fillColor: item.color,
                          fillOpacity: 1,
                          strokeColor: "white",
                          strokeWeight: 2,
                        }}
                        onClick={() => setSelectedMarker({ pdvId: item.pdv.PdvId, routeId: item.routeId })}
                      >
                        {selectedMarker?.pdvId === item.pdv.PdvId && selectedMarker?.routeId === item.routeId && (
                          <InfoWindowF onCloseClick={() => setSelectedMarker(null)}>
                            <div style={{ minWidth: 220, maxWidth: 280, padding: 4, fontFamily: "Inter, sans-serif" }}>
                              <p style={{ fontWeight: 700, fontSize: 14, color: "#000", marginBottom: 6 }}>
                                {item.pdv.Name}
                              </p>
                              <div style={{ fontSize: 12, color: "#53565A", display: "flex", flexDirection: "column", gap: 4 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <MapPin size={12} color="#A48242" />
                                  <span>{item.pdv.Address || item.pdv.City || "—"}</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <Store size={12} color="#A48242" />
                                  <span>{item.pdv.ChannelName || item.pdv.Channel || "—"}</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 10, height: 10, borderRadius: "50%",
                                      background: item.color,
                                    }}
                                  />
                                  <span style={{ fontWeight: 600, color: item.color }}>
                                    {item.routeName} · #{item.sortOrder + 1}
                                  </span>
                                </div>
                                <div style={{ marginTop: 2 }}>
                                  <span
                                    className={PRIORITY_LABEL[item.priority]?.color}
                                    style={{
                                      display: "inline-block",
                                      padding: "2px 8px",
                                      borderRadius: 4,
                                      border: "1px solid",
                                      fontSize: 10,
                                      fontWeight: 600,
                                    }}
                                  >
                                    Prioridad: {PRIORITY_LABEL[item.priority]?.label ?? item.priority}
                                  </span>
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                                <button
                                  onClick={() => navigate(`/pos/${item.pdv.PdvId}`)}
                                  style={{
                                    flex: 1,
                                    padding: "6px 10px",
                                    background: "#A48242",
                                    color: "white",
                                    border: 0,
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 4,
                                  }}
                                >
                                  <ExternalLink size={11} />
                                  Ver detalle
                                </button>
                                <button
                                  onClick={() => openInGoogleMaps(Number(item.pdv.Lat), Number(item.pdv.Lon))}
                                  style={{
                                    flex: 1,
                                    padding: "6px 10px",
                                    background: "white",
                                    color: "#A48242",
                                    border: "1px solid #A48242",
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 4,
                                  }}
                                >
                                  <Navigation size={11} />
                                  Cómo llegar
                                </button>
                              </div>
                            </div>
                          </InfoWindowF>
                        )}
                      </MarkerF>
                    ))}

                    {/* Marker de mi ubicación */}
                    {userLocation && (
                      <MarkerF
                        position={userLocation}
                        icon={{
                          path: 0,
                          scale: 8,
                          fillColor: "#3b82f6",
                          fillOpacity: 1,
                          strokeColor: "white",
                          strokeWeight: 3,
                        }}
                        title="Tu ubicación"
                      />
                    )}
                  </GoogleMap>
                )}

                {/* Legend */}
                {enrichedRoutes.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                    {enrichedRoutes.map((r) => {
                      const visibleCount = filteredPdvs.filter((it) => it.routeId === r.routeId).length;
                      const isFiltered = activeRouteIds && !activeRouteIds.has(r.routeId);
                      return (
                        <div key={r.routeId} className={`flex items-center gap-1.5 ${isFiltered ? "opacity-30" : ""}`}>
                          <span className="w-3 h-3 rounded-full" style={{ background: r.color }} />
                          <span className="text-muted-foreground">{r.name}</span>
                          <span className="text-[10px] text-muted-foreground/70">
                            ({visibleCount}/{r.pdvs.length})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* === LIST VIEW === */}
        {!loading && !enriching && enrichedRoutes.length > 0 && viewMode === "list" && (
          <div className="space-y-3">
            {enrichedRoutes.map((route) => (
              <Card
                key={route.routeId}
                className="cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
                onClick={() => navigate(`/my-routes/${route.routeId}/edit`)}
              >
                {/* Color stripe */}
                <div className="h-1" style={{ background: route.color }} />
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-bold text-foreground truncate">{route.name}</h3>
                        {route.isOptimized && (
                          <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] px-1.5 py-0 gap-0.5">
                            <Zap size={9} />
                            Optimizada
                          </Badge>
                        )}
                      </div>
                      {route.bejermanZone && (
                        <p className="text-xs text-muted-foreground">Zona {route.bejermanZone}</p>
                      )}
                    </div>
                    <ChevronRight size={20} className="text-muted-foreground shrink-0" />
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Store size={13} className="text-muted-foreground" />
                      <span className="text-foreground font-semibold">{route.pdvs.length}</span>
                      <span className="text-muted-foreground">PDVs</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <Calendar size={13} className="text-muted-foreground" />
                      <span className="text-muted-foreground truncate">{formatFrequency(route.frequencyType)}</span>
                    </div>
                    {route.estimatedMinutes != null && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Clock size={13} className="text-muted-foreground" />
                        <span className="text-muted-foreground">{route.estimatedMinutes} min</span>
                      </div>
                    )}
                  </div>

                  {/* PDV preview chips (first 4) */}
                  {route.pdvs.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-3 border-t border-border">
                      {route.pdvs.slice(0, 4).map((p, idx) => (
                        <span
                          key={p.PdvId}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-muted/60 text-muted-foreground"
                        >
                          <span
                            className="w-3 h-3 rounded-full text-[8px] font-bold text-white flex items-center justify-center"
                            style={{ background: route.color }}
                          >
                            {idx + 1}
                          </span>
                          <span className="truncate max-w-[120px]">{p.Name}</span>
                        </span>
                      ))}
                      {route.pdvs.length > 4 && (
                        <span className="inline-flex items-center text-[10px] px-2 py-1 rounded-full bg-muted/60 text-muted-foreground">
                          +{route.pdvs.length - 4} más
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
