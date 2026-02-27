import { useJsApiLoader, GoogleMap, Marker } from "@react-google-maps/api";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

interface GoogleMapLocationProps {
  lat: number;
  lon: number;
  height?: string;
  className?: string;
  popupText?: string;
  zoom?: number;
}

/**
 * Mapa de Google Maps que muestra una ubicación con marcador.
 */
export function GoogleMapLocation({
  lat,
  lon,
  height = "200px",
  className = "",
  popupText,
  zoom = 16,
}: GoogleMapLocationProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script-places",
    googleMapsApiKey: apiKey || " ",
    libraries: ["places"],
    preventGoogleFontsLoading: true,
  });

  const center = { lat, lng: lon };
  const position = { lat, lng: lon };

  if (!apiKey || loadError) {
    return (
      <div
        className={`rounded-lg overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-500 text-sm ${className}`}
        style={{ height }}
      >
        {loadError ? "Error al cargar el mapa" : "Configura VITE_GOOGLE_MAPS_API_KEY para ver el mapa"}
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div
        className={`rounded-lg overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-500 text-sm ${className}`}
        style={{ height }}
      >
        Cargando mapa...
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg overflow-hidden border border-slate-200 ${className}`}
      style={{ height }}
    >
      <GoogleMap
        mapContainerStyle={{ height: "100%", width: "100%" }}
        center={center}
        zoom={zoom}
        options={{
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        }}
      >
        <Marker position={position} title={popupText} />
      </GoogleMap>
    </div>
  );
}
