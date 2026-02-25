import { Outlet, useNavigate, useLocation } from "react-router";
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
  Wifi,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isOnline] = useState(true);

  const menuItems = [
    { path: "/admin", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/admin/pos-management", icon: MapPin, label: "Gestión PDV" },
    { path: "/admin/routes", icon: Route, label: "Rutas Foco" },
    { path: "/admin/forms", icon: FileText, label: "Formularios" },
    { path: "/admin/reports", icon: BarChart3, label: "Reportes" },
  ];

  const isActivePath = (path: string) => {
    if (path === "/admin") {
      return location.pathname === "/admin";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors lg:hidden"
            >
              {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 rounded-lg p-2">
                <MapPin size={24} className="text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Trade Marketing</h1>
                <p className="text-xs text-slate-500">Panel de Administración</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Connection Status */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100">
              {isOnline ? (
                <>
                  <Wifi size={16} className="text-green-600" />
                  <span className="text-xs font-medium text-green-700">Online</span>
                </>
              ) : (
                <>
                  <WifiOff size={16} className="text-red-600" />
                  <span className="text-xs font-medium text-red-700">Offline</span>
                </>
              )}
            </div>

            {/* Notifications */}
            <button className="relative p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <Bell size={20} />
              <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs">
                3
              </Badge>
            </button>

            {/* User Menu */}
            <button
              onClick={() => navigate("/profile")}
              className="flex items-center gap-2 px-3 py-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <div className="bg-blue-100 rounded-full p-2">
                <User size={16} className="text-blue-600" />
              </div>
              <div className="text-left hidden md:block">
                <p className="text-sm font-semibold text-slate-900">Admin User</p>
                <p className="text-xs text-slate-500">Administrador</p>
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
          } lg:translate-x-0 fixed lg:sticky top-16 left-0 h-[calc(100vh-4rem)] w-64 bg-white border-r border-slate-200 transition-transform duration-300 z-20`}
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
                      ? "bg-blue-50 text-blue-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-50"
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
              className="w-full"
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