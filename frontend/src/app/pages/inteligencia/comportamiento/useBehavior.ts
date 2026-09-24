/**
 * Fetch del comportamiento de un trade por rango, con cache offline
 * (`fetchWithCache`: si la API falla devuelve lo último que se vio para ese
 * usuario+rango). Expone loading/error/retry.
 */
import { useCallback, useEffect, useState } from "react";
import { intelligenceApi, type IntelBehaviorResponse } from "@/lib/api";
import { fetchWithCache } from "@/lib/offline";
import type { DateRange } from "./range-utils";

export interface UseBehavior {
  data: IntelBehaviorResponse | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useBehavior(userId: number, range: DateRange | null): UseBehavior {
  const [data, setData] = useState<IntelBehaviorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!range) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const key = `intel-behavior-${userId}-${range.from}-${range.to}`;
    fetchWithCache(key, () =>
      intelligenceApi.behavior({ user_id: userId, date_from: range.from, date_to: range.to })
    )
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "No se pudo cargar el comportamiento");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId, range?.from, range?.to, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, retry };
}
