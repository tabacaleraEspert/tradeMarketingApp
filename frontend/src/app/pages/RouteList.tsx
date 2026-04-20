import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import {
  MapPin, ArrowLeft, Map, List, Search, ChevronRight, Store,
} from "lucide-react";
import { usePdvs } from "@/lib/api";
import { getCurrentUser } from "../lib/auth";
import { useJsApiLoader, GoogleMap, MarkerF } from "@react-google-maps/api";

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
  const isFieldRep = ["vendedor", "ejecutivo"].includes((currentUser.role || "").toLowerCase());
  const { data: allPdvs, loading } = usePdvs(isFieldRep ? userZoneId : undefined);
  const pdvs = allPdvs;

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

  const [showInactive, setShowInactive] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "recent">("name");

  const filteredPdvs = useMemo(() => {
    const filtered = pdvs.filter((p) => {
      if (!p.IsActive && !showInactive) return false;
      const search = searchTerm.toLowerCase();
      const matchesSearch = !search ||
        p.Name.toLowerCase().includes(search) ||
        (p.Address || "").toLowerCase().includes(search) ||
        (p.City || "").toLowerCase().includes(search);
      const ch = p.ChannelName || p.Channel || "";
      const matchesChannel = channelFilter === "all" || ch === channelFilter;
      return matchesSearch && matchesChannel;
    });
    if (sortBy === "recent") {
      return [...filtered].sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());
    }
    return filtered.sort((a, b) => a.Name.localeCompare(b.Name));
  }, [pdvs, searchTerm, channelFilter, showInactive, sortBy]);

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
            placeholder="Buscar por nombre, dirección o ciudad..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Channel chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          <button
            onClick={() => { setChannelFilter("all"); setShowInactive(false); }}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              channelFilter === "all" && !showInactive ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            Activos ({pdvs.filter((p) => p.IsActive).length})
          </button>
          <button
            onClick={() => setShowInactive((v) => !v)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              showInactive ? "bg-rose-500/80 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            Inactivos ({pdvs.filter((p) => !p.IsActive).length})
          </button>
          <span className="mx-1 text-border">|</span>
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
            <div className="divide-y divide-border">
              {filteredPdvs.map((pdv) => (
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
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {pdv.ChannelName || pdv.Channel || "-"}
                  </Badge>
                  <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
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
              {pdvsWithCoords.map((pdv) => (
                <MarkerF
                  key={pdv.PdvId}
                  position={{ lat: Number(pdv.Lat), lng: Number(pdv.Lon) }}
                  onClick={() => navigate(`/pos/${pdv.PdvId}`)}
                  icon={{
                    path: google.maps.SymbolPath.CIRCLE,
                    fillColor: "#A48242",
                    fillOpacity: 1,
                    strokeColor: "#fff",
                    strokeWeight: 2,
                    scale: 10,
                  }}
                  title={`${pdv.Name} — ${pdv.Address || ""}`}
                />
              ))}
            </GoogleMap>
          )}
        </div>
      )}
    </div>
  );
}
