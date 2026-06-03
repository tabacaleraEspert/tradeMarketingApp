import { Outlet, useNavigate, useLocation } from "react-router";
import { Home, MapPin, AlertCircle, RefreshCw, User } from "lucide-react";
import { useEffect } from "react";
import { isAuthenticated } from "../lib/auth";

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isAuthenticated() && location.pathname !== "/login") {
      navigate("/login");
    }
  }, [navigate, location]);

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background pt-[env(safe-area-inset-top)]">
      {/* Main Content.
          Nota: `will-change: scroll-position` es un hint seguro al compositor
          para mitigar ghosting de Chromium en Android. NO usamos `isolation:
          isolate` ni `contain` ni `translateZ(0)` porque crean stacking context
          y/o containing block, lo cual hace que los CTAs `position: fixed` de
          las pages queden por DEBAJO del nav (que es sibling a nivel root). */}
      <main
        className="flex-1 overflow-auto"
        style={{ willChange: "scroll-position" }}
      >
        <div className="max-w-lg mx-auto">
          <Outlet />
        </div>
      </main>

      {/* Bottom Navigation - Espert brand */}
      <nav className="shrink-0 bg-card border-t border-border px-2 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-around max-w-md mx-auto">
          <button
            onClick={() => navigate("/")}
            aria-label="Inicio"
            className={`flex flex-col items-center justify-center gap-1 px-4 py-2 min-h-[56px] rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[#A48242] focus-visible:ring-offset-1 ${
              isActive("/") && location.pathname === "/"
                ? "text-espert-gold bg-secondary"
                : "text-muted-foreground"
            }`}
          >
            <Home size={24} />
            <span className="text-xs font-medium">Inicio</span>
          </button>

          <button
            onClick={() => navigate("/search-pdv")}
            aria-label="Buscar PDV"
            className={`flex flex-col items-center justify-center gap-1 px-4 py-2 min-h-[56px] rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[#A48242] focus-visible:ring-offset-1 ${
              isActive("/search-pdv") || isActive("/route") || location.pathname.includes("/pos")
                ? "text-espert-gold bg-secondary"
                : "text-muted-foreground"
            }`}
          >
            <MapPin size={24} />
            <span className="text-xs font-medium">Buscar PDV</span>
          </button>

          <button
            onClick={() => navigate("/alerts")}
            aria-label="Alertas"
            className={`flex flex-col items-center justify-center gap-1 px-4 py-2 min-h-[56px] rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[#A48242] focus-visible:ring-offset-1 ${
              isActive("/alerts") ? "text-espert-gold bg-secondary" : "text-muted-foreground"
            }`}
          >
            <AlertCircle size={24} />
            <span className="text-xs font-medium">Alertas</span>
          </button>

          <button
            onClick={() => navigate("/sync")}
            aria-label="Sincronizar"
            className={`flex flex-col items-center justify-center gap-1 px-4 py-2 min-h-[56px] rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[#A48242] focus-visible:ring-offset-1 ${
              isActive("/sync") ? "text-espert-gold bg-secondary" : "text-muted-foreground"
            }`}
          >
            <RefreshCw size={24} />
            <span className="text-xs font-medium">Sync</span>
          </button>

          <button
            onClick={() => navigate("/profile")}
            aria-label="Perfil"
            className={`flex flex-col items-center justify-center gap-1 px-4 py-2 min-h-[56px] rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[#A48242] focus-visible:ring-offset-1 ${
              isActive("/profile") ? "text-espert-gold bg-secondary" : "text-muted-foreground"
            }`}
          >
            <User size={24} />
            <span className="text-xs font-medium">Perfil</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
