import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const addMock = vi.fn().mockResolvedValue(7);
vi.mock("@/lib/offline/queue", () => ({ queue: { add: (...a: unknown[]) => addMock(...a) } }));
vi.mock("@/lib/offline/visit-id-map", () => ({ getAllVisitIdMappings: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/lib/offline/pdv-id-map", () => ({ getAllPdvIdMappings: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/lib/offline/route-id-map", () => ({ getAllRouteIdMappings: vi.fn().mockResolvedValue(new Map()) }));

import { executeOrEnqueue } from "@/lib/offline/execute";
import type { QueuedKind } from "@/lib/offline/queue";

describe("cola offline: visit_pop_placements", () => {
  let onLine: PropertyDescriptor | undefined;
  beforeEach(() => {
    addMock.mockClear();
    onLine = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
  });
  afterEach(() => {
    if (onLine) Object.defineProperty(window.navigator, "onLine", onLine);
    else delete (window.navigator as unknown as Record<string, unknown>).onLine;
  });

  it("es un kind válido", () => {
    const k: QueuedKind = "visit_pop_placements";
    expect(k).toBe("visit_pop_placements");
  });

  it("offline → se encola con body {items} y el tempVisitId para que el sync-worker lo resuelva", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    const items = [{ MaterialCode: "MKT-000211", MaterialName: "VLANK", Quantity: 2, Location: null }];
    const res = await executeOrEnqueue({
      kind: "visit_pop_placements",
      method: "PUT",
      url: "/visits/-123/pop-placements",
      body: { items },
      label: "Colocación POP",
      _tempVisitId: -123,
    });
    expect(res).toEqual({ ok: true, queued: true, queueId: 7 });
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: "visit_pop_placements",
      method: "PUT",
      url: "/visits/-123/pop-placements",
      body: { items },
      _tempVisitId: -123,
    }));
  });

  it("online con visita temporal sin sincronizar → igual se encola (no pega con ID negativo)", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
    await executeOrEnqueue({
      kind: "visit_pop_placements",
      method: "PUT",
      url: "/visits/-5/pop-placements",
      body: { items: [] },
      label: "Colocación POP",
      _tempVisitId: -5,
    });
    expect(addMock).toHaveBeenCalledTimes(1);
  });
});
