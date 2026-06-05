/**
 * Optimistic updates al cache local de visitas cuando una op de escritura se
 * encola offline. Sin esto, los reads (Home `globalOpenVisit`, PointOfSaleDetail
 * `canCheckIn`, próximo PDV) siguen viendo el estado del server pre-encolado
 * y bloquean el flujo siguiente.
 *
 * Diseño:
 *   - Cada función solo lee/escribe localStorage (sync, sin IndexedDB).
 *   - Si el cache no existe (nunca se trajo), no hacemos nada — el read posterior
 *     tampoco lo va a tener, así que no hay inconsistencia.
 *   - Si la op falla al sincronizar después, el flush worker eventualmente trae
 *     datos frescos del server y sobrescribe estos cambios. Riesgo aceptado:
 *     una ventana corta donde el cache local dice CLOSED pero el server dice
 *     OPEN. Para CLOSE eso es OK (es lo que el usuario quiere).
 */

import { readCache, writeCache } from "./cache";

const CACHE_PREFIX = "espert.cache.";

interface CachedVisit {
  VisitId: number;
  PdvId: number;
  Status: string;
  [k: string]: unknown;
}

interface CachedHomeData {
  openVisit: { VisitId: number; PdvId: number; PdvName?: string; Status: string } | null;
  [k: string]: unknown;
}

/**
 * Marca una visita como OPEN (recién iniciada) en todos los caches relevantes.
 *
 * Sin esto, tras un check-in (sobre todo offline/temp) los reads siguen viendo el
 * estado pre-check-in: PointOfSaleDetail no encuentra `openVisit` → `canCheckIn`
 * vuelve a `true` → el botón de check-in reaparece y el usuario inicia una SEGUNDA
 * visita (bug "editar dirección duplica la visita": editar el PDV dispara loadData,
 * que reexpone el botón). Es el inverso de `markVisitClosedLocally`.
 *
 * Caches actualizados (mismo set que el close):
 *   - visits_pdv_{pdvId}  → usado por PointOfSaleDetail.canCheckIn
 *   - visits_user_{userId} → usado por el fallback globalOpenVisit
 *   - dashboard_home_{date} → setea openVisit para la tarjeta "Visita en curso"
 */
export function markVisitOpenLocally(
  visitId: number,
  pdvId: number,
  userId: number,
  opts?: { routeDayId?: number | null; pdvName?: string }
): void {
  const now = new Date().toISOString();
  const openRow: CachedVisit = {
    VisitId: visitId,
    PdvId: pdvId,
    UserId: userId,
    Status: "OPEN",
    OpenedAt: now,
    ClosedAt: null,
    RouteDayId: opts?.routeDayId ?? null,
  };

  const upsertOpen = (key: string) => {
    const list = readCache<CachedVisit[]>(key);
    if (!list) return; // cache nunca traído → un read posterior tampoco lo tiene
    const idx = list.findIndex((v) => v.VisitId === visitId);
    const next = idx >= 0
      ? list.map((v) => (v.VisitId === visitId ? { ...v, ...openRow } : v))
      : [openRow, ...list];
    writeCache(key, next);
  };

  // 1. visits_pdv_{pdvId}
  upsertOpen(`visits_pdv_${pdvId}`);
  // 2. visits_user_{userId}
  upsertOpen(`visits_user_${userId}`);

  // 3. dashboard_home_{date} — setear openVisit (inverso del clear en close).
  const homePrefix = `${CACHE_PREFIX}dashboard_home_`;
  for (const fullKey of Object.keys(localStorage)) {
    if (!fullKey.startsWith(homePrefix)) continue;
    const key = fullKey.slice(CACHE_PREFIX.length);
    const data = readCache<CachedHomeData>(key);
    if (data && !data.openVisit) {
      writeCache(key, {
        ...data,
        openVisit: { VisitId: visitId, PdvId: pdvId, PdvName: opts?.pdvName, Status: "OPEN" },
      });
    }
  }
}

/**
 * Marca una visita como CLOSED en todos los caches relevantes.
 *
 * Caches actualizados:
 *   - visits_user_{userId}: la lista de visitas del usuario (usada para detectar
 *     `globalOpenVisit` en el fallback del Home).
 *   - visits_pdv_{pdvId}: la lista de visitas del PDV (usada por
 *     PointOfSaleDetail para `canCheckIn`).
 *   - dashboard_home_{date}: limpia `openVisit` si era esta misma visita.
 */
export function markVisitClosedLocally(
  visitId: number,
  pdvId: number,
  userId: number
): void {
  // 1. visits_user_{userId}
  const userKey = `visits_user_${userId}`;
  const userVisits = readCache<CachedVisit[]>(userKey);
  if (userVisits) {
    const updated = userVisits.map((v) =>
      v.VisitId === visitId ? { ...v, Status: "CLOSED" } : v
    );
    writeCache(userKey, updated);
  }

  // 2. visits_pdv_{pdvId}
  const pdvKey = `visits_pdv_${pdvId}`;
  const pdvVisits = readCache<CachedVisit[]>(pdvKey);
  if (pdvVisits) {
    const updated = pdvVisits.map((v) =>
      v.VisitId === visitId ? { ...v, Status: "CLOSED" } : v
    );
    writeCache(pdvKey, updated);
  }

  // 3. dashboard_home_{date} — iterar todos porque no sabemos qué fecha tiene
  // el usuario activa. Solo limpiamos openVisit si era esta.
  const homePrefix = `${CACHE_PREFIX}dashboard_home_`;
  for (const fullKey of Object.keys(localStorage)) {
    if (!fullKey.startsWith(homePrefix)) continue;
    const key = fullKey.slice(CACHE_PREFIX.length);
    const data = readCache<CachedHomeData>(key);
    if (data?.openVisit?.VisitId === visitId) {
      writeCache(key, { ...data, openVisit: null });
    }
  }
}
