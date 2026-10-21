/**
 * Tests for app/lib/auth.ts — visitFlow en la sesión guardada.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/offline/queue", () => ({ clearAllOfflineState: () => Promise.resolve() }));

import { persistSession, getStoredUser, isShortVisitFlow } from "../app/lib/auth";
import type { LoginResponse } from "@/lib/api";

const LOGIN: LoginResponse = {
  UserId: 42,
  Email: "activadoru@espert.com.ar",
  DisplayName: "Activador U",
  ZoneId: 9,
  ZoneName: "La Plata",
  Role: "vendedor",
  IsActive: true,
  access_token: "a",
  refresh_token: "r",
  token_type: "bearer",
  expires_in: 3600,
};

describe("persistSession + isShortVisitFlow", () => {
  it("no session → not short", () => {
    expect(isShortVisitFlow()).toBe(false);
  });

  it("login without VisitFlow → full", () => {
    persistSession(LOGIN);
    expect(getStoredUser()?.visitFlow).toBe("full");
    expect(isShortVisitFlow()).toBe(false);
  });

  it("login with VisitFlow=short → short", () => {
    persistSession({ ...LOGIN, VisitFlow: "short" });
    expect(getStoredUser()?.visitFlow).toBe("short");
    expect(isShortVisitFlow()).toBe(true);
  });

  it("unknown VisitFlow value → full", () => {
    persistSession({ ...LOGIN, VisitFlow: "weird" });
    expect(isShortVisitFlow()).toBe(false);
  });

  it("legacy stored user without visitFlow → not short", () => {
    localStorage.setItem("user", JSON.stringify({ id: "1", name: "x", email: "x", zone: "-", role: "vendedor" }));
    expect(isShortVisitFlow()).toBe(false);
  });
});
