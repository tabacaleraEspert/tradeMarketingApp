import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import {
  MapPin, ArrowLeft, Map, List, Search, ChevronRight, Store,
} from "lucide-react";
import { usePdvs } from "@/lib/api";
import { useJsApiLoader, GoogleMap, MarkerF } from "@react-google-maps/api";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const LIBRARIES: ("places")[] = ["places"];

export function RouteList() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");

  const { data: pdvs, loading } = usePdvs();

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

  const filteredPdvs = useMemo(() => {
    return pdvs.filter((p) => {
      if (!p.IsActive) return false;
      const search = searchTerm.toLowerCase();
      const matchesSearch = !search ||
        p.Name.toLowerCase().includes(search) ||
        (p.Address || "").toLowerCase().includes(search) ||
        (p.City || "").toLowerCase().includes(search);
      const ch = p.ChannelName || p.Channel || "";
      const matchesChannel = channelFilter === "all" || ch === channelFilter;
      return matchesSearch && matchesChannel;
    });
  }, [pdvs, searchTerm, channelFilter]);

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
            onClick={() => setChannelFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              channelFilter === "all" ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            Todos ({pdvs.filter((p) => p.IsActive).length})
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
                  className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-muted/40 active:bg-muted/60 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#A48242]/10 flex items-center justify-center shrink-0">
                    <Store size={18} className="text-[#A48242]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{pdv.Name}</p>
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
        <div className="flex-1">
          {!GOOGLE_MAPS_KEY || !mapsLoaded ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">Cargando mapa...</div>
          ) : (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "100%" }}
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
