import { API_BASE_URL } from "./config";
import {
  getAccessToken,
  getRefreshToken,
  saveTokens,
  clearTokens,
  isAccessTokenExpired,
} from "./auth-storage";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown,
    public requestId?: string | null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Convierte un status HTTP + detail en un mensaje amigable para mostrar al usuario.
 * El detail del backend (si viene) tiene prioridad, con fallbacks por status.
 */
function friendlyErrorMessage(status: number, detail: string | null, requestId?: string | null): string {
  const rid = requestId ? ` (cod: ${requestId})` : "";
  if (status === 0 || status === -1) {
    return "Sin conexión al servidor. Revisá tu WiFi/datos e intentá de nuevo.";
  }
  if (status === 401) {
    return detail || "Tu sesión expiró, volvé a ingresar.";
  }
  if (status === 403) {
    return detail || "No tenés permiso para hacer esta acción.";
  }
  if (status === 404) {
    return detail || "No se encontró el recurso.";
  }
  if (status === 409) {
    return detail || "Conflicto: el recurso ya existe o no se puede modificar.";
  }
  if (status === 400 || status === 422) {
    return detail || "Datos inválidos. Revisá el formulario.";
  }
  if (status >= 500) {
    return `Error del servidor${rid}. Si persiste, avisale al administrador.`;
  }
  return detail || `Error ${status}`;
}

// Rutas que NO requieren token (público)
const PUBLIC_PATHS = ["/auth/login", "/auth/refresh", "/health", "/"];

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "?"));
}

// ============ Global handlers ============
// Si `onUnauthorized` se setea, se invoca cuando una llamada autenticada devuelve 401 (token inválido/expirado).
let onUnauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorizedHandler = fn;
}

// ============ Refresh token logic ============
// Evita lanzar múltiples refresh al mismo tiempo: si ya hay uno en curso, esperamos a que termine.
let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  const refresh = getRefreshToken();
  if (!refresh) return false;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const data: { access_token: string; expires_in: number } = await res.json();
      saveTokens({
        accessToken: data.access_token,
        // refresh token sigue siendo el mismo (nuestro backend sólo rota el access)
        refreshToken: refresh,
        expiresInSeconds: data.expires_in,
      });
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const requestId = res.headers.get("X-Request-ID");
  if (!res.ok) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      try {
        data = await res.text();
      } catch {
        data = null;
      }
    }
    const detail = (data as { detail?: string } | null)?.detail || null;
    throw new ApiError(
      friendlyErrorMessage(res.status, detail, requestId),
      res.status,
      data,
      requestId
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

type RequestOptions = RequestInit & { params?: Record<string, string | number | boolean | undefined> };

async function doFetch(url: string, init: RequestInit, withAuth: boolean): Promise<Response> {
  const headers = new Headers(init.headers || {});
  // Si viene Content-Type vacío (trick de upload), lo removemos para que el browser setee el boundary multipart
  if (headers.get("Content-Type") === "") {
    headers.delete("Content-Type");
  } else if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (withAuth) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  try {
    return await fetch(url, { ...init, headers });
  } catch (e) {
    // Falla de red (navegador sin conexión, CORS, DNS, server down)
    throw new ApiError(
      friendlyErrorMessage(0, null),
      0,
      { cause: String(e) },
      null
    );
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, ...init } = options;

  let url = `${API_BASE_URL}${path}`;
  if (params) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        search.set(k, String(v));
      }
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const needsAuth = !isPublicPath(path);

  // Si vamos a llamar a una ruta protegida y el access está por expirar, intentamos refrescarlo preventivamente.
  if (needsAuth && isAccessTokenExpired() && getRefreshToken()) {
    await tryRefreshAccessToken();
  }

  let res = await doFetch(url, init, needsAuth);

  // Si el backend rechaza por 401 y es una ruta autenticada, intentamos refresh y reintentamos UNA vez.
  if (res.status === 401 && needsAuth) {
    const ok = await tryRefreshAccessToken();
    if (ok) {
      res = await doFetch(url, init, needsAuth);
    }
    if (res.status === 401) {
      clearTokens();
      if (onUnauthorizedHandler) {
        try { onUnauthorizedHandler(); } catch { /* noop */ }
      }
    }
  }

  return handleResponse<T>(res);
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined>) =>
    apiRequest<T>(path, { method: "GET", params }),

  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),

  patch: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),

  put: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),

  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),

  /**
   * Upload multipart/form-data. El Content-Type lo setea el browser
   * con el boundary correcto — por eso pasamos un header vacío que
   * sobreescribe el default JSON.
   */
  upload: <T>(path: string, form: FormData) =>
    apiRequest<T>(path, {
      method: "POST",
      body: form,
      // @ts-expect-error: trick para que doFetch no le ponga Content-Type
      headers: { "Content-Type": "" },
    }),
};
