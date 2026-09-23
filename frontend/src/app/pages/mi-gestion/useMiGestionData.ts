// Carga en paralelo /kpi/variable + /kpi/tmr/routes + /kpi/tmr/pdvs del vendedor
// logueado, con fetchWithCache para que lo último visto sirva offline.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { intelligenceApi, kpiApi, type KpiVariableRow, type TmrPdvsResponse, type TmrRutaRow } from "@/lib/api";
import { fetchWithCache } from "@/lib/offline";
import { getCurrentUser } from "../../lib/auth";
import { parsePeriod, periodToParam, type Period } from "./mi-gestion-utils";

export interface MiGestionData {
  myRow: KpiVariableRow | null;
  rutas: TmrRutaRow[];
  pdvs: TmrPdvsResponse | null;
}

interface State {
  data: MiGestionData | null;
  loading: boolean;
  error: boolean;
  /** Al menos una de las tres respuestas vino del cache (API falló). */
  fromCache: boolean;
}

// Memo en memoria para no repetir las 3 llamadas al drillar KPI → ruta → PDV.
const MEMO_TTL_MS = 2 * 60 * 1000;
const memo = new Map<string, { ts: number; promise: Promise<{ data: MiGestionData; fromCache: boolean }> }>();

async function loadAll(userId: number, { year, month }: Period) {
  let cacheHits = 0;
  const tracked = <T,>(key: string, fn: () => Promise<T>) => {
    let ok = false;
    return fetchWithCache(key, async () => {
      const r = await fn();
      ok = true;
      return r;
    }).then((r) => {
      if (!ok) cacheHits += 1;
      return r;
    });
  };

  const period = { year, month, user_id: userId };
  // `with_products: false` evita la matriz producto x ruta que acá no se usa.
  const routesParams = { ...period, with_products: false };
  const [rows, routes, pdvs] = await Promise.all([
    tracked(`mg_variable_${userId}_${year}_${month}`, () => kpiApi.variable({ year, month })),
    tracked(`mg_routes_${userId}_${year}_${month}`, () => intelligenceApi.tmrRoutes(routesParams)),
    tracked(`mg_pdvs_${userId}_${year}_${month}`, () => intelligenceApi.tmrPdvs(period)),
  ]);

  const data: MiGestionData = {
    myRow: rows.find((r) => r.userId === userId) ?? null,
    rutas: routes?.rutas ?? [],
    pdvs: pdvs ?? null,
  };
  return { data, fromCache: cacheHits > 0 };
}

export function useMiGestionData(period: Period) {
  const userId = Number(getCurrentUser().id);
  const [state, setState] = useState<State>({ data: null, loading: true, error: false, fromCache: false });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    memo.delete(`${userId}_${period.year}_${period.month}`);
    setNonce((n) => n + 1);
  }, [userId, period.year, period.month]);

  useEffect(() => {
    let alive = true;
    const key = `${userId}_${period.year}_${period.month}`;
    const hit = memo.get(key);
    let promise = hit && Date.now() - hit.ts < MEMO_TTL_MS ? hit.promise : null;
    if (!promise) {
      promise = loadAll(userId, period);
      memo.set(key, { ts: Date.now(), promise });
      setState((s) => ({ ...s, loading: true, error: false }));
    }
    promise
      .then(({ data, fromCache }) => {
        if (alive) setState({ data, loading: false, error: false, fromCache });
      })
      .catch(() => {
        memo.delete(key);
        if (alive) setState({ data: null, loading: false, error: true, fromCache: false });
      });
    return () => {
      alive = false;
    };
  }, [userId, period.year, period.month, nonce]);

  return { ...state, reload };
}

/** Período (mes) compartido entre las tres pantallas vía `?m=YYYY-M`. */
export function usePeriod() {
  const [params, setParams] = useSearchParams();
  const period = parsePeriod(params.get("m"));
  const setPeriod = (p: Period) => {
    const next = new URLSearchParams(params);
    next.set("m", periodToParam(p));
    setParams(next, { replace: true });
  };
  return { period, setPeriod, param: periodToParam(period) };
}
