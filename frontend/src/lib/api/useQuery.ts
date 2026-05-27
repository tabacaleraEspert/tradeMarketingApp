/**
 * Lightweight query hook with request dedup and stale-while-revalidate.
 *
 * - Returns cached data immediately (from localStorage via fetchWithCache)
 * - Deduplicates in-flight requests with the same key
 * - Revalidates in background, updating all mounted subscribers
 * - No external dependencies (replaces need for React Query / SWR)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { readCache, fetchWithCache } from "@/lib/offline";

// ── Global in-flight request dedup ──
const inflight = new Map<string, Promise<unknown>>();

// ── Pub/sub for multi-component updates ──
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function subscribe(key: string, fn: Listener): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => {
    listeners.get(key)?.delete(fn);
    if (listeners.get(key)?.size === 0) listeners.delete(key);
  };
}

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

// ── In-memory cache (survives re-renders, lost on page reload → localStorage backs it) ──
const memCache = new Map<string, { data: unknown; ts: number }>();

interface UseQueryOptions {
  /** Cache TTL in ms. Default: 7 days (matches fetchWithCache default). */
  ttlMs?: number;
  /** Skip fetching when false. */
  enabled?: boolean;
}

interface UseQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: UseQueryOptions,
): UseQueryResult<T> {
  const ttlMs = options?.ttlMs;
  const enabled = options?.enabled ?? true;

  // Seed from memory cache or localStorage
  const initial = () => {
    const mem = memCache.get(key);
    if (mem && (!ttlMs || Date.now() - mem.ts < ttlMs)) return mem.data as T;
    const ls = readCache<T>(key, ttlMs);
    return ls;
  };

  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState<boolean>(!data && enabled);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const doFetch = useCallback(async () => {
    if (!enabled) return;

    // If we already have data, don't show loading (stale-while-revalidate)
    const hasStale = data != null || memCache.has(key) || readCache(key, ttlMs) != null;
    if (!hasStale) setLoading(true);

    // Dedup: reuse in-flight request for same key
    let promise = inflight.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = fetchWithCache<T>(key, fetcher, ttlMs);
      inflight.set(key, promise);
      promise.finally(() => inflight.delete(key));
    }

    try {
      const result = await promise;
      memCache.set(key, { data: result, ts: Date.now() });
      if (mountedRef.current) {
        setData(result);
        setError(null);
        setLoading(false);
      }
      notify(key);
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Error");
        setLoading(false);
      }
    }
  }, [key, enabled]);

  // Subscribe to updates from other components using the same key
  useEffect(() => {
    return subscribe(key, () => {
      const mem = memCache.get(key);
      if (mem && mountedRef.current) setData(mem.data as T);
    });
  }, [key]);

  // Fetch on mount / key change
  useEffect(() => {
    doFetch();
  }, [doFetch]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return { data, loading, error, refetch: doFetch };
}
