import { Eye, LogOut } from "lucide-react";
import { isImpersonating, getCurrentUser, getImpersonationOriginUser, stopImpersonation } from "../lib/auth";

/**
 * Barra fija visible mientras un admin está "viendo como" otro usuario.
 * Permite volver a la cuenta admin original con un click.
 */
export function ImpersonationBanner() {
  if (!isImpersonating()) return null;

  const viewing = getCurrentUser();
  const admin = getImpersonationOriginUser();

  const handleExit = () => {
    stopImpersonation();
    // Reload completo a /admin para resetear todo el estado en memoria.
    window.location.href = "/admin/users";
  };

  return (
    <div className="sticky top-0 z-50 flex items-center gap-2 bg-amber-500 text-amber-950 px-3 py-2 text-xs font-medium shadow-sm">
      <Eye size={14} className="shrink-0" />
      <span className="flex-1 min-w-0 truncate">
        Estás viendo como <strong>{viewing.name}</strong>
        {admin ? <> · sesión de {admin.name}</> : null}
      </span>
      <button
        onClick={handleExit}
        className="shrink-0 flex items-center gap-1 rounded-md bg-amber-950/90 px-2.5 py-1 text-[11px] font-semibold text-white active:bg-amber-950"
      >
        <LogOut size={12} />
        Volver a mi cuenta
      </button>
    </div>
  );
}
