/**
 * URL del backend.
 * Siempre usa VITE_API_URL si está definido (en .env.production apunta al backend real).
 * Fallback: localhost:8001 para dev, /api-proxy para ngrok.
 */
const envUrl = import.meta.env.VITE_API_URL as string | undefined;

const isLocalhost = typeof window !== "undefined" && (
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
);

export const API_BASE_URL = envUrl
  ? envUrl
  : isLocalhost
  ? "http://localhost:8001"
  : "/api-proxy";
