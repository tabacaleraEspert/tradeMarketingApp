import { saveTokens, clearTokens, getAccessToken } from "@/lib/api/auth-storage";
import type { LoginResponse } from "@/lib/api";

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  zone: string;
  zoneId?: number;
  role: string;
}

const USER_KEY = "user";

export function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function getCurrentUser(): StoredUser {
  const user = getStoredUser();
  return (
    user ?? {
      id: "0",
      name: "Usuario",
      email: "",
      zone: "-",
      role: "vendedor",
    }
  );
}

/** Guarda la sesión completa (token + user) tras un login exitoso. */
export function persistSession(login: LoginResponse): void {
  saveTokens({
    accessToken: login.access_token,
    refreshToken: login.refresh_token,
    expiresInSeconds: login.expires_in,
  });
  const user: StoredUser = {
    id: String(login.UserId),
    name: login.DisplayName,
    email: login.Email,
    zone: login.ZoneName || (login.ZoneId ? `Zona #${login.ZoneId}` : "-"),
    zoneId: login.ZoneId ?? undefined,
    role: login.Role || "vendedor",
  };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem("isAuthenticated", "true");
}

/** Cierra sesión: borra tokens y user. El caller es responsable de redirigir a /login. */
export function logout(): void {
  clearTokens();
}

/** True si hay un access token presente (no valida expiración, eso lo hace el client al llamar). */
export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
