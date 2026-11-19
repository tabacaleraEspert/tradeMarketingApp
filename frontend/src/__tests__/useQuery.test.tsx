import { describe, it, expect, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useQuery } from "@/lib/api/useQuery";

describe("useQuery", () => {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => { seen.push(reason); };

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    seen.length = 0;
  });

  it("un fetch que falla (ej. offline, sin cache) deja el error en el hook y NO una promesa rechazada sin manejar", async () => {
    process.on("unhandledRejection", onUnhandled);
    const key = `test-useQuery-${Math.random().toString(36).slice(2)}`;
    const { result } = renderHook(() =>
      useQuery<number[]>(key, () => Promise.reject(new Error("Sin conexión al servidor"))),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("Sin conexión");
    expect(result.current.data).toBeNull();
    // darle una vuelta al event loop: el rechazo de la promesa derivada de .finally() se reportaba acá
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([]);
  });
});
