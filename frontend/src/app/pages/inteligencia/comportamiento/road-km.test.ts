import { describe, it, expect } from "vitest";
import { chunkCoords, coordsHash, dedupeCoords, storageKey } from "./road-km";
import type { IntelBehaviorDia } from "@/lib/api";

const pt = (lat: number, lon: number) => ({ seq: 0, ts: "", tipo: "in" as const, lat, lon, acc: null, distPdv: null, bateria: null, visitId: null, pdvId: null, pdvName: null });

describe("road-km helpers", () => {
  it("dedupeCoords saca duplicados consecutivos (IN/OUT en el mismo PDV)", () => {
    const day = { puntos: [pt(-34.6, -58.4), pt(-34.6, -58.4), pt(-34.61, -58.41), pt(-34.6, -58.4)] } as Pick<IntelBehaviorDia, "puntos">;
    expect(dedupeCoords(day)).toEqual([
      { lat: -34.6, lng: -58.4 },
      { lat: -34.61, lng: -58.41 },
      { lat: -34.6, lng: -58.4 },
    ]);
  });

  it("chunkCoords respeta el tope de 25 waypoints y encadena tramos", () => {
    const coords = Array.from({ length: 60 }, (_, i) => ({ lat: i, lng: i }));
    const chunks = chunkCoords(coords);
    expect(chunks.every((c) => c.length <= 27)).toBe(true);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i][0]).toEqual(chunks[i - 1][chunks[i - 1].length - 1]);
    }
    expect(chunks[chunks.length - 1][chunks[chunks.length - 1].length - 1]).toEqual({ lat: 59, lng: 59 });
    expect(chunkCoords(coords.slice(0, 10))).toHaveLength(1);
  });

  it("coordsHash es estable y cambia con las coordenadas", () => {
    const a = [{ lat: -34.6, lng: -58.4 }];
    expect(coordsHash(a)).toBe(coordsHash([{ lat: -34.6, lng: -58.4 }]));
    expect(coordsHash(a)).not.toBe(coordsHash([{ lat: -34.7, lng: -58.4 }]));
    expect(storageKey(7, "2026-09-24", a)).toMatch(/^espert\.roadkm\.v1\.7\.2026-09-24\./);
  });
});
