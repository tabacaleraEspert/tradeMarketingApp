import { Outlet, useNavigate, useLocation } from "react-router";
import { Home, MapPin, AlertCircle, RefreshCw, User } from "lucide-react";
import { useEffect } from "react";

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect to login if not authenticated (simple check for demo)
  useEffect(() => {
    const isAuthenticated = localStorage.getItem("isAuthenticated");
    if (!isAuthenticated && location.pathname !== "/login") {
      navigate("/login");
    }
  }, [navigate, location]);

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-slate-200 px-2 py-2 safe-area-bottom">
        <div className="flex items-center justify-around max-w-md mx-auto">
          <button
            onClick={() => navigate("/")}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
              isActive("/") && location.pathname === "/"
                ? "text-blue-600 bg-blue-50"
                : "text-slate-600"
            }`}
          >
            <Home size={24} />
            <span className="text-xs font-medium">Inicio</span>
          </button>

          <button
            onClick={() => navigate("/search-pdv")}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
              isActive("/search-pdv") || isActive("/route") || location.pathname.includes("/pos")
                ? "text-blue-600 bg-blue-50"
                : "text-slate-600"
            }`}
          >
            <MapPin size={24} />
            <span className="text-xs font-medium">Buscar PDV</span>
          </button>

          <button
            onClick={() => navigate("/alerts")}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
              isActive("/alerts") ? "text-blue-600 bg-blue-50" : "text-slate-600"
            }`}
          >
            <AlertCircle size={24} />
            <span className="text-xs font-medium">Alertas</span>
          </button>

          <button
            onClick={() => navigate("/sync")}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
              isActive("/sync") ? "text-blue-600 bg-blue-50" : "text-slate-600"
            }`}
          >
            <RefreshCw size={24} />
            <span className="text-xs font-medium">Sync</span>
          </button>

          <button
            onClick={() => navigate("/profile")}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
              isActive("/profile") ? "text-blue-600 bg-blue-50" : "text-slate-600"
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
