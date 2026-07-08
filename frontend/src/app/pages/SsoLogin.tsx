import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { authApi, ApiError } from "@/lib/api";
import { persistSession } from "../lib/auth";

/** Autologin desde el Command Center Espert.
 *
 * El Command Center redirige a `/sso#ticket=<JWT>`. El ticket viaja en el
 * fragment (nunca llega al servidor ni a los logs del SWA). Acá lo canjeamos
 * por una sesión normal vía POST /auth/sso y seguimos el mismo post-login que
 * la pantalla de Login. Cualquier fallo → /login.
 */
export function SsoLogin() {
  const navigate = useNavigate();
  // El jti del ticket es de un solo uso: guard contra el doble-run de
  // useEffect en StrictMode para no quemar el ticket con una llamada duplicada.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const ticket = new URLSearchParams(window.location.hash.slice(1)).get("ticket");
    // Sacar el ticket de la URL de inmediato (no dejarlo en el historial).
    window.history.replaceState(null, "", window.location.pathname);

    if (!ticket) {
      navigate("/login", { replace: true });
      return;
    }

    (async () => {
      try {
        const resp = await authApi.sso(ticket);
        // persistSession ya descarta el estado offline si cambia el usuario.
        persistSession(resp);
        if (resp.MustChangePassword) {
          toast.info("Tenés que cambiar tu contraseña antes de continuar");
          window.dispatchEvent(new CustomEvent("espert:must-change-password"));
        }
        const role = (resp.Role || "").toLowerCase();
        navigate(role === "admin" || role === "regional_manager" ? "/admin" : "/", { replace: true });
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "No se pudo iniciar sesión automáticamente");
        navigate("/login", { replace: true });
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      <div className="w-24 h-24 flex items-center justify-center mb-5">
        <img src="/espert-logo-white.png" alt="Espert" className="w-24 h-24 object-contain" />
      </div>
      <h1 className="text-3xl font-bold text-white tracking-tight">ESPERT</h1>
      <p className="text-sm text-[#979B9B] mt-2 tracking-widest uppercase">Trade Marketing</p>
      <div className="mt-8 flex items-center gap-3 text-[#A48242]">
        <span className="inline-block w-4 h-4 rounded-full border-2 border-[#A48242] border-t-transparent animate-spin" />
        <span className="text-sm font-medium">Ingresando…</span>
      </div>
    </div>
  );
}
