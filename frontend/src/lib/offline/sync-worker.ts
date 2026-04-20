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
import { getAccessToken } from "@/lib/api/auth-storage";
import { queue, subscribeQueueChanges, type QueuedOperation } from "./queue";
import { saveVisitIdMapping, getAllVisitIdMappings, clearOldMappings } from "./visit-id-map";


const MAX_ATTEMPTS = 5;
const THROTTLE_MS = 300;

let isFlushing = false;
let listenersAttached = false;


// ============================================================================
// Ejecución de una operación
// ============================================================================
async function executeOperation(op: QueuedOperation): Promise<{ ok: true; data?: unknown } | { ok: false; status: number; message: string }> {
  const token = getAccessToken();
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

  // Mapa de tempVisitId → realVisitId. Cargamos los persistidos de flushes anteriores
  // + los que se resuelvan en este flush.
  const visitIdMap = await getAllVisitIdMappings().catch(() => new Map<number, number>());

  try {
    // Limpiar mapeos viejos (>7 días)
    await clearOldMappings(7).catch(() => {});
    const ops = await queue.list();
    for (const op of ops) {
      // Skip si superó el límite de intentos (queda "muerta" para revisión manual)
      if (op.attempts >= MAX_ATTEMPTS) continue;

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
      } else if (result.status >= 400 && result.status < 500) {
        // Error de cliente. Reintentar no va a arreglarlo, pero le damos algunos
        // intentos por si fue un transient (ej: 401 que se resuelve después de un refresh)
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
