/**
 * Worker de sincronización: procesa la cola de operaciones encoladas.
 *
 * Triggers que disparan un flush:
 *   1. Al cargar la app (si hay operaciones pendientes y estamos online)
 *   2. Cuando el browser dispara `online` (volvió la conexión)
 *   3. Manualmente desde la UI (botón "Reintentar todo")
 *
 * Reglas:
 *   - Procesa una operación a la vez (en orden FIFO por createdAt)
 *   - Si la operación tiene éxito → la elimina de la queue
 *   - Si falla por error de red (status 0 o offline) → la deja, reintenta más tarde
 *   - Si falla por error 4xx (validación, conflict, forbidden) → la marca con error,
 *     incrementa attempts. Si attempts ≥ 5 → la deja "muerta" para revisión manual
 *   - Si falla por 5xx → la deja, reintentará después
 *   - Throttle: 300ms entre operaciones para no saturar
 */

import { API_BASE_URL } from "@/lib/api/config";
import { getAccessToken, getRefreshToken, saveTokens, isAccessTokenExpired } from "@/lib/api/auth-storage";
import { queue, subscribeQueueChanges, type QueuedOperation } from "./queue";
import { saveVisitIdMapping, getAllVisitIdMappings, clearOldMappings } from "./visit-id-map";
import { savePdvIdMapping, getAllPdvIdMappings, clearOldPdvMappings } from "./pdv-id-map";
import { saveRouteIdMapping, getAllRouteIdMappings, clearOldRouteMappings } from "./route-id-map";


const MAX_ATTEMPTS = 5;
const THROTTLE_MS = 300;

let isFlushing = false;
let listenersAttached = false;


// ============================================================================
// Token refresh para el sync worker
// ============================================================================
async function ensureFreshToken(): Promise<string | null> {
  if (!isAccessTokenExpired()) {
    return getAccessToken();
  }
  const refresh = getRefreshToken();
  if (!refresh) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return null;
    const data: { access_token: string; expires_in: number } = await res.json();
    saveTokens({
      accessToken: data.access_token,
      refreshToken: refresh,
      expiresInSeconds: data.expires_in,
    });
    console.info("[sync-worker] access token refreshed successfully");
    return data.access_token;
  } catch {
    return null;
  }
}


