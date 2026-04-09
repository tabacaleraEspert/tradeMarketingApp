import { useState, useCallback, useMemo } from "react";
import {
  useJsApiLoader,
  GoogleMap,
  MarkerF,
  InfoWindowF,
} from "@react-google-maps/api";
import { MapPin, Clock, User, Hash, Store } from "lucide-react";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

interface PdvMapItem {
  pdvId: number;
  name: string;
  address: string;
  lat: number;
  lon: number;
  channel: string;
  channelId: number | null;
  zoneId: number | null;
  visitCount: number;
  lastVisit: string | null;
  assignedUserId: number | null;
  assignedUserName: string;
}

interface PdvMapViewProps {
  pdvs: PdvMapItem[];
  height?: string;
  className?: string;
}

// 12 distinct marker colors for different activadores
const ACTIVADOR_COLORS = [
  "#A48242", // Espert gold
  "#2E86AB", // blue
  "#A23B72", // magenta
  "#F18F01", // orange
  "#C73E1D", // red
  "#3B1F2B", // dark
  "#44BBA4", // teal
  "#7B2D8E", // purple
  "#E4572E", // coral
  "#17BEBB", // cyan
  "#76B041", // green
  "#D4A373", // tan
];

function getActivadorColor(userId: number | null, colorMap: Map<number | null, string>): string {
  if (!colorMap.has(userId)) {
    const idx = colorMap.size % ACTIVADOR_COLORS.length;
    colorMap.set(userId, ACTIVADOR_COLORS[idx]);
  }
  return colorMap.get(userId)!;
}

// SVG marker icon as data URL
function createMarkerIcon(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="28" height="42">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="white" opacity="0.9"/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function formatLastVisit(iso: string | null): string {
  if (!iso) return "Sin visitas";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays} días`;
  if (diffDays < 30) return `Hace ${Math.floor(diffDays / 7)} sem.`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

export function PdvMapView({ pdvs, height = "500px", className = "" }: PdvMapViewProps) {
  const [selectedPdv, setSelectedPdv] = useState<PdvMapItem | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: apiKey || " ",
    libraries: ["places"],
    preventGoogleFontsLoading: true,
  });

  // Build color map for activadores
  const { colorMap, legend } = useMemo(() => {
    const cm = new Map<number | null, string>();
    // Sort by userId so colors are stable
    const userIds = [...new Set(pdvs.map((p) => p.assignedUserId))].sort((a, b) => (a ?? 999) - (b ?? 999));
    userIds.forEach((uid) => getActivadorColor(uid, cm));

    const legendItems = userIds.map((uid) => ({
      userId: uid,
      name: pdvs.find((p) => p.assignedUserId === uid)?.assignedUserName || "Sin asignar",
      color: cm.get(uid)!,
      count: pdvs.filter((p) => p.assignedUserId === uid).length,
    }));
    return { colorMap: cm, legend: legendItems };
  }, [pdvs]);

  // Center on Argentina by default, or on PDVs centroid
  const center = useMemo(() => {
    if (pdvs.length === 0) return { lat: -34.6037, lng: -58.3816 };
    const avgLat = pdvs.reduce((s, p) => s + p.lat, 0) / pdvs.length;
    const avgLon = pdvs.reduce((s, p) => s + p.lon, 0) / pdvs.length;
    return { lat: avgLat, lng: avgLon };
  }, [pdvs]);

  const onMarkerClick = useCallback((pdv: PdvMapItem) => {
    setSelectedPdv(pdv);
  }, []);

  if (!apiKey || loadError) {
    return (
      <div
        className={`rounded-lg overflow-hidden border border-border bg-muted flex items-center justify-center text-muted-foreground text-sm ${className}`}
        style={{ height }}
      >
        {loadError ? "Error al cargar el mapa" : "Configura VITE_GOOGLE_MAPS_API_KEY para ver el mapa"}
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div
        className={`rounded-lg overflow-hidden border border-border bg-muted flex items-center justify-center text-muted-foreground text-sm animate-pulse ${className}`}
        style={{ height }}
      >
        Cargando mapa...
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Map */}
      <div className="rounded-lg overflow-hidden border border-border" style={{ height }}>
        <GoogleMap
          mapContainerStyle={{ height: "100%", width: "100%" }}
          center={center}
          zoom={pdvs.length === 1 ? 15 : 12}
          options={{
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            styles: [
              { featureType: "poi", stylers: [{ visibility: "off" }] },
              { featureType: "transit", stylers: [{ visibility: "off" }] },
            ],
          }}
        >
          {pdvs.map((pdv) => (
            <MarkerF
              key={pdv.pdvId}
              position={{ lat: pdv.lat, lng: pdv.lon }}
              icon={{
                url: createMarkerIcon(getActivadorColor(pdv.assignedUserId, colorMap)),
                scaledSize: new google.maps.Size(28, 42),
                anchor: new google.maps.Point(14, 42),
              }}
              onClick={() => onMarkerClick(pdv)}
              title={pdv.name}
            />
          ))}

          {selectedPdv && (
            <InfoWindowF
              position={{ lat: selectedPdv.lat, lng: selectedPdv.lon }}
              onCloseClick={() => setSelectedPdv(null)}
              options={{ pixelOffset: new google.maps.Size(0, -42) }}
            >
              <div style={{ minWidth: 220, maxWidth: 280, padding: 4, fontFamily: "Inter, sans-serif", backgroundColor: "#fff", color: "#000" }}>
                <h3 style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 15, color: "#000" }}>
                  {selectedPdv.name}
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#53565A" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MapPin size={14} color="#A48242" />
                    <span>{selectedPdv.address || "Sin dirección"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Store size={14} color="#A48242" />
                    <span>{selectedPdv.channel}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Hash size={14} color="#A48242" />
                    <span style={{ fontWeight: 600, color: "#000" }}>{selectedPdv.visitCount}</span>
                    <span>visitas</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Clock size={14} color="#A48242" />
                    <span>{formatLastVisit(selectedPdv.lastVisit)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <User size={14} color={getActivadorColor(selectedPdv.assignedUserId, colorMap)} />
                    <span
                      style={{
                        fontWeight: 600,
                        color: getActivadorColor(selectedPdv.assignedUserId, colorMap),
                      }}
                    >
                      {selectedPdv.assignedUserName}
                    </span>
                  </div>
                </div>
              </div>
            </InfoWindowF>
          )}
        </GoogleMap>
      </div>

      {/* Legend */}
      {legend.length > 0 && (
        <div className="flex flex-wrap gap-3 px-1">
          {legend.map((item) => (
            <div key={item.userId ?? "null"} className="flex items-center gap-2 text-sm">
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-foreground font-medium">{item.name}</span>
              <span className="text-muted-foreground">({item.count})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
