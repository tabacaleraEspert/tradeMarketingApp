import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix para iconos de Leaflet en bundlers (Vite/Webpack)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface LocationMapProps {
  lat: number;
  lon: number;
  height?: string;
  className?: string;
  popupText?: string;
  zoom?: number;
}

/** Ajusta el mapa al centro cuando cambian las coordenadas y corrige tamaño en modales */
function MapUpdater({ lat, lon, zoom = 16 }: { lat: number; lon: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon], zoom);
    // Corrige dimensiones cuando el mapa está dentro de un modal que se acaba de abrir
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [lat, lon, zoom, map]);
  return null;
}

/**
 * Mapa que muestra una ubicación con marcador.
 * Usa Leaflet + OpenStreetMap (gratis, sin API key).
 */
export function LocationMap({
  lat,
  lon,
  height = "200px",
  className = "",
  popupText,
  zoom = 16,
}: LocationMapProps) {
  const position: [number, number] = [lat, lon];

  return (
    <div className={`rounded-lg overflow-hidden border border-slate-200 ${className}`} style={{ height }}>
      <MapContainer
        center={position}
        zoom={zoom}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={position}>
          {popupText && <Popup>{popupText}</Popup>}
        </Marker>
        <MapUpdater lat={lat} lon={lon} zoom={zoom} />
      </MapContainer>
    </div>
  );
}