// ============================================================================
// Ejecución de una operación
// ============================================================================
async function executeOperation(op: QueuedOperation): Promise<{ ok: true; data?: unknown } | { ok: false; status: number; message: string }> {
  const token = await ensureFreshToken();
  const headers: Record<string, string> = {
    ...(op.headers ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (op.formParts && op.formParts.length > 0) {
    // Multipart (foto)
    const form = new FormData();
    for (const part of op.formParts) {
      if (part.value instanceof Blob) {
        form.append(part.name, part.value, part.filename ?? `file-${Date.now()}`);
      } else {
        form.append(part.name, part.value);
      }
    }
    body = form;
    // No setear Content-Type, el browser pone el boundary
  } else if (op.body !== undefined && op.body !== null) {
    body = JSON.stringify(op.body);
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${op.url}`, {
      method: op.method,
      headers,
      body,
    });
  } catch (e) {
    // Error de red (offline, DNS, server down)
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
  }

  if (res.ok) {
    let data: unknown;
    try { data = await res.json(); } catch { data = undefined; }
    return { ok: true, data };
  }

  // Error HTTP. Capturamos el detail si vino.
  let detail = res.statusText;
  try {
    const data = await res.json();
    detail = (data as { detail?: string })?.detail ?? detail;
  } catch {
    /* ignore */
  }
  return { ok: false, status: res.status, message: detail };
}


// ============================================================================
// Flush de toda la queue
// ============================================================================
export async function flushQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
  if (isFlushing) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  if (!navigator.onLine) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  isFlushing = true;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  // Mapas de tempId → realId. Cargamos los persistidos de flushes anteriores.
  const visitIdMap = await getAllVisitIdMappings().catch(() => new Map<number, number>());
  const pdvIdMap = await getAllPdvIdMappings().catch(() => new Map<number, number>());
  const routeIdMap = await getAllRouteIdMappings().catch(() => new Map<number, number>());

  try {
    // Limpiar mapeos viejos (>7 días)
    await clearOldMappings(7).catch(() => {});
    await clearOldPdvMappings(7).catch(() => {});
    await clearOldRouteMappings(7).catch(() => {});
    const ops = await queue.list();
    for (const op of ops) {
      // Skip si superó el límite de intentos (queda "muerta" para revisión manual)
      if (op.attempts >= MAX_ATTEMPTS) continue;

      // Skip DELETE operations targeting temp IDs (negative) — resource never existed on server
      if (op.method === "DELETE" && op.url.match(/\/-\d+/)) {
        await queue.remove(op.id!);
        continue;
      }

      // Re-check online (puede haberse cortado a mitad del flush)
      if (!navigator.onLine) break;

      // Si esta op depende de un tempVisitId, reemplazar en la URL
      if (op._tempVisitId && visitIdMap.has(op._tempVisitId)) {
        const realId = visitIdMap.get(op._tempVisitId)!;
        op.url = op.url.replace(`/${op._tempVisitId}/`, `/${realId}/`);
        op.url = op.url.replace(`/${op._tempVisitId}`, `/${realId}`);
        // También en el body si tiene VisitId
        if (op.body && typeof op.body === "object" && (op.body as Record<string, unknown>).VisitId === op._tempVisitId) {
          (op.body as Record<string, unknown>).VisitId = realId;
        }
      } else if (op._tempVisitId && !visitIdMap.has(op._tempVisitId) && op.kind !== "visit_create") {
        // Depende de un visit_create que todavía no se resolvió. Saltear por ahora.
        continue;
      }

      // Si esta op depende de un tempPdvId, reemplazar en la URL
      if (op._tempPdvId && pdvIdMap.has(op._tempPdvId)) {
        const realId = pdvIdMap.get(op._tempPdvId)!;
        op.url = op.url.replace(`/${op._tempPdvId}/`, `/${realId}/`);
        op.url = op.url.replace(`/${op._tempPdvId}`, `/${realId}`);
        if (op.body && typeof op.body === "object" && (op.body as Record<string, unknown>).PdvId === op._tempPdvId) {
          (op.body as Record<string, unknown>).PdvId = realId;
        }
      } else if (op._tempPdvId && !pdvIdMap.has(op._tempPdvId) && op.kind !== "pdv_create") {
        // Depende de un pdv_create que todavía no se resolvió. Saltear.
        continue;
      }

      // Si esta op depende de un tempRouteId, reemplazar en la URL
      if (op._tempRouteId && routeIdMap.has(op._tempRouteId)) {
        const realId = routeIdMap.get(op._tempRouteId)!;
        op.url = op.url.replace(`/${op._tempRouteId}/`, `/${realId}/`);
        op.url = op.url.replace(`/${op._tempRouteId}`, `/${realId}`);
        if (op.body && typeof op.body === "object" && (op.body as Record<string, unknown>).RouteId === op._tempRouteId) {
          (op.body as Record<string, unknown>).RouteId = realId;
        }
      } else if (op._tempRouteId && !routeIdMap.has(op._tempRouteId) && op.kind !== "route_create") {
        continue;
      }

      processed++;
      const result = await executeOperation(op);

      if (result.ok) {
        // Si fue un visit_create, extraer el VisitId real de la respuesta
        if (op.kind === "visit_create" && op._tempVisitId && result.data) {
          try {
            const created = result.data as { VisitId?: number };
            if (created.VisitId) {
              visitIdMap.set(op._tempVisitId, created.VisitId);
              // Persistir para que sobreviva entre flushes
              await saveVisitIdMapping(op._tempVisitId, created.VisitId).catch(() => {});
              console.info(`[sync-worker] tempVisitId ${op._tempVisitId} → realId ${created.VisitId} (persistido)`);
            }
          } catch { /* noop */ }
        }
        // Si fue un pdv_create, extraer el PdvId real de la respuesta
        if (op.kind === "pdv_create" && op._tempPdvId && result.data) {
          try {
            const created = result.data as { PdvId?: number };
            if (created.PdvId) {
              pdvIdMap.set(op._tempPdvId, created.PdvId);
              await savePdvIdMapping(op._tempPdvId, created.PdvId).catch(() => {});
              console.info(`[sync-worker] tempPdvId ${op._tempPdvId} → realId ${created.PdvId} (persistido)`);
              // Limpiar cache del PDV temporal + invalidar listas
              try {
                localStorage.removeItem(`espert.cache.pdv_${op._tempPdvId}`);
                Object.keys(localStorage)
                  .filter((k) => k.startsWith("espert.cache.pdvs_"))
                  .forEach((k) => localStorage.removeItem(k));
              } catch { /* noop */ }
            }
          } catch { /* noop */ }
        }
        // Si fue un route_create, extraer el RouteId real
        if (op.kind === "route_create" && op._tempRouteId && result.data) {
          try {
            const created = result.data as { RouteId?: number };
            if (created.RouteId) {
              routeIdMap.set(op._tempRouteId, created.RouteId);
              await saveRouteIdMapping(op._tempRouteId, created.RouteId).catch(() => {});
              console.info(`[sync-worker] tempRouteId ${op._tempRouteId} → realId ${created.RouteId} (persistido)`);
            }
          } catch { /* noop */ }
        }
        await queue.remove(op.id!);
        succeeded++;
      } else if (result.status === 0) {
        // Error de red — la dejamos. Volverá a reintentarse cuando vuelva `online`.
        await queue.update({
          ...op,
          lastAttemptAt: Date.now(),
          lastError: result.message,
        });
        failed++;
        // Si volvió a fallar la red, probablemente no tiene sentido seguir intentando ahora
        break;
      } else if (result.status === 401) {
        // Token expiró durante el flush — intentar refresh y reintentar esta op una vez
        const freshToken = await ensureFreshToken();
        if (freshToken) {
          const retry = await executeOperation(op);
          if (retry.ok) {
            await queue.remove(op.id!);
            succeeded++;
          } else {
            await queue.update({
              ...op,
              attempts: op.attempts + 1,
              lastAttemptAt: Date.now(),
              lastError: `HTTP ${retry.ok ? 200 : (retry as { status: number }).status}: retry after refresh failed`,
            });
            failed++;
          }
        } else {
          // No se pudo refrescar — no tiene sentido seguir, el usuario tiene que re-loguear
          console.warn("[sync-worker] token refresh failed, stopping flush");
          await queue.update({
            ...op,
            lastAttemptAt: Date.now(),
            lastError: "Token expirado, requiere re-login",
          });
          failed++;
          break;
        }
      } else if (result.status >= 400 && result.status < 500) {
        // Error de cliente (400, 403, 404, 409, 422). Reintentar no va a arreglarlo.
        const newAttempts = op.attempts + 1;
        await queue.update({
          ...op,
          attempts: newAttempts,
          lastAttemptAt: Date.now(),
          lastError: `HTTP ${result.status}: ${result.message}`,
        });
        failed++;
      } else {
        // 5xx: error de servidor. Reintentar después.
        await queue.update({
          ...op,
          attempts: op.attempts + 1,
          lastAttemptAt: Date.now(),
          lastError: `HTTP ${result.status}: ${result.message}`,
        });
        failed++;
      }

      // Throttle entre operaciones
      if (THROTTLE_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS));
      }
    }
  } finally {
    isFlushing = false;
  }

  return { processed, succeeded, failed };
}


// ============================================================================
// Auto-trigger del flush
// ============================================================================
let flushTimeout: number | null = null;

function scheduleFlush(delayMs = 500) {
  if (flushTimeout !== null) {
    window.clearTimeout(flushTimeout);
  }
  flushTimeout = window.setTimeout(() => {
    flushTimeout = null;
    flushQueue().catch((e) => console.warn("[sync-worker] flush failed:", e));
  }, delayMs) as unknown as number;
}

/**
 * Inicializa los listeners. Llamar una sola vez al cargar la app.
 */
export function initSyncWorker(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  // Cuando vuelve la conexión, intentamos flush
  window.addEventListener("online", () => {
    console.info("[sync-worker] online detected, scheduling flush");
    scheduleFlush(800);
  });

  // Al cargar la app, si hay operaciones encoladas y estamos online → flush
  if (navigator.onLine) {
    queue.count().then((n) => {
      if (n > 0) {
        console.info(`[sync-worker] ${n} pending ops at boot, flushing`);
        scheduleFlush(2000); // damos tiempo al login/setup primero
      }
    });
  }

  // Cada vez que se agrega algo a la queue, intentamos flush (si estamos online)
  subscribeQueueChanges(() => {
    if (navigator.onLine) {
      scheduleFlush(500);
    }
  });

  // Exponer en window para debug
  if (typeof window !== "undefined") {
    (window as unknown as { __espertFlush?: typeof flushQueue }).__espertFlush = flushQueue;
  }
}
