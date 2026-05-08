/**
 * URL del backend.
 * Siempre usa VITE_API_URL si está definido (en .env.production apunta al backend real).
 * Fallback: localhost:8001 para dev, /api-proxy para ngrok.
 *
 * En Capacitor (app nativa), no hay proxy posible — siempre usa la URL absoluta.
 */
const envUrl = import.meta.env.VITE_API_URL as string | undefined;

const isCapacitor = typeof window !== "undefined" && !!(window as unknown as { Capacitor?: unknown }).Capacitor;

const isLocalhost = typeof window !== "undefined" && (
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
);

export const API_BASE_URL = envUrl
  ? envUrl
  : isCapacitor
  ? "https://espert-trade-api.azurewebsites.net"
  : isLocalhost
  ? "http://localhost:8001"
  : "/api-proxy";
