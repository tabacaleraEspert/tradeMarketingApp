import { useEffect, useState } from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { Toaster } from "./components/ui/sonner";
import { useArgentinaTheme } from "./lib/useArgentinaTheme";
import { SelectedDateProvider } from "./lib/SelectedDateContext";
import { setUnauthorizedHandler } from "@/lib/api/client";
import { isAuthenticated, logout, getStoredUser } from "./lib/auth";
import { authApi } from "@/lib/api";
import { ForcePasswordChangeModal } from "./components/ForcePasswordChangeModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OfflineBanner } from "./components/OfflineBanner";
import { PendingSyncIndicator } from "./components/PendingSyncSheet";
import { initObservability, setObservabilityUser } from "@/lib/observability";
import "@/lib/offline/queue"; // expone window.__espertQueue para debug
import { initSyncWorker } from "@/lib/offline/sync-worker";
import { toast } from "sonner";

// Inicializar observability al cargar el módulo, no esperar al primer render
initObservability();
initSyncWorker();

export default function App() {
  useArgentinaTheme();

  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    // Cuando el backend devuelve 401 en una ruta autenticada, cerramos sesión y volvemos al login.
    setUnauthorizedHandler(() => {
      logout();
      toast.error("Tu sesión expiró. Volvé a ingresar.");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Al iniciar (o después de un login), chequeamos si el usuario necesita cambiar contraseña
  useEffect(() => {
    if (!isAuthenticated() || window.location.pathname === "/login") return;

    // Adjuntar info del user logueado al scope de Sentry para que los errores
    // futuros sepan a quién le ocurrieron
    const stored = getStoredUser();
    if (stored) {
      setObservabilityUser({ id: stored.id, email: stored.email, role: stored.role });
    }

    authApi
      .me()
      .then((me) => {
        if (me.MustChangePassword) {
          setMustChangePassword(true);
        }
      })
      .catch(() => { /* 401 ya lo maneja el interceptor */ });
  }, []);

  // Listener para el evento que dispara Login.tsx cuando el user recién logueado
  // tiene MustChangePassword=true. App.tsx no se re-monta entre /login y /, así
  // que necesitamos un evento explícito.
  useEffect(() => {
    const handler = () => setMustChangePassword(true);
    window.addEventListener("espert:must-change-password", handler);
    return () => window.removeEventListener("espert:must-change-password", handler);
  }, []);

  return (
    <ErrorBoundary>
      <SelectedDateProvider>
        <OfflineBanner />
        <RouterProvider router={router} />
        <Toaster />
        <PendingSyncIndicator />
        <ForcePasswordChangeModal
          isOpen={mustChangePassword}
          onSuccess={() => setMustChangePassword(false)}
        />
      </SelectedDateProvider>
    </ErrorBoundary>
  );
}
