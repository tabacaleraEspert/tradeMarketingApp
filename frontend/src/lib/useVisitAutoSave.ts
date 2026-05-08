import { useEffect, useRef } from "react";

const CONTEXT_KEY = "espert.active_visit";
const DRAFT_PREFIX = "espert.visit_draft.";

// ── Active visit context (survives browser close) ──
export interface VisitContext {
  pdvId: number;
  visitId: number;
  routeDayId?: number;
  step: string;
  updatedAt: number;
}

export function saveVisitContext(ctx: Omit<VisitContext, "updatedAt">) {
  try {
    localStorage.setItem(CONTEXT_KEY, JSON.stringify({ ...ctx, updatedAt: Date.now() }));
  } catch {}
}

export function getVisitContext(): VisitContext | null {
  try {
    const raw = localStorage.getItem(CONTEXT_KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw) as VisitContext;
    // Expire after 12 hours
    if (Date.now() - ctx.updatedAt > 12 * 60 * 60 * 1000) {
      clearVisitContext();
      return null;
    }
    return ctx;
  } catch {
    return null;
  }
}

export function clearVisitContext() {
  try {
    localStorage.removeItem(CONTEXT_KEY);
    // Clear all draft data too
    Object.keys(localStorage)
      .filter((k) => k.startsWith(DRAFT_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}

// ── Hook: recover visitId from location.state or localStorage ──
/**
 * Use in each visit step page to:
 * 1. Recover visitId/routeDayId if location.state was lost (browser close)
 * 2. Save current step to context for resume
 */
export function useVisitStep(
  pdvId: number | undefined,
  step: string,
  locationState: { visitId?: number; routeDayId?: number } | null,
): { visitId: number | null; routeDayId: number | undefined } {
  const visitId = locationState?.visitId ?? null;
  const routeDayId = locationState?.routeDayId;

  // If we have state from navigation, save context
  useEffect(() => {
    if (visitId && pdvId) {
      saveVisitContext({ pdvId, visitId, routeDayId, step });
    }
  }, [visitId, pdvId, routeDayId, step]);

  // If location.state is missing, try recovering from localStorage
  if (!visitId && pdvId) {
    const ctx = getVisitContext();
    if (ctx && ctx.pdvId === pdvId) {
      return { visitId: ctx.visitId, routeDayId: ctx.routeDayId };
    }
  }

  return { visitId, routeDayId };
}

// ── Per-step draft persistence ──
function draftKey(visitId: number, step: string) {
  return `${DRAFT_PREFIX}${visitId}.${step}`;
}

/**
 * Auto-saves arbitrary form data to localStorage on change + beforeunload.
 * Call getDraft() on mount to restore.
 */
export function useAutoSaveDraft<T>(
  visitId: number | null | undefined,
  step: string,
  data: T,
) {
  const dataRef = useRef(data);
  dataRef.current = data;

  // Debounced save on change
  useEffect(() => {
    if (!visitId) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(visitId, step), JSON.stringify(dataRef.current));
      } catch {}
    }, 800);
    return () => clearTimeout(timer);
  }, [visitId, step, data]);

  // Immediate save on beforeunload
  useEffect(() => {
    if (!visitId) return;
    const handler = () => {
      try {
        localStorage.setItem(draftKey(visitId, step), JSON.stringify(dataRef.current));
      } catch {}
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [visitId, step]);
}

export function getDraft<T>(visitId: number, step: string): T | null {
  try {
    const raw = localStorage.getItem(draftKey(visitId, step));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(visitId: number, step: string) {
  try {
    localStorage.removeItem(draftKey(visitId, step));
  } catch {}
}

export function clearAllDrafts(visitId: number) {
  try {
    const prefix = `${DRAFT_PREFIX}${visitId}.`;
    Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}
