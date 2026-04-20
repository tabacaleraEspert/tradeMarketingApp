/**
 * Almacenamiento de tokens JWT.
 *
 * Usa localStorage. Sí, localStorage es vulnerable a XSS, pero para el piloto es aceptable:
 * no procesamos contenido de terceros, no embebemos iframes, los inputs están sanitizados por React,
 * y no usamos eval. Si más adelante hacemos un audit de seguridad, evaluamos httpOnly cookies.
 *
 * Claves:
 *   espert.access_token   → JWT access (expira en 8h)
 *   espert.refresh_token  → JWT refresh (expira en 7 días)
 *   espert.token_expires  → timestamp ms de expiración del access
 */

const ACCESS_KEY = "espert.access_token";
const REFRESH_KEY = "espert.refresh_token";
const EXPIRES_KEY = "espert.token_expires";

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export function saveTokens(bundle: TokenBundle): void {
  localStorage.setItem(ACCESS_KEY, bundle.accessToken);
  localStorage.setItem(REFRESH_KEY, bundle.refreshToken);
  const expiresAt = Date.now() + bundle.expiresInSeconds * 1000;
  localStorage.setItem(EXPIRES_KEY, String(expiresAt));
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function getTokenExpiresAt(): number | null {
  const v = localStorage.getItem(EXPIRES_KEY);
  return v ? Number(v) : null;
}

export function isAccessTokenExpired(skewSeconds = 30): boolean {
  const exp = getTokenExpiresAt();
  if (!exp) return true;
  // Consideramos expirado si faltan menos de `skewSeconds` para vencer
  return Date.now() + skewSeconds * 1000 >= exp;
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRES_KEY);
  // También limpiamos el user legacy
  localStorage.removeItem("user");
  localStorage.removeItem("isAuthenticated");
}
