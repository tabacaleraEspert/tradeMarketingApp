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
 *   - Si la operación depende de un recurso creado offline (`_tempPdvId` / `_tempVisitId` /
 *     `_tempRouteId` negativo) que todavía no se sincronizó → encola directo aunque haya
 *     conexión (pegarle a la API con un ID negativo daba 404). Si ya se sincronizó, reescribe
 *     el ID real y ejecuta online.
 *
 * Para operaciones multipart (fotos), pasar `formParts` en vez de `body`.
 */

import { API_BASE_URL } from "@/lib/api/config";
import { ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/api/auth-storage";
import { queue, type QueuedKind } from "./queue";
import { getAllPdvIdMappings } from "./pdv-id-map";
import { getAllVisitIdMappings } from "./visit-id-map";
import { getAllRouteIdMappings } from "./route-id-map";


export interface ExecuteRequest {
  kind: QueuedKind;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  /** Si esta operación depende de una visita offline, pasar el tempId aquí */
  _tempVisitId?: number;
  /** Si esta operación depende de un PDV offline, pasar el tempId aquí */
  _tempPdvId?: number;
  /** Si esta operación depende de una ruta offline, pasar el tempId aquí */
  _tempRouteId?: number;
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
    return enqueue(req);
  }

  // Dependencias de recursos creados offline: resolver el ID real o encolar.
  if (!(await resolveTempIds(req))) {
    console.info("[executeOrEnqueue] depende de un recurso offline sin sincronizar, encolando:", req.url);
    return enqueue(req);
  }

  return executeOnline<T>(req);
}


async function enqueue(req: ExecuteRequest): Promise<ExecuteResult<never>> {
  const queueId = await queue.add({
    kind: req.kind,
    method: req.method,
    url: req.url,
    body: req.body,
    formParts: req.formParts,
    headers: req.headers,
    label: req.label,
    _tempVisitId: req._tempVisitId,
    _tempPdvId: req._tempPdvId,
    _tempRouteId: req._tempRouteId,
  });
  return { ok: true, queued: true, queueId };
}


/**
 * Reemplaza tempIds negativos ya sincronizados por el ID real (URL y body).
 * Devuelve false si alguna dependencia todavía no tiene ID real.
 */
async function resolveTempIds(req: ExecuteRequest): Promise<boolean> {
  const deps: Array<{
    tempId: number | undefined;
    createKind: QueuedKind;
    bodyField: string;
    load: () => Promise<Map<number, number>>;
  }> = [
    { tempId: req._tempPdvId, createKind: "pdv_create", bodyField: "PdvId", load: getAllPdvIdMappings },
    { tempId: req._tempVisitId, createKind: "visit_create", bodyField: "VisitId", load: getAllVisitIdMappings },
    { tempId: req._tempRouteId, createKind: "route_create", bodyField: "RouteId", load: getAllRouteIdMappings },
  ];
  for (const dep of deps) {
    // Sólo cuenta como dependencia si es un ID negativo y no es la op que crea ese recurso
    if (!dep.tempId || dep.tempId >= 0 || req.kind === dep.createKind) continue;
    const map = await dep.load().catch(() => new Map<number, number>());
    const realId = map.get(dep.tempId);
    if (realId === undefined) return false;
    req.url = req.url.replace(new RegExp(`/${dep.tempId}(?=/|$)`, "g"), `/${realId}`);
    if (req.body && typeof req.body === "object") {
      const body = req.body as Record<string, unknown>;
      if (body[dep.bodyField] === dep.tempId) body[dep.bodyField] = realId;
    }
  }
  return true;
}


async function executeOnline<T>(req: ExecuteRequest): Promise<ExecuteResult<T>> {
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
    return enqueue(req);
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
