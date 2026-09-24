/**
 * Fetch del comportamiento de un trade por rango.
 *
 * - Memo en memoria por usuario+rango (TTL 10 min, igual que el cache del
 *   backend): cambiar de chip a un rango ya cargado es instantáneo.
 * - `fetchWithCache` por debajo: si la API falla devuelve lo último visto.
 * - `prefetchBehavior`: precarga rangos en segundo plano (al entrar a la
 *   pestaña se muestra "esta semana" y se precargan "semana pasada" y "este
 *   mes", en ese orden y de a uno para no apilar consultas en la DB).
 */
import { useCallback, useEffect, useState } from "react";
import { intelligenceApi, type IntelBehaviorResponse } from "@/lib/api";
import { fetchWithCache } from "@/lib/offline";
import type { DateRange } from "./range-utils";

const MEMO_TTL_MS = 10 * 60 * 1000;
const memo = new Map<string, { at: number; data: IntelBehaviorResponse }>();
const inflight = new Map<string, Promise<IntelBehaviorResponse>>();

function memoKey(userId: number, range: DateRange) {
  return `intel-behavior-${userId}-${range.from}-${range.to}`;
}

/** Carga (o devuelve del memo / de la request en curso) un rango. */
export function loadBehavior(userId: number, range: DateRange): Promise<IntelBehaviorResponse> {
  const key = memoKey(userId, range);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return Promise.resolve(hit.data);
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchWithCache(key, () =>
    intelligenceApi.behavior({ user_id: userId, date_from: range.from, date_to: range.to })
  )
    .then((d) => {
      memo.set(key, { at: Date.now(), data: d });
      return d;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function hasBehaviorMemo(userId: number, range: DateRange): boolean {
  const hit = memo.get(memoKey(userId, range));
  return !!hit && Date.now() - hit.at < MEMO_TTL_MS;
}

/** Precarga secuencial en segundo plano; los errores se ignoran (best-effort). */
export async function prefetchBehavior(userId: number, ranges: DateRange[]): Promise<void> {
  for (const r of ranges) {
    try {
      await loadBehavior(userId, r);
    } catch {
      /* best-effort */
    }
  }
}

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
    if (tick > 0) memo.delete(memoKey(userId, range)); // retry explícito: refetch
    const cached = hasBehaviorMemo(userId, range);
    setLoading(!cached);
    setError(null);
    loadBehavior(userId, range)
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
