import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  MapPin, ArrowLeft, Map, List, Search, ChevronRight, Store, Route as RouteIcon,
} from "lucide-react";
import { usePdvs, routesApi, useMyRoutes } from "@/lib/api";
import type { RoutePdv } from "@/lib/api/types";
import { getCurrentUser } from "../lib/auth";
import { useJsApiLoader, GoogleMap, MarkerF, InfoWindowF } from "@react-google-maps/api";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const LIBRARIES: ("places")[] = ["places"];

export function RouteList() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");

  // TM Reps sólo ven PDVs de su zona. Territory Manager+ ve todos.
  const userZoneId = currentUser.zoneId;
  const userId = Number(currentUser.id) || undefined;
  const isFieldRep = ["vendedor", "ejecutivo"].includes((currentUser.role || "").toLowerCase());
  const { data: allPdvs, loading } = usePdvs(isFieldRep ? userZoneId : undefined);
  const pdvs = allPdvs;

  // Load route assignments to show route names per PDV
  const { data: myRoutes } = useMyRoutes(userId);
  const [pdvRouteMap, setPdvRouteMap] = useState<Record<number, string[]>>({});
  const [routeFilter, setRouteFilter] = useState<"all" | "with" | "without">("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (myRoutes.length === 0) return;
    const map: Record<number, string[]> = {};
    const fetchAll = async () => {
      for (const r of myRoutes) {
        try {
          const rpdvs = await routesApi.listPdvs(r.RouteId);
          for (const rp of rpdvs) {
            if (!map[rp.PdvId]) map[rp.PdvId] = [];
            if (!map[rp.PdvId].includes(r.Name)) map[rp.PdvId].push(r.Name);
          }
        } catch { /* skip */ }
      }
      setPdvRouteMap({ ...map });
    };
    fetchAll();
  }, [myRoutes]);

  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: GOOGLE_MAPS_KEY || " ",
    libraries: LIBRARIES,
    preventGoogleFontsLoading: true,
  });

  const channels = useMemo(
    () => Array.from(new Set(pdvs.map((p) => p.ChannelName || p.Channel).filter(Boolean))).sort(),
    [pdvs]
  );

  const [selectedMapPdvId, setSelectedMapPdvId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [sortBy, setSortBy] = useState<"name" | "recent">("name");

  const filteredPdvs = useMemo(() => {
    setPage(0); // Reset page on filter change
    const filtered = pdvs.filter((p) => {
      // Active/Inactive filter
      if (activeFilter === "active" && !p.IsActive) return false;
      if (activeFilter === "inactive" && p.IsActive) return false;
      // Route filter
      const hasRoute = (pdvRouteMap[p.PdvId] || []).length > 0;
      if (routeFilter === "with" && !hasRoute) return false;
      if (routeFilter === "without" && hasRoute) return false;
      const search = searchTerm.toLowerCase();
      const matchesSearch = !search ||
        p.Name.toLowerCase().includes(search) ||
        (p.Address || "").toLowerCase().includes(search) ||
        (p.City || "").toLowerCase().includes(search) ||
        (p.ContactName || "").toLowerCase().includes(search) ||
        (pdvRouteMap[p.PdvId] || []).some((r) => r.toLowerCase().includes(search));
      const ch = p.ChannelName || p.Channel || "";
      const matchesChannel = channelFilter === "all" || ch === channelFilter;
      return matchesSearch && matchesChannel;
    });
    if (sortBy === "recent") {
      return [...filtered].sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());
    }
    return filtered.sort((a, b) => a.Name.localeCompare(b.Name));
  }, [pdvs, searchTerm, channelFilter, activeFilter, sortBy, routeFilter, pdvRouteMap]);

  const pagedPdvs = useMemo(() => filteredPdvs.slice(0, (page + 1) * PAGE_SIZE), [filteredPdvs, page]);
  const hasMore = pagedPdvs.length < filteredPdvs.length;

  const pdvsWithCoords = useMemo(
    () => filteredPdvs.filter((p) => p.Lat != null && p.Lon != null),
    [filteredPdvs]
  );

  const mapCenter = useMemo(() => {
    if (pdvsWithCoords.length === 0) return { lat: -34.6, lng: -58.45 };
    return {
      lat: pdvsWithCoords.reduce((s, p) => s + Number(p.Lat), 0) / pdvsWithCoords.length,
      lng: pdvsWithCoords.reduce((s, p) => s + Number(p.Lon), 0) / pdvsWithCoords.length,
    };
  }, [pdvsWithCoords]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10 space-y-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/")} className="p-1.5 hover:bg-muted rounded-lg">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-foreground">Buscar PDV</h1>
            <p className="text-xs text-muted-foreground">
              {isFieldRep ? `${currentUser.zone} — ` : ""}{filteredPdvs.length} PDVs
            </p>
          </div>
          {/* View toggle - compact */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted"}`}
            >
              <List size={18} />
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`p-1.5 transition-colors ${viewMode === "map" ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted"}`}
            >
              <Map size={18} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input
            placeholder="Buscar por nombre, dirección, ciudad o contacto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Channel chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          <button
            onClick={() => { setActiveFilter("active"); setChannelFilter("all"); }}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeFilter === "active" ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            Activos ({pdvs.filter((p) => p.IsActive).length})
          </button>
          <button
            onClick={() => setActiveFilter("inactive")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeFilter === "inactive" ? "bg-rose-500/80 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            Inactivos ({pdvs.filter((p) => !p.IsActive).length})
          </button>
          <button
            onClick={() => setActiveFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeFilter === "all" ? "bg-blue-500/80 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            Todos ({pdvs.length})
          </button>
          <span className="mx-0.5 text-border">|</span>
          <button
            onClick={() => setRouteFilter("with")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              routeFilter === "with" ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            Con ruta
          </button>
          <button
            onClick={() => setRouteFilter("without")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              routeFilter === "without" ? "bg-amber-500/80 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            Sin ruta
          </button>
          {routeFilter !== "all" && (
            <button
              onClick={() => setRouteFilter("all")}
              className="px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Limpiar
            </button>
          )}
          <span className="mx-0.5 text-border">|</span>
          <button
            onClick={() => setSortBy((v) => v === "name" ? "recent" : "name")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              sortBy === "recent" ? "bg-blue-500/80 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            {sortBy === "recent" ? "Más recientes" : "A-Z"}
          </button>
          {channels.map((ch) => {
            const count = pdvs.filter((p) => p.IsActive && (p.ChannelName || p.Channel) === ch).length;
            return (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  channelFilter === ch ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {ch} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {viewMode === "list" ? (
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Cargando...</div>
          ) : filteredPdvs.length === 0 ? (
            <div className="p-12 text-center">
              <Search size={32} className="mx-auto text-muted-foreground mb-2 opacity-40" />
              <p className="font-medium text-foreground text-sm">Sin resultados</p>
              <p className="text-xs text-muted-foreground mt-1">Probá con otros filtros</p>
            </div>
          ) : (
            <>
            <div className="divide-y divide-border">
              {pagedPdvs.map((pdv) => {
                const routes = pdvRouteMap[pdv.PdvId] || [];
                return (
                  <button
                    key={pdv.PdvId}
                    onClick={() => navigate(`/pos/${pdv.PdvId}`)}
                    className={`w-full flex items-center gap-3 p-3.5 text-left hover:bg-muted/40 active:bg-muted/60 transition-colors ${!pdv.IsActive ? "opacity-60" : ""}`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${pdv.IsActive ? "bg-[#A48242]/10" : "bg-rose-500/10"}`}>
                      <Store size={18} className={pdv.IsActive ? "text-[#A48242]" : "text-rose-500"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-foreground text-sm truncate">{pdv.Name}</p>
                        {!pdv.IsActive && (
                          <Badge className="bg-rose-100 text-rose-700 text-[9px] px-1.5 py-0 shrink-0">Inactivo</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {pdv.Address || pdv.City || "Sin dirección"}
                      </p>
                      {routes.length > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <RouteIcon size={10} className="text-[#A48242] shrink-0" />
                          <p className="text-[10px] text-[#A48242] font-medium truncate">
                            {routes.join(", ")}
                          </p>
                        </div>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {pdv.ChannelName || pdv.Channel || "-"}
                    </Badge>
                    <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
            {hasMore && (
              <div className="p-4 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  className="text-xs"
                >
                  Cargar más ({filteredPdvs.length - pagedPdvs.length} restantes)
                </Button>
              </div>
            )}
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-[400px]">
          {!GOOGLE_MAPS_KEY || !mapsLoaded ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              {!GOOGLE_MAPS_KEY ? "Configura VITE_GOOGLE_MAPS_API_KEY para ver el mapa" : "Cargando mapa..."}
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "calc(100vh - 200px)" }}
              center={mapCenter}
              zoom={pdvsWithCoords.length <= 1 ? 15 : 12}
              options={{
                disableDefaultUI: true,
                zoomControl: true,
                styles: [
                  { featureType: "poi", stylers: [{ visibility: "off" }] },
                  { featureType: "transit", stylers: [{ visibility: "off" }] },
                ],
              }}
            >
              {pdvsWithCoords.map((pdv) => {
                const routes = pdvRouteMap[pdv.PdvId] || [];
                const isSelected = selectedMapPdvId === pdv.PdvId;
                return (
                  <MarkerF
                    key={pdv.PdvId}
                    position={{ lat: Number(pdv.Lat), lng: Number(pdv.Lon) }}
                    onClick={() => setSelectedMapPdvId(isSelected ? null : pdv.PdvId)}
                    icon={{
                      path: google.maps.SymbolPath.CIRCLE,
                      fillColor: isSelected ? "#000" : "#A48242",
                      fillOpacity: 1,
                      strokeColor: "#fff",
                      strokeWeight: 2,
                      scale: isSelected ? 12 : 10,
                    }}
                  >
                    {isSelected && (
                      <InfoWindowF
                        position={{ lat: Number(pdv.Lat), lng: Number(pdv.Lon) }}
                        onCloseClick={() => setSelectedMapPdvId(null)}
                      >
                        <div style={{ minWidth: 180, maxWidth: 240, padding: 4 }}>
                          <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>{pdv.Name}</p>
                          <p style={{ fontSize: 12, color: "#666", margin: "4px 0" }}>
                            {pdv.Address || pdv.City || "Sin dirección"}
                          </p>
                          <p style={{ fontSize: 11, color: "#888", margin: "2px 0" }}>
                            {pdv.ChannelName || pdv.Channel || ""}
                          </p>
                          {routes.length > 0 && (
                            <p style={{ fontSize: 11, color: "#A48242", fontWeight: 600, margin: "4px 0 0" }}>
                              {routes.join(", ")}
                            </p>
                          )}
                          {pdv.ContactName && (
                            <p style={{ fontSize: 11, color: "#666", margin: "2px 0" }}>
                              {pdv.ContactName}{pdv.ContactPhone ? ` · ${pdv.ContactPhone}` : ""}
                            </p>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/pos/${pdv.PdvId}`); }}
                            style={{
                              marginTop: 8,
                              width: "100%",
                              padding: "6px 0",
                              backgroundColor: "#A48242",
                              color: "#fff",
                              border: "none",
                              borderRadius: 6,
                              fontWeight: 600,
                              fontSize: 13,
                              cursor: "pointer",
                            }}
                          >
                            Ir al PDV
                          </button>
                        </div>
                      </InfoWindowF>
                    )}
                  </MarkerF>
                );
              })}
            </GoogleMap>
          )}
        </div>
      )}
    </div>
  );
}
