import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Wifi, WifiOff, Shield, UserRound } from "lucide-react";
import { toast } from "sonner";
import { authApi, ApiError } from "@/lib/api";

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isOnline] = useState(true);
  const [loading, setLoading] = useState(false);

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    setLoading(true);
    try {
      const user = await authApi.login(loginEmail, loginPassword);
      localStorage.setItem("isAuthenticated", "true");
      localStorage.setItem("user", JSON.stringify({
        id: String(user.UserId),
        name: user.DisplayName,
        email: user.Email,
        zone: user.ZoneName || user.ZoneId ? `Zona #${user.ZoneId}` : "-",
        zoneId: user.ZoneId ?? undefined,
        role: user.Role || "vendedor",
      }));
      toast.success("Sesion iniciada correctamente");
      navigate("/");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al iniciar sesion");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Por favor complete todos los campos");
      return;
    }
    await doLogin(email, password);
  };

  const quickUsers = [
    { label: "Admin", email: "admin@test.com", password: "Admin123!", icon: "shield", color: "text-red-400" },
    { label: "Trade Rep (Carlos)", email: "trade@test.com", password: "TradeRep123!", icon: "user", color: "text-[#A48242]" },
    { label: "TM - Alejandro", email: "alejandro.perez@espert.com", password: "TmRep123!", icon: "user", color: "text-blue-400" },
    { label: "TM - Valentina", email: "valentina.torres@espert.com", password: "TmRep123!", icon: "user", color: "text-pink-400" },
    { label: "TM - Nicolás", email: "nicolas.garcia@espert.com", password: "TmRep123!", icon: "user", color: "text-green-400" },
    { label: "Territory Mgr", email: "martin.rodriguez@espert.com", password: "TmRep123!", icon: "shield", color: "text-purple-400" },
  ];

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      {/* Logo Area */}
      <div className="w-full max-w-md mb-8 text-center">
        <div className="mb-6">
          {/* Espert isotipo */}
          <div className="w-20 h-20 mx-auto bg-white dark:bg-white/10 rounded-full flex items-center justify-center mb-5 border-2 border-[#A48242]">
            <svg viewBox="0 0 60 60" className="w-12 h-12" fill="none">
              <circle cx="30" cy="30" r="28" stroke="#A48242" strokeWidth="2" fill="none" />
              <rect x="27" y="10" width="6" height="20" rx="1" fill="#A48242" />
              <path d="M30 30 L18 42 Q16 44 18 44 L30 38" fill="#A48242" opacity="0.8" />
              <path d="M30 30 L42 42 Q44 44 42 44 L30 38" fill="#A48242" opacity="0.8" />
              <path d="M30 30 L22 40 Q20 42 22 42 L30 36" fill="#A48242" />
              <path d="M30 30 L38 40 Q40 42 38 42 L30 36" fill="#A48242" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">ESPERT</h1>
          <p className="text-sm text-[#979B9B] mt-2 tracking-widest uppercase">Trade Marketing</p>
        </div>
      </div>

      {/* Login Form */}
      <div className="w-full max-w-md bg-[#1A1A18] rounded-xl shadow-2xl p-6 border border-white/5">
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[#979B9B]">Usuario / Email</Label>
            <Input
              id="email"
              type="text"
              placeholder="Ingrese su email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 bg-[#252520] border-white/10 text-white placeholder:text-[#53565A] focus:border-[#A48242] focus:ring-[#A48242]/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-[#979B9B]">Contrasena</Label>
            <Input
              id="password"
              type="password"
              placeholder="Ingrese su contrasena"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 bg-[#252520] border-white/10 text-white placeholder:text-[#53565A] focus:border-[#A48242] focus:ring-[#A48242]/20"
            />
          </div>

          <Button
            type="submit"
            className="w-full h-12 text-base font-semibold bg-[#A48242] hover:bg-[#8B6E38] text-white border-0"
            disabled={loading}
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </Button>

          <button
            type="button"
            className="w-full text-center text-sm text-[#A48242] hover:text-[#C9A962] font-medium"
          >
            Olvidaste tu contrasena?
          </button>
        </form>

        {/* Quick Login */}
        <div className="mt-6 pt-6 border-t border-white/10">
          <p className="text-xs text-[#53565A] text-center mb-3 font-medium uppercase tracking-widest">
            Acceso rápido (dev)
          </p>
          <div className="grid grid-cols-3 gap-2">
            {quickUsers.map((u) => (
              <Button
                key={u.email}
                type="button"
                variant="outline"
                className="h-auto py-2 px-2 gap-1 flex-col border-white/10 text-[#979B9B] hover:bg-[#252520] hover:text-white hover:border-[#A48242] text-[11px]"
                disabled={loading}
                onClick={() => doLogin(u.email, u.password)}
              >
                {u.icon === "shield" ? (
                  <Shield size={15} className={u.color} />
                ) : (
                  <UserRound size={15} className={u.color} />
                )}
                <span className="truncate w-full text-center">{u.label}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Connection Status */}
        <div className="mt-6 pt-6 border-t border-white/10">
          <div className="flex items-center justify-center gap-2 text-sm">
            {isOnline ? (
              <>
                <Wifi size={16} className="text-[#A48242]" />
                <span className="text-[#A48242] font-medium">Conectado</span>
              </>
            ) : (
              <>
                <WifiOff size={16} className="text-red-500" />
                <span className="text-red-500 font-medium">Sin conexion</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-[#53565A] text-xs">
        <p>Version 2.1.0</p>
        <p className="mt-1">Espert Trade Marketing</p>
      </div>
    </div>
  );
}
