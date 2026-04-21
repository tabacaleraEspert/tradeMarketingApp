import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Banner sticky que aparece cuando el navegador está sin conexión.
 * Escucha los eventos `online`/`offline` del browser.
 *
 * Nota: `navigator.onLine` no es 100% confiable en todos los browsers
 * (puede decir "online" aunque el server no responda), pero es el mejor
 * disponible sin hacer pings constantes. Para casos donde un fetch falla
 * con error de red, el client.ts del día 6 ya muestra un toast específico.
 */
export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-white shadow-md pt-[env(safe-area-inset-top)]">
      <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-2 text-sm font-medium">
        <WifiOff size={16} className="flex-shrink-0" />
        <span className="flex-1">
          Sin conexión. Tus acciones se guardan y se sincronizarán automáticamente cuando vuelva la señal.
        </span>
      </div>
    </div>
  );
}
