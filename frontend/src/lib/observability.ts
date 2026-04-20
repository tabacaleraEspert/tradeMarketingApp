/**
 * Inicialización condicional de Sentry para el frontend.
 *
 * Si VITE_SENTRY_DSN está seteado en build time → activa Sentry React.
 * Si NO → no se activa nada (los errores siguen yendo a console.error).
 *
 * Para activarlo en producción, en el .env del frontend:
 *
 *   VITE_SENTRY_DSN=https://abc123@o12345.ingest.sentry.io/67890
 *   VITE_SENTRY_ENVIRONMENT=production
 *   VITE_APP_RELEASE=v1.0.0
 *
 * Crear cuenta en https://sentry.io/signup/ (free tier: 5K events/mes).
 *
 * Notas:
 * - Usamos dynamic import para que el bundle NO incluya @sentry/react cuando
 *   el DSN está vacío (build dev/local). Reduce el bundle inicial.
 * - El init es idempotente: si lo llamás dos veces no pasa nada.
 */

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined) || "";
const ENVIRONMENT = (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || "development";
const RELEASE = (import.meta.env.VITE_APP_RELEASE as string | undefined) || "dev";

let initialized = false;
// Tipo any porque @sentry/react puede no estar instalado en dev local
// (es una dependencia opcional sólo para producción)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sentryRef: any = null;

export async function initObservability(): Promise<void> {
  if (initialized || !DSN) return;
  initialized = true;

  try {
    // Construir el module name dinámicamente para que Vite no lo analice
    // estáticamente. Si @sentry/react no está instalado, el import falla
    // en runtime y caemos al catch (modo dev sin Sentry).
    const sentryPkg = "@sentry/react";
    const Sentry = await import(/* @vite-ignore */ sentryPkg);
    sentryRef = Sentry;

    Sentry.init({
      dsn: DSN,
      environment: ENVIRONMENT,
      release: RELEASE,
      // Bajo nivel de tracing: sólo errores, no APM (sale más caro)
      tracesSampleRate: 0,
      // No mandar info de usuarios sin filtrar
      sendDefaultPii: false,
      // Hook para limpiar datos sensibles antes de mandar
      beforeSend(event) {
        if (event.request) {
          const headers = event.request.headers as Record<string, string> | undefined;
          if (headers) {
            for (const k of Object.keys(headers)) {
              if (k.toLowerCase() === "authorization" || k.toLowerCase() === "cookie") {
                headers[k] = "[REDACTED]";
              }
            }
          }
        }
        return event;
      },
    });

    console.info("[Sentry] Inicializado", { environment: ENVIRONMENT, release: RELEASE });
  } catch (e) {
    console.warn("[Sentry] No se pudo inicializar, ¿faltó `npm install @sentry/react`?", e);
  }
}

/** Adjunta info del usuario logueado al scope de Sentry. */
export function setObservabilityUser(user: { id: string; email: string; role?: string } | null): void {
  if (!sentryRef) return;
  if (user) {
    sentryRef.setUser({ id: user.id, email: user.email, role: user.role });
  } else {
    sentryRef.setUser(null);
  }
}

/** Captura una excepción manualmente (úsalo en catches críticos donde quieras report extra). */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!sentryRef) {
    console.error("[Captured]", error, context);
    return;
  }
  sentryRef.captureException(error, { extra: context });
}

/** Indica si Sentry está activo (útil para condicionales en UI). */
export function isObservabilityEnabled(): boolean {
  return initialized && !!sentryRef;
}
