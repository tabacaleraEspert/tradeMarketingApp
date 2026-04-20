/**
 * Wrapper de alto nivel para ejecutar una operación con tolerancia offline.
 *
 * Patrón típico desde un componente:
 *
 *     const result = await executeOrEnqueue({
 *       kind: "visit_check",
 *       method: "POST",
 *       url: `/visits/${visitId}/checks`,
 *       body: { CheckType: "IN", Lat, Lon },
 *       label: "Check-in en Kiosco San Martín",
 *     });
 *     if (result.queued) {
 *       toast.info("Guardado. Se sincronizará cuando vuelva la conexión.");
 *     } else {
 *       toast.success("Check-in registrado");
 *     }
 *
 * Comportamiento:
 *   - Si estamos online → ejecuta la operación inmediatamente. Devuelve `{ ok: true, queued: false, data }`.
 *   - Si estamos offline o el fetch falla por red → encola la operación. Devuelve `{ ok: true, queued: true }`.
 *   - Si el fetch falla por error HTTP (4xx/5xx) → propaga el error. NO encola, porque no es un problema
 *     de conectividad sino de la operación en sí.
 *
 * Para operaciones multipart (fotos), pasar `formParts` en vez de `body`.
 */

import { API_BASE_URL } from "@/lib/api/config";
import { ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/api/auth-storage";
import { queue, type QueuedKind } from "./queue";


export interface ExecuteRequest {
  kind: QueuedKind;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  /** Si esta operación depende de una visita offline, pasar el tempId aquí */
  _tempVisitId?: number;
  body?: unknown;
  formParts?: Array<{ name: string; value: Blob | string; filename?: string }>;
  headers?: Record<string, string>;
  label: string;
}

export type ExecuteResult<T = unknown> =
  | { ok: true; queued: false; data: T }
  | { ok: true; queued: true; queueId: number };


/**
 * Ejecuta la request si hay conexión, si no la encola.
 *
 * Retorna siempre `ok: true` salvo que se levante una excepción por error HTTP real
 * (en ese caso, throw ApiError como cualquier llamada normal).
 */
export async function executeOrEnqueue<T = unknown>(req: ExecuteRequest): Promise<ExecuteResult<T>> {
  // Si estamos offline, encolar directo sin intentar
  if (!navigator.onLine) {
    const queueId = await queue.add({
      kind: req.kind,
      method: req.method,
      url: req.url,
      body: req.body,
      formParts: req.formParts,
      headers: req.headers,
      label: req.label,
      _tempVisitId: req._tempVisitId,
    });
    return { ok: true, queued: true, queueId };
  }

  // Online → intentar la request
  const token = getAccessToken();
  const headers: Record<string, string> = {
    ...(req.headers ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (req.formParts && req.formParts.length > 0) {
    const form = new FormData();
    for (const part of req.formParts) {
      if (part.value instanceof Blob) {
        form.append(part.name, part.value, part.filename ?? `file-${Date.now()}`);
      } else {
        form.append(part.name, part.value);
      }
    }
    body = form;
  } else if (req.body !== undefined && req.body !== null) {
    body = JSON.stringify(req.body);
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${req.url}`, {
      method: req.method,
      headers,
      body,
    });
  } catch (e) {
    // Error de red durante la request → encolar para reintento
    console.warn("[executeOrEnqueue] network error, queueing:", e);
    const queueId = await queue.add({
      kind: req.kind,
      method: req.method,
      url: req.url,
      body: req.body,
      formParts: req.formParts,
      headers: req.headers,
      label: req.label,
      _tempVisitId: req._tempVisitId,
    });
    return { ok: true, queued: true, queueId };
  }

  if (res.ok) {
    let data: T;
    if (res.status === 204) {
      data = undefined as T;
    } else {
      data = await res.json();
    }
    return { ok: true, queued: false, data };
  }

  // Error HTTP → tirar excepción (NO encolar, no es problema de red)
  const requestId = res.headers.get("X-Request-ID");
  let errData: unknown;
  let detail = res.statusText;
  try {
    errData = await res.json();
    detail = (errData as { detail?: string })?.detail || detail;
  } catch {
    /* noop */
  }
  throw new ApiError(detail, res.status, errData, requestId);
}
