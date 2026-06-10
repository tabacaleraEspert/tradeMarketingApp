import { saveTokens, clearTokens, getAccessToken, getRefreshToken, getTokenExpiresAt } from "@/lib/api/auth-storage";
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

/** Refresca rol y zona del usuario desde el backend (silencioso, no bloquea).
 * La zona es clave: si el user se logueó antes de tener zona asignada, la
 * sesión cacheada queda sin zoneId y las altas de PDV salen sin zona. */
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
    const updated = { ...user };
    let changed = false;
    if (data.roleName && data.roleName !== user.role) {
      updated.role = data.roleName;
      changed = true;
      console.info(`[auth] Role updated: ${user.role} → ${data.roleName}`);
    }
    if (data.zoneId != null && data.zoneId !== user.zoneId) {
      updated.zoneId = data.zoneId;
      updated.zone = data.zoneName || `Zona #${data.zoneId}`;
      changed = true;
      console.info(`[auth] Zone updated: ${user.zoneId ?? "-"} → ${data.zoneId}`);
    }
    if (changed) localStorage.setItem(USER_KEY, JSON.stringify(updated));
  } catch { /* silent */ }
}

// ── Impersonation (admin "ingresar como" usuario) ──
// Guardamos la sesión admin original para poder volver. No es un secreto
// compartido: el backend ya validó que quien llamó es admin y lo auditó.
const IMPERSONATION_ORIGIN_KEY = "espert.impersonation_origin";

interface ImpersonationOrigin {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  user: StoredUser | null;
}

/** Inicia la impersonation: stashea la sesión admin actual y activa la del target. */
export function startImpersonation(targetLogin: LoginResponse): void {
  // Evitar anidar impersonations: si ya hay un origin, conservamos el original.
  if (!localStorage.getItem(IMPERSONATION_ORIGIN_KEY)) {
    const origin: ImpersonationOrigin = {
      accessToken: getAccessToken() ?? "",
      refreshToken: getRefreshToken(),
      expiresAt: getTokenExpiresAt(),
      user: getStoredUser(),
    };
    localStorage.setItem(IMPERSONATION_ORIGIN_KEY, JSON.stringify(origin));
  }
  // persistSession limpia el estado offline porque el user cambia → target arranca limpio.
  persistSession(targetLogin);
}

/** Termina la impersonation y restaura la sesión admin original. */
export function stopImpersonation(): void {
  const raw = localStorage.getItem(IMPERSONATION_ORIGIN_KEY);
  if (!raw) return;
  // El estado offline pertenece al usuario impersonado; no debe mezclarse con el admin.
  clearAllOfflineState().catch(() => { /* no bloquear el retorno */ });
  try {
    const origin = JSON.parse(raw) as ImpersonationOrigin;
    const remainingMs = origin.expiresAt ? origin.expiresAt - Date.now() : 0;
    saveTokens({
      accessToken: origin.accessToken,
      refreshToken: origin.refreshToken ?? "",
      // Si el access admin ya venció, el client lo refresca con el refresh token (7 días).
      expiresInSeconds: Math.max(1, Math.floor(remainingMs / 1000)),
    });
    if (origin.user) {
      localStorage.setItem(USER_KEY, JSON.stringify(origin.user));
      localStorage.setItem("isAuthenticated", "true");
    }
  } finally {
    localStorage.removeItem(IMPERSONATION_ORIGIN_KEY);
  }
}

/** True si hay una sesión admin stasheada (estamos impersonando a alguien). */
export function isImpersonating(): boolean {
  return !!localStorage.getItem(IMPERSONATION_ORIGIN_KEY);
}

/** Devuelve el admin original (para mostrar "volver a X"), o null. */
export function getImpersonationOriginUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(IMPERSONATION_ORIGIN_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as ImpersonationOrigin).user;
  } catch {
    return null;
  }
}

/** Cierra sesión: borra tokens y user. El caller es responsable de redirigir a /login. */
export function logout(): void {
  // Si estábamos impersonando, también descartamos la sesión admin stasheada.
  localStorage.removeItem(IMPERSONATION_ORIGIN_KEY);
  clearTokens();
}

/** True si hay un access token presente (no valida expiración, eso lo hace el client al llamar). */
export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
