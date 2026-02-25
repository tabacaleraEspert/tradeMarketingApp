import { useState, useEffect, useCallback } from "react";
import {
  routesApi,
  pdvsApi,
  visitsApi,
  incidentsApi,
  usersApi,
  zonesApi,
  distributorsApi,
  formsApi,
} from "./services";
import type { Pdv, RouteDayPdv, Incident } from "./types";

/** PDV enriquecido con datos de ruta del día */
export interface RouteDayPdvWithDetails extends RouteDayPdv {
  pdv: Pdv;
}

/**
 * Obtiene los PDVs planificados para una fecha.
 * Busca en todos los route days con WorkDate = date y devuelve los PDVs con sus detalles.
 */
export async function fetchRouteDayPdvsForDate(
  date: Date
): Promise<RouteDayPdvWithDetails[]> {
  const dateStr = date.toISOString().split("T")[0];
  const routes = await routesApi.list();
  const result: RouteDayPdvWithDetails[] = [];
  const seenPdvIds = new Set<number>();

  for (const route of routes) {
    const days = await routesApi.listDays(route.RouteId);
    const matchingDays = days.filter((d) => d.WorkDate.startsWith(dateStr));

    for (const day of matchingDays) {
      const dayPdvs = await routesApi.listDayPdvs(day.RouteDayId);
      for (const rdp of dayPdvs) {
        if (seenPdvIds.has(rdp.PdvId)) continue;
        seenPdvIds.add(rdp.PdvId);
        try {
          const pdv = await pdvsApi.get(rdp.PdvId);
          result.push({ ...rdp, pdv });
        } catch {
          // PDV eliminado, omitir
        }
      }
    }
  }

  return result.sort((a, b) => a.PlannedOrder - b.PlannedOrder);
}

/** Hook para PDVs de ruta por fecha */
export function useRouteDayPdvsForDate(date: Date | null) {
  const [data, setData] = useState<RouteDayPdvWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateKey = date ? date.toISOString().split("T")[0] : null;

  const refetch = useCallback(async () => {
    if (!date) {
      setData([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRouteDayPdvsForDate(date);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [dateKey]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

/** Hook genérico para listar recursos */
export function useApiList<T>(
  fetchFn: () => Promise<T[]>,
  deps: unknown[] = []
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

/** Hook para PDVs con filtros */
export function usePdvs(zoneId?: number, distributorId?: number) {
  return useApiList(
    () => pdvsApi.list({ zone_id: zoneId, distributor_id: distributorId }),
    [zoneId, distributorId]
  );
}

/** Hook para visitas */
export function useVisits(filters?: {
  userId?: number;
  pdvId?: number;
  routeDayId?: number;
  status?: string;
}) {
  return useApiList(() => visitsApi.list(filters), [
    filters?.userId,
    filters?.pdvId,
    filters?.routeDayId,
    filters?.status,
  ]);
}

/** Hook para incidencias */
export function useIncidents(filters?: {
  pdvId?: number;
  visitId?: number;
  status?: string;
}) {
  return useApiList(() => incidentsApi.list(filters), [
    filters?.pdvId,
    filters?.visitId,
    filters?.status,
  ]);
}

/** Hook para zonas */
export function useZones() {
  return useApiList(() => zonesApi.list());
}

/** Hook para usuarios */
export function useUsers() {
  return useApiList(() => usersApi.list());
}

/** Hook para distribuidores */
export function useDistributors() {
  return useApiList(() => distributorsApi.list());
}

/** Hook para formularios */
export function useForms() {
  return useApiList(() => formsApi.list());
}

/** Incidencia con nombre del PDV (para UI Alerts) */
export interface IncidentWithPdvName extends Incident {
  posName?: string;
}

/** Obtiene incidencias con nombre del PDV */
async function fetchIncidentsWithPdvNames(
  filters?: Parameters<typeof incidentsApi.list>[0]
): Promise<IncidentWithPdvName[]> {
  const incidents = await incidentsApi.list(filters);
  const pdvIds = [...new Set(incidents.map((i) => i.PdvId).filter(Boolean))] as number[];
  const pdvMap = new Map<number, string>();
  for (const id of pdvIds) {
    try {
      const pdv = await pdvsApi.get(id);
      pdvMap.set(id, pdv.Name);
    } catch {
      pdvMap.set(id, `PDV #${id}`);
    }
  }
  return incidents.map((i) => ({
    ...i,
    posName: i.PdvId ? pdvMap.get(i.PdvId) : undefined,
  }));
}

/** Hook para incidencias con nombre de PDV */
export function useIncidentsWithPdvNames(filters?: Parameters<typeof incidentsApi.list>[0]) {
  return useApiList(
    () => fetchIncidentsWithPdvNames(filters),
    [filters?.pdvId, filters?.visitId, filters?.status]
  );
}
