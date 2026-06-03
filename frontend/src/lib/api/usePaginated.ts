import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./client";
import type { Page } from "./types";

type Primitive = string | number | boolean;
type FilterMap = Record<string, Primitive | undefined | null>;

export interface UsePaginatedOpts<F extends FilterMap> {
  endpoint: string;
  initialFilters?: F;
  pageSize?: number;
  searchDebounceMs?: number;
  /** If true, keep previous items visible during refetch (smoother paging UX). */
  keepPreviousData?: boolean;
}

export interface UsePaginatedResult<T, F extends FilterMap> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  q: string;
  setQ: (v: string) => void;
  filters: F;
  setFilters: (next: Partial<F>) => void;
  setPage: (n: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  refetch: () => void;
}

/**
 * Hook genérico para endpoints paginados que devuelven Page<T>.
 *
 * Reglas:
 *  - Cambiar `q` o `filters` resetea a página 1.
 *  - `q` se debouncea (default 300ms).
 *  - Si `keepPreviousData` está activo, los items viejos persisten hasta que llega el fetch nuevo.
 */
export function usePaginated<T, F extends FilterMap = FilterMap>(
  opts: UsePaginatedOpts<F>
): UsePaginatedResult<T, F> {
  const {
    endpoint,
    initialFilters,
    pageSize = 50,
    searchDebounceMs = 300,
    keepPreviousData = true,
  } = opts;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQRaw] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFiltersState] = useState<F>((initialFilters ?? {}) as F);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), searchDebounceMs);
    return () => clearTimeout(id);
  }, [q, searchDebounceMs]);

  const setQ = useCallback((v: string) => {
    setQRaw(v);
    setPage(1);
  }, []);

  const setFilters = useCallback((next: Partial<F>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
    setPage(1);
  }, []);

  // Stable filter signature for dependency array
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  // Avoid double-fetching when the initial debounce settles to the same string
  const lastReqId = useRef(0);

  const refetch = useCallback(async () => {
    const reqId = ++lastReqId.current;
    if (!keepPreviousData) setItems([]);
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, Primitive | undefined> = {
        page,
        page_size: pageSize,
      };
      if (debouncedQ.trim()) params.q = debouncedQ.trim();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== "") {
          params[k] = v as Primitive;
        }
      }
      const res = await api.get<Page<T>>(endpoint, params);
      if (reqId !== lastReqId.current) return; // stale response, ignore
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      if (reqId !== lastReqId.current) return;
      setError(e instanceof Error ? e.message : "Error al cargar");
      setItems([]);
      setTotal(0);
    } finally {
      if (reqId === lastReqId.current) setLoading(false);
    }
  }, [endpoint, page, pageSize, debouncedQ, filterKey, keepPreviousData]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const hasMore = page * pageSize < total;

  const nextPage = useCallback(() => {
    setPage((p) => (p * pageSize < total ? p + 1 : p));
  }, [pageSize, total]);

  const prevPage = useCallback(() => {
    setPage((p) => (p > 1 ? p - 1 : p));
  }, []);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasMore,
    loading,
    error,
    q,
    setQ,
    filters,
    setFilters,
    setPage,
    nextPage,
    prevPage,
    refetch,
  };
}
