import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  ArrowLeft,
  User,
  MapPin,
  Mail,
  Phone,
  Briefcase,
  HelpCircle,
  LogOut,
  ChevronRight,
  Settings,
} from "lucide-react";
import { getCurrentUser } from "../lib/auth";
import { toast } from "sonner";

export function Profile() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("user");
    toast.success("Sesión cerrada correctamente");
    navigate("/login");
  };

  const getRoleBadge = (role: string) => {
    const badges = {
      vendedor: { label: "Vendedor", variant: "default" as const },
      supervisor: { label: "Supervisor", variant: "secondary" as const },
      admin: { label: "Administrador", variant: "outline" as const },
    };
    return badges[role as keyof typeof badges] || badges.vendedor;
  };

  const currentUser = getCurrentUser();
  const roleBadge = getRoleBadge(currentUser.role as "vendedor" | "supervisor" | "admin");

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 pb-20">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-xl font-bold">Perfil</h1>
        </div>

        {/* Profile Avatar */}
        <div className="text-center">
          <div className="bg-white/20 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-4">
            <User size={48} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-1">{currentUser.name}</h2>
          <Badge variant={roleBadge.variant} className="mb-2">
            {roleBadge.label}
          </Badge>
        </div>
      </div>

      <div className="px-4 -mt-12 space-y-4 pb-4">
        {/* Contact Info */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold text-slate-900 mb-3">Información de Contacto</h3>
            
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 rounded-full p-2">
                <Mail size={18} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-slate-500">Email</p>
                <p className="text-sm font-medium text-slate-900">{currentUser.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-purple-100 rounded-full p-2">
                <Phone size={18} className="text-purple-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-slate-500">Teléfono</p>
                <p className="text-sm font-medium text-slate-900">+54 11 1234-5678</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-green-100 rounded-full p-2">
                <MapPin size={18} className="text-green-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-slate-500">Zona Asignada</p>
                <p className="text-sm font-medium text-slate-900">{currentUser.zone}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-orange-100 rounded-full p-2">
                <Briefcase size={18} className="text-orange-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-slate-500">ID de Usuario</p>
                <p className="text-sm font-medium text-slate-900 font-mono">
                  USR-{currentUser.id.padStart(6, "0")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-slate-900 mb-3">Estadísticas del Mes</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">45</p>
                <p className="text-xs text-slate-600 mt-1">Visitas</p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">87%</p>
                <p className="text-xs text-slate-600 mt-1">Cumplimiento</p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-2xl font-bold text-purple-600">12</p>
                <p className="text-xs text-slate-600 mt-1">PDV Nuevos</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Options */}
        <div className="space-y-2">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-slate-100 rounded-full p-2">
                  <Settings size={20} className="text-slate-600" />
                </div>
                <span className="flex-1 font-medium text-slate-900">Configuración</span>
                <ChevronRight size={20} className="text-slate-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 rounded-full p-2">
                  <HelpCircle size={20} className="text-blue-600" />
                </div>
                <span className="flex-1 font-medium text-slate-900">Ayuda y Soporte</span>
                <ChevronRight size={20} className="text-slate-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* App Info */}
        <Card className="bg-slate-50">
          <CardContent className="p-4">
            <div className="text-center text-sm text-slate-600">
              <p className="font-semibold text-slate-900 mb-1">Trade Marketing App</p>
              <p>Versión 2.1.0</p>
              <p className="mt-2">© 2026 Todos los derechos reservados</p>
            </div>
          </CardContent>
        </Card>

        {/* Logout Button */}
        <Button
          variant="destructive"
          className="w-full h-12 font-semibold"
          onClick={handleLogout}
        >
          <LogOut size={18} className="mr-2" />
          Cerrar Sesión
        </Button>
      </div>
    </div>
  );
}
