import { GoogleMapLocation } from "./GoogleMapLocation";

interface LocationMapProps {
  lat: number;
  lon: number;
  height?: string;
  className?: string;
  popupText?: string;
  zoom?: number;
}

/**
 * Mapa que muestra una ubicación con marcador.
 * Usa Google Maps (requiere VITE_GOOGLE_MAPS_API_KEY).
 */
export function LocationMap(props: LocationMapProps) {
  return <GoogleMapLocation {...props} />;
}
