import { Outlet, useNavigate, useLocation, Navigate } from "react-router";
import {
  LayoutDashboard,
  MapPin,
  Route,
  FileText,
  BarChart3,
  Menu,
  X,
  Bell,
  User,
  Users,
  Wifi,
  WifiOff,
  Layers,
  ClipboardList,
  Package,
  Eye,
  Shield,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { authApi, type MeResponse } from "../../lib/api/services";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  regional_manager: "Regional Manager",
  territory_manager: "Territory Manager",
  ejecutivo: "Ejecutivo",
  vendedor: "TM Rep",
};

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const [currentUser, setCurrentUser] = useState<MeResponse | null>(null);

  const [roleKicked, setRoleKicked] = useState(false);

  useEffect(() => {
    authApi.me().then((me) => {
      setCurrentUser(me);
      const adminRoles = ["admin", "regional_manager", "territory_manager", "ejecutivo"];
      if (!adminRoles.includes(me.Role || "")) {
        setRoleKicked(true);
      }
    }).catch(() => {
      setRoleKicked(true);
    });
  }, []);

  if (roleKicked) {
    return <Navigate to="/" replace />;
  }

  const menuItems = [
    { path: "/admin", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/admin/pos-management", icon: MapPin, label: "Gestion PDV" },
    { path: "/admin/channels", icon: Layers, label: "Canales" },
    { path: "/admin/products", icon: Package, label: "Productos" },
    { path: "/admin/routes", icon: Route, label: "Rutas Foco" },
    { path: "/admin/territory", icon: Users, label: "Territorio" },
    { path: "/admin/forms", icon: ClipboardList, label: "Plantillas de Visita" },
    { path: "/admin/notifications", icon: Bell, label: "Notificaciones" },
    { path: "/admin/reports", icon: BarChart3, label: "Reportes" },
    { path: "/admin/visit-data", icon: Eye, label: "Censos y Respuestas" },
    { path: "/admin/users", icon: Users, label: "Usuarios" },
    { path: "/admin/audit", icon: Shield, label: "Auditoría" },
  ];

  const isActivePath = (path: string) => {
    if (path === "/admin") {
      return location.pathname === "/admin";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Header */}
      <header className="bg-card border-b border-border sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-muted rounded-lg transition-colors lg:hidden"
            >
              {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <div className="flex items-center gap-3">
              <div className="bg-black rounded-lg p-2 flex items-center justify-center">
                <img src="/espert-logo-white.png" alt="Espert" className="w-7 h-7 object-contain" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground tracking-tight">ESPERT</h1>
                <p className="text-xs text-muted-foreground tracking-wider uppercase">Administracion</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Connection Status */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
              {isOnline ? (
                <>
                  <Wifi size={16} className="text-espert-gold" />
                  <span className="text-xs font-medium text-espert-gold">Online</span>
                </>
              ) : (
                <>
                  <WifiOff size={16} className="text-destructive" />
                  <span className="text-xs font-medium text-destructive">Offline</span>
                </>
              )}
            </div>

            {/* Notifications */}
            <button className="relative p-2 hover:bg-muted rounded-lg transition-colors">
              <Bell size={20} />
            </button>

            {/* User Menu */}
            <button
              onClick={() => navigate("/profile")}
              className="flex items-center gap-2 px-3 py-2 hover:bg-muted rounded-lg transition-colors"
            >
              <div className="bg-espert-gold/10 dark:bg-espert-gold/20 rounded-full p-2">
                <User size={16} className="text-espert-gold" />
              </div>
              <div className="text-left hidden md:block">
                <p className="text-sm font-semibold text-foreground">{currentUser?.DisplayName ?? "..."}</p>
                <p className="text-xs text-muted-foreground">{currentUser ? (ROLE_LABELS[currentUser.Role] ?? currentUser.Role) : ""}</p>
              </div>
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`${
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0 fixed lg:sticky top-16 left-0 h-[calc(100vh-4rem)] w-64 bg-card border-r border-border transition-transform duration-300 z-20`}
        >
          <nav className="p-4 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = isActivePath(item.path);

              return (
                <button
                  key={item.path}
                  onClick={() => {
                    navigate(item.path);
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? "bg-secondary text-espert-gold font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon size={20} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Back to Mobile */}
          <div className="absolute bottom-4 left-4 right-4">
            <Button
              variant="outline"
              className="w-full border-espert-gold/30 text-espert-gold hover:bg-espert-gold/10"
              onClick={() => navigate("/")}
            >
              Volver a Modo Campo
            </Button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 min-h-[calc(100vh-4rem)]">
          <Outlet />
        </main>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-10 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
}
