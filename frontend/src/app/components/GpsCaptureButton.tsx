import { useState } from "react";
import { Button } from "./ui/button";
import { MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface GpsPosition {
  lat: number;
  lon: number;
}

interface GpsCaptureButtonProps {
  onCapture: (position: GpsPosition) => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  children?: React.ReactNode;
}

/**
 * Botón que solicita permiso de ubicación al dispositivo y captura las coordenadas GPS.
 */
export function GpsCaptureButton({
  onCapture,
  variant = "outline",
  size = "sm",
  className = "",
  children,
}: GpsCaptureButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleCapture = () => {
    if (!navigator.geolocation) {
      toast.error("Tu navegador no soporta geolocalización");
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        onCapture({ lat, lon });
        toast.success(`Ubicación capturada: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            toast.error("Permiso de ubicación denegado. Habilítalo en la configuración del navegador.");
            break;
          case error.POSITION_UNAVAILABLE:
            toast.error("No se pudo obtener la ubicación. Verifica que el GPS esté activo.");
            break;
          case error.TIMEOUT:
            toast.error("Tiempo de espera agotado. Intenta de nuevo.");
            break;
          default:
            toast.error("Error al obtener la ubicación");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={handleCapture}
      disabled={loading}
    >
      {loading ? (
        <Loader2 size={16} className="mr-2 animate-spin" />
      ) : (
        <MapPin size={16} className="mr-2" />
      )}
      {children ?? "Capturar ubicación GPS"}
    </Button>
  );
}
