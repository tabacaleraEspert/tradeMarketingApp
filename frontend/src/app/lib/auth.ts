import { saveTokens, clearTokens, getAccessToken } from "@/lib/api/auth-storage";
import type { LoginResponse } from "@/lib/api";
import { clearAllOfflineState } from "@/lib/offline/queue";

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  zone: string;
  zoneId?: number;
  managerId?: number;
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
  const previous = getStoredUser();
  const newUserId = String(login.UserId);
  // Si en este browser entra un usuario distinto al anterior, descartar el
  // estado offline (queue + id_maps). Esas operaciones pertenecen al user
  // anterior y no se pueden enviar correctamente con el token del nuevo.
  if (previous && previous.id !== newUserId) {
    clearAllOfflineState().catch(() => { /* no bloquear el login */ });
  }
  saveTokens({
    accessToken: login.access_token,
    refreshToken: login.refresh_token,
    expiresInSeconds: login.expires_in,
  });
  const user: StoredUser = {
    id: newUserId,
    name: login.DisplayName,
    email: login.Email,
    zone: login.ZoneName || (login.ZoneId ? `Zona #${login.ZoneId}` : "-"),
    zoneId: login.ZoneId ?? undefined,
    managerId: login.ManagerUserId ?? undefined,
    role: login.Role || "vendedor",
  };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem("isAuthenticated", "true");
}

/** Refresca el rol del usuario desde el backend (silencioso, no bloquea). */
export async function refreshUserRole(): Promise<void> {
  const token = getAccessToken();
  const user = getStoredUser();
  if (!token || !user) return;
  try {
    const res = await fetch(
      `${(await import("@/lib/api/config")).API_BASE_URL}/users/${user.id}/role`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.roleName && data.roleName !== user.role) {
      const updated = { ...user, role: data.roleName };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      console.info(`[auth] Role updated: ${user.role} → ${data.roleName}`);
    }
  } catch { /* silent */ }
}

/** Cierra sesión: borra tokens y user. El caller es responsable de redirigir a /login. */
export function logout(): void {
  clearTokens();
}

/** True si hay un access token presente (no valida expiración, eso lo hace el client al llamar). */
export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
