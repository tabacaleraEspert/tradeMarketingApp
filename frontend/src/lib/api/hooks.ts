import { useState, useEffect, useCallback } from "react";
import { fetchWithCache } from "@/lib/offline";
import { api } from "./client";
import {
  routesApi,
  pdvsApi,
  channelsApi,
  subchannelsApi,
  visitsApi,
  incidentsApi,
  notificationsApi,
  usersApi,
  zonesApi,
  distributorsApi,
  formsApi,
} from "./services";
import type { Pdv, RouteDayPdv, Incident } from "./types";

/** PDV enriquecido con datos de ruta del día */
export interface RouteDayPdvWithDetails extends RouteDayPdv {
  pdv: Pdv;
  routeName?: string;
  routeId?: number;
}

/**
 * Obtiene los PDVs planificados para una fecha.
 * Si userId se pasa, solo incluye días asignados a ese usuario (ruta del Trade Rep).
 */
export async function fetchRouteDayPdvsForDate(
  date: Date,
  userId?: number
): Promise<RouteDayPdvWithDetails[]> {
  const dateStr = date.toISOString().split("T")[0];
  const params: Record<string, string | number> = { date: dateStr };
  if (userId != null) params.user_id = userId;

  const items = await api.get<any[]>("/routes/day-detail", params);
  return items.map((item: any) => ({
    RouteDayId: item.RouteDayId,
    PdvId: item.PdvId,
    PlannedOrder: item.PlannedOrder,
    ExecutionStatus: item.ExecutionStatus,
    Priority: item.Priority,
    pdv: item.pdv,
    routeName: item.routeName,
    routeId: item.routeId,
  }));
}

/** Hook para PDVs de ruta por fecha. userId: filtra por ruta asignada al Trade Rep */
export function useRouteDayPdvsForDate(date: Date | null, userId?: number) {
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
      const result = await fetchRouteDayPdvsForDate(date, userId);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [dateKey, userId]);

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
  return useApiList(() => fetchWithCache("zones", () => zonesApi.list()));
}

/** Hook para rutas */
export function useRoutes() {
  return useApiList(() => routesApi.list());
}

/** Hook para rutas asignadas al TM Rep actual (no las que creó, las que tiene a cargo) */
export function useMyRoutes(userId: number | undefined) {
  return useApiList(
    () => (userId ? routesApi.list({ assigned_user_id: userId }) : Promise.resolve([])),
    [userId]
  );
}

/** Hook para canales */
export function useChannels() {
  return useApiList(() => fetchWithCache("channels", () => channelsApi.list()));
}

/** Hook para subcanales (filtrados por canal) */
export function useSubChannels(channelId: number | null | undefined) {
  return useApiList(
    () => (channelId
      ? fetchWithCache(`subchannels_${channelId}`, () => subchannelsApi.list(channelId))
      : Promise.resolve([])),
    [channelId]
  );
}

/** Hook para usuarios */
export function useUsers() {
  return useApiList(() => usersApi.list());
}

/** Hook para estadísticas mensuales del usuario */
export function useUserMonthlyStats(userId: number | undefined) {
  const [data, setData] = useState<{
    visits: number;
    compliance: number;
    new_pdvs: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setData(null);
      return;
    }
    setLoading(true);
    usersApi
      .getMonthlyStats(userId)
      .then(setData)
      .catch(() => setData({ visits: 0, compliance: 0, new_pdvs: 0 }))
      .finally(() => setLoading(false));
  }, [userId]);

  return { data, loading };
}

/** Hook para distribuidores */
export function useDistributors() {
  return useApiList(() => distributorsApi.list());
}

/** Hook para formularios */
export function useForms() {
  return useApiList(() => fetchWithCache("forms_active", () => formsApi.list()));
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

/** Hook para notificaciones activas (vista Trade) */
export function useActiveNotifications(userId?: number) {
  return useApiList(() => notificationsApi.list({ active_only: true, for_user: userId }), [userId]);
}
