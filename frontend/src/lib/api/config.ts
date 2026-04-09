/**
 * URL del backend.
 * En localhost usa VITE_API_URL directo.
 * En ngrok/remoto usa /api-proxy (Vite proxy redirige al backend).
 */
const isLocalhost = typeof window !== "undefined" && (
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
);

export const API_BASE_URL = isLocalhost
  ? (import.meta.env.VITE_API_URL ?? "http://localhost:8001")
  : "/api-proxy";
