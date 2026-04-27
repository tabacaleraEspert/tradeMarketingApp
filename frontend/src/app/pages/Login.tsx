import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Wifi, WifiOff, Shield, UserRound } from "lucide-react";
import { toast } from "sonner";
import { authApi, ApiError } from "@/lib/api";
import { persistSession } from "../lib/auth";

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isOnline] = useState(true);
  const [loading, setLoading] = useState(false);

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    setLoading(true);
    try {
      const resp = await authApi.login(loginEmail, loginPassword);
      persistSession(resp);
      if (resp.MustChangePassword) {
        toast.info("Tenés que cambiar tu contraseña antes de continuar");
        window.dispatchEvent(new CustomEvent("espert:must-change-password"));
      } else {
        toast.success("Sesion iniciada correctamente");
      }
      // Admin y regional_manager entran directo al panel admin
      const role = (resp.Role || "").toLowerCase();
      if (role === "admin" || role === "regional_manager") {
        navigate("/admin");
      } else {
        navigate("/");
      }
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

  // Acceso rápido DEV — solo para desarrollo local
  const isDev = import.meta.env.DEV;
  const DEV_PW = "Espert2026!";
  const demoUsers = [
    { label: "Equipo País",           sub: "Admin — acceso total",               email: "equipo.pais",          password: DEV_PW, icon: "shield", color: "text-amber-400" },
    { label: "Martín Lezcano",        sub: "Gte Regional — Región BA",           email: "martin.lezcano",       password: DEV_PW, icon: "shield", color: "text-violet-400" },
    { label: "Sebastián Morales",     sub: "TM Rep — GBA (347 PDVs cargados)",   email: "sebastian.morales",    password: DEV_PW, icon: "user",   color: "text-emerald-400" },
  ];

  const otherUsers = [
    { label: "Ariel Muñoz",       email: "ariel.munoz",        password: DEV_PW, icon: "user", color: "text-[#979B9B]" },
    { label: "Franco García",     email: "franco.garcia",      password: DEV_PW, icon: "user", color: "text-[#979B9B]" },
    { label: "Germán Jaretchi",   email: "german.jaretchi",    password: DEV_PW, icon: "user", color: "text-[#979B9B]" },
    { label: "Carlos Guardia",    email: "carlos.guardia",     password: DEV_PW, icon: "user", color: "text-[#979B9B]" },
  ];

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      {/* Logo Area */}
      <div className="w-full max-w-md mb-8 text-center">
        <div className="mb-6">
          {/* Espert isotipo */}
          <div className="w-24 h-24 mx-auto flex items-center justify-center mb-5">
            <img src="/espert-logo-white.png" alt="Espert" className="w-24 h-24 object-contain" />
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

        {/* Quick Login — solo en desarrollo */}
        {isDev && <div className="mt-6 pt-6 border-t border-white/10">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-xs text-emerald-400 text-center font-bold uppercase tracking-widest">
              Demo · Acceso rápido
            </p>
          </div>
          <div className="space-y-2">
            {demoUsers.map((u) => (
              <button
                key={u.email}
                type="button"
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-[#252520] hover:bg-[#2f2f28] border border-white/5 hover:border-[#A48242]/40 transition-all disabled:opacity-50 group"
                disabled={loading}
                onClick={() => doLogin(u.email, u.password)}
              >
                <div className="bg-black/40 rounded-lg p-2 group-hover:bg-[#A48242]/10 transition-colors">
                  {u.icon === "shield" ? (
                    <Shield size={18} className={u.color} />
                  ) : (
                    <UserRound size={18} className={u.color} />
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{u.label}</p>
                  <p className="text-[11px] text-[#979B9B] truncate">{u.sub}</p>
                </div>
                <span className="text-[10px] text-[#53565A] group-hover:text-[#A48242] font-medium uppercase tracking-wider">
                  Entrar
                </span>
              </button>
            ))}
          </div>

          {/* Otros TM Reps demo (sin ruta hoy, sólo aparecen como huérfanos en el listado) */}
          <details className="mt-3">
            <summary className="text-[11px] text-[#53565A] cursor-pointer hover:text-[#979B9B] text-center">
              Otros usuarios demo
            </summary>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {otherUsers.map((u) => (
                <Button
                  key={u.email}
                  type="button"
                  variant="outline"
                  className="h-auto py-2 px-2 gap-1 border-white/10 text-[#979B9B] hover:bg-[#252520] hover:text-white hover:border-[#A48242] text-[11px]"
                  disabled={loading}
                  onClick={() => doLogin(u.email, u.password)}
                >
                  <UserRound size={13} className={u.color} />
                  <span className="truncate">{u.label}</span>
                </Button>
              ))}
            </div>
          </details>
        </div>}

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
