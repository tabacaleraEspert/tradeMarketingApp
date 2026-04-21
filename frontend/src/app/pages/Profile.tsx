import { useEffect, useRef, useState } from "react";
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
  Camera,
  Trash2,
} from "lucide-react";
import { getCurrentUser, logout } from "../lib/auth";
import { useUserMonthlyStats, usersApi, ApiError } from "@/lib/api";
import { toast } from "sonner";

export function Profile() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleLogout = () => {
    logout();
    toast.success("Sesión cerrada correctamente");
    navigate("/login");
  };

  const getRoleBadge = (role: string) => {
    const badges: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
      vendedor: { label: "Vendedor", variant: "default" },
      ejecutivo: { label: "Ejecutivo", variant: "secondary" },
      territory_manager: { label: "Territory Manager", variant: "secondary" },
      regional_manager: { label: "Regional Manager", variant: "secondary" },
      admin: { label: "Administrador", variant: "outline" },
    };
    return badges[role] || badges.vendedor;
  };

  const currentUser = getCurrentUser();
  const userId = Number(currentUser.id) || undefined;
  const { data: stats, loading: statsLoading } = useUserMonthlyStats(userId);
  const roleBadge = getRoleBadge(currentUser.role);

  // Cargar avatar actual del usuario
  useEffect(() => {
    if (!userId) return;
    usersApi
      .get(userId)
      .then((u) => setAvatarUrl(u.AvatarUrl ?? null))
      .catch(() => setAvatarUrl(null));
  }, [userId]);

  const handlePickAvatar = () => fileInputRef.current?.click();

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Sólo se permiten imágenes");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("La imagen es demasiado grande (máx 5 MB)");
      return;
    }
    setUploadingAvatar(true);
    try {
      const updated = await usersApi.uploadAvatar(userId, file);
      setAvatarUrl(updated.AvatarUrl ?? null);
      toast.success("Foto actualizada");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al subir la foto");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!userId || !avatarUrl) return;
    if (!confirm("¿Eliminar tu foto de perfil?")) return;
    try {
      const updated = await usersApi.deleteAvatar(userId);
      setAvatarUrl(updated.AvatarUrl ?? null);
      toast.success("Foto eliminada");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al eliminar");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#A48242] to-[#8B6E38] text-white p-6 pb-20">
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarSelected}
          />
          <div className="relative inline-block mb-4">
            <button
              type="button"
              onClick={handlePickAvatar}
              disabled={uploadingAvatar}
              className="relative bg-white/20 rounded-full w-24 h-24 flex items-center justify-center overflow-hidden border-2 border-white/40 hover:border-white transition-colors group disabled:opacity-50"
              title="Cambiar foto"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={currentUser.name} className="w-full h-full object-cover" />
              ) : (
                <User size={48} className="text-white" />
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera size={20} className="text-white" />
              </div>
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                className="absolute -bottom-1 -right-1 bg-rose-600 text-white rounded-full h-10 w-10 flex items-center justify-center hover:bg-rose-700 shadow-lg"
                title="Eliminar foto"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {uploadingAvatar && (
            <p className="text-xs text-white/80 mb-2">Subiendo foto...</p>
          )}
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
            <h3 className="font-semibold text-foreground mb-3">Información de Contacto</h3>
            
            <div className="flex items-center gap-3">
              <div className="bg-espert-gold/10 rounded-full p-2">
                <Mail size={18} className="text-espert-gold" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium text-foreground">{currentUser.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-espert-gold/10 rounded-full p-2">
                <Phone size={18} className="text-espert-gold" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Teléfono</p>
                <p className="text-sm font-medium text-foreground">+54 11 1234-5678</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-green-100 rounded-full p-2">
                <MapPin size={18} className="text-green-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Zona Asignada</p>
                <p className="text-sm font-medium text-foreground">{currentUser.zone}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-orange-100 rounded-full p-2">
                <Briefcase size={18} className="text-orange-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">ID de Usuario</p>
                <p className="text-sm font-medium text-foreground font-mono">
                  USR-{currentUser.id.padStart(6, "0")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-foreground mb-3">Estadísticas del Mes</h3>
            {statsLoading ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-muted-foreground">-</p>
                  <p className="text-xs text-muted-foreground mt-1">Visitas</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-muted-foreground">-</p>
                  <p className="text-xs text-muted-foreground mt-1">Cumplimiento</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-muted-foreground">-</p>
                  <p className="text-xs text-muted-foreground mt-1">PDV Nuevos</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-espert-gold">
                    {stats?.visits ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Visitas</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-green-600">
                    {stats?.compliance ?? 0}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Cumplimiento</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-espert-gold">
                    {stats?.new_pdvs ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">PDV Nuevos</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Options */}
        <div className="space-y-2">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-muted rounded-full p-2">
                  <Settings size={20} className="text-muted-foreground" />
                </div>
                <span className="flex-1 font-medium text-foreground">Configuración</span>
                <ChevronRight size={20} className="text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-espert-gold/10 rounded-full p-2">
                  <HelpCircle size={20} className="text-espert-gold" />
                </div>
                <span className="flex-1 font-medium text-foreground">Ayuda y Soporte</span>
                <ChevronRight size={20} className="text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* App Info */}
        <Card className="bg-muted">
          <CardContent className="p-4">
            <div className="text-center text-sm text-muted-foreground">
              <p className="font-semibold text-foreground mb-1">Trade Marketing App</p>
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
