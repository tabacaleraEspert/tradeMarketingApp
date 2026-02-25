/**
 * URL del backend.
 * Por defecto: http://localhost:8000
 * Sobrescribir con VITE_API_URL en .env
 */
export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:8000";
