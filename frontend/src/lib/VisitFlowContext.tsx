/**
 * VisitFlowContext — shared state for all census step pages under /pos/:id/*.
 *
 * Loads PDV, products, forms, and resolves visitId ONCE on mount.
 * All 6 step pages (Survey, Coverage, POP, Suppliers, Actions, MarketNews)
 * consume via useVisitFlow() instead of fetching independently.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Outlet, useParams, useLocation } from "react-router";
import { fetchWithCache } from "@/lib/offline";
import { pdvsApi, productsApi, formsApi, supplierTypesApi, supplierProductTypesApi } from "@/lib/api";
import { getVisitContext } from "./useVisitAutoSave";

interface VisitFlowState {
  pdvId: number;
  pdv: any | null;
  visitId: number | null;
  routeDayId: number | undefined;
  products: any[];
  productsActive: any[];
  forms: any[];
  supplierTypes: any[];
  supplierProductTypes: any[];
  loading: boolean;
}

const VisitFlowCtx = createContext<VisitFlowState | null>(null);

export function useVisitFlow(): VisitFlowState {
  const ctx = useContext(VisitFlowCtx);
  if (!ctx) throw new Error("useVisitFlow must be used within VisitFlowProvider");
  return ctx;
}

export function VisitFlowProvider() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const locState = (location.state ?? {}) as { visitId?: number; routeDayId?: number };
  const pdvId = Number(id) || 0;

  const [state, setState] = useState<VisitFlowState>({
    pdvId,
    pdv: null,
    visitId: locState.visitId ?? null,
    routeDayId: locState.routeDayId,
    products: [],
    productsActive: [],
    forms: [],
    supplierTypes: [],
    supplierProductTypes: [],
    loading: true,
  });

  // Recover visitId from localStorage if navigation state was lost
  useEffect(() => {
    if (!state.visitId && pdvId) {
      const ctx = getVisitContext();
      if (ctx && ctx.pdvId === pdvId) {
        setState((s) => ({ ...s, visitId: ctx.visitId, routeDayId: ctx.routeDayId }));
      }
    }
  }, [pdvId]);

  // Update visitId/routeDayId when navigating between steps with state
  useEffect(() => {
    if (locState.visitId && locState.visitId !== state.visitId) {
      setState((s) => ({ ...s, visitId: locState.visitId!, routeDayId: locState.routeDayId }));
    }
  }, [locState.visitId, locState.routeDayId]);

  // Fetch all shared data once
  useEffect(() => {
    if (!pdvId) return;
    let cancelled = false;

    Promise.all([
      fetchWithCache(`pdv_${pdvId}`, () => pdvsApi.get(pdvId)),
      fetchWithCache("products_all", () => productsApi.list()),
      fetchWithCache("products_active", () => productsApi.list({ active_only: true })),
      fetchWithCache("forms_active", () => formsApi.list({ limit: 200 })),
      fetchWithCache("supplier_types", () => supplierTypesApi.list()),
      fetchWithCache("supplier_product_types", () => supplierProductTypesApi.list()),
    ]).then(([pdv, products, productsActive, forms, sTypes, spTypes]) => {
      if (cancelled) return;
      setState((s) => ({
        ...s,
        pdv,
        products,
        productsActive,
        forms,
        supplierTypes: sTypes,
        supplierProductTypes: spTypes,
        loading: false,
      }));
    }).catch(() => {
      if (!cancelled) setState((s) => ({ ...s, loading: false }));
    });

    return () => { cancelled = true; };
  }, [pdvId]);

  return (
    <VisitFlowCtx.Provider value={state}>
      <Outlet />
    </VisitFlowCtx.Provider>
  );
}
