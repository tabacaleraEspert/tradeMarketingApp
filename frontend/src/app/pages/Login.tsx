import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { authApi, ApiError } from "@/lib/api";

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isOnline] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error("Por favor complete todos los campos");
      return;
    }

    setLoading(true);
    try {
      const user = await authApi.login(email, password);
      localStorage.setItem("isAuthenticated", "true");
      localStorage.setItem("user", JSON.stringify({
        id: String(user.UserId),
        name: user.DisplayName,
        email: user.Email,
        zone: user.ZoneName || user.ZoneId ? `Zona #${user.ZoneId}` : "-",
        zoneId: user.ZoneId ?? undefined,
        role: user.Role || "vendedor",
      }));
      toast.success("Sesión iniciada correctamente");
      navigate("/");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex flex-col items-center justify-center p-6">
      {/* Logo Area */}
      <div className="w-full max-w-md mb-8 text-center">
        <div className="bg-white rounded-2xl p-8 mb-6 shadow-xl">
          <div className="w-20 h-20 mx-auto bg-blue-600 rounded-xl flex items-center justify-center mb-4">
            <span className="text-white text-3xl font-bold">TM</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Trade Marketing</h1>
          <p className="text-sm text-slate-600 mt-2">Gestión de Punto de Venta</p>
        </div>
      </div>

      {/* Login Form */}
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Usuario / Email</Label>
            <Input
              id="email"
              type="text"
              placeholder="Ingrese su email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              placeholder="Ingrese su contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12"
            />
          </div>

          <Button
            type="submit"
            className="w-full h-12 text-base font-semibold"
            disabled={loading}
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </Button>

          <button
            type="button"
            className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </form>

        {/* Connection Status */}
        <div className="mt-6 pt-6 border-t border-slate-200">
          <div className="flex items-center justify-center gap-2 text-sm">
            {isOnline ? (
              <>
                <Wifi size={16} className="text-green-600" />
                <span className="text-green-600 font-medium">Conectado</span>
              </>
            ) : (
              <>
                <WifiOff size={16} className="text-red-600" />
                <span className="text-red-600 font-medium">Sin conexión</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-white/60 text-xs">
        <p>Versión 2.1.0</p>
        <p className="mt-1">© 2026 Trade Marketing App</p>
      </div>
    </div>
  );
}
