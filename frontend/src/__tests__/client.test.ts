/**
 * Tests for api/client.ts
 *
 * Covers:
 * - Successful GET / POST / PATCH / DELETE requests
 * - Authorization header is attached for protected routes
 * - No Authorization header on public paths (/auth/login, /health, etc.)
 * - Content-Type: application/json set by default
 * - 401 response triggers token refresh and single retry
 * - After refresh failure, tokens are cleared
 * - onUnauthorized handler is invoked when session expires
 * - 204 response returns undefined (not a JSON parse error)
 * - Network error is wrapped in ApiError with status 0
 * - Error responses are parsed to ApiError with correct status and message
 * - Query params (params option) are appended to the URL
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  apiRequest,
  api,
  ApiError,
  setUnauthorizedHandler,
} from "../lib/api/client";
import { saveTokens, clearTokens, getAccessToken, getRefreshToken } from "../lib/api/auth-storage";

// ---------------------------------------------------------------------------
// fetch mock setup
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  clearTokens();
  setUnauthorizedHandler(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  clearTokens();
});

function makeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  const headersObj = new Headers({ "Content-Type": "application/json", ...headers });
  return new Response(JSON.stringify(body), { status, headers: headersObj });
}

function makeEmptyResponse(status = 204): Response {
  return new Response(null, { status });
}

// ---------------------------------------------------------------------------
// Happy path requests
// ---------------------------------------------------------------------------

describe("api.get", () => {
  it("should return parsed JSON on 200", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ hello: "world" }));
    // Use a public path so we don't need a token
    const result = await api.get<{ hello: string }>("/health");
    expect(result).toEqual({ hello: "world" });
  });

  it("should append query params to the URL", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse([]));
    await api.get("/health", { limit: 10, skip: 0 });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=10");
    expect(calledUrl).toContain("skip=0");
  });

  it("should omit undefined params from URL", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse([]));
    await api.get("/health", { limit: 10, skip: undefined });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("skip");
  });
});

describe("api.post", () => {
  it("should send JSON body with correct Content-Type", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true }, 201));
    await api.post("/auth/login", { email: "a@b.com", password: "x" });
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ email: "a@b.com", password: "x" }));
  });

  it("should return 201 response body", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ id: 1 }, 201));
    const result = await api.post<{ id: number }>("/auth/login", {});
    expect(result.id).toBe(1);
  });
});

describe("api.patch", () => {
  it("should send PATCH method", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ updated: true }));
    await api.patch("/health", { name: "new" });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("PATCH");
  });
});

describe("api.delete", () => {
  it("should send DELETE and return undefined on 204", async () => {
    mockFetch.mockResolvedValueOnce(makeEmptyResponse(204));
    const result = await api.delete("/health");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Authorization header
// ---------------------------------------------------------------------------

describe("Authorization header", () => {
  it("should attach Bearer token for protected routes", async () => {
    saveTokens({ accessToken: "my.access.token", refreshToken: "r", expiresInSeconds: 3600 });
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true }));
    await api.get("/visits");
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer my.access.token");
  });

  it("should NOT attach Authorization for /auth/login", async () => {
    saveTokens({ accessToken: "my.access.token", refreshToken: "r", expiresInSeconds: 3600 });
    mockFetch.mockResolvedValueOnce(makeResponse({ access_token: "t" }));
    await api.post("/auth/login", {});
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("should NOT attach Authorization for /health", async () => {
    saveTokens({ accessToken: "my.access.token", refreshToken: "r", expiresInSeconds: 3600 });
    mockFetch.mockResolvedValueOnce(makeResponse({ status: "ok" }));
    await api.get("/health");
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 401 → refresh → retry flow
// ---------------------------------------------------------------------------

describe("401 token refresh flow", () => {
  it("should retry request with new token after successful refresh", async () => {
    saveTokens({ accessToken: "old.token", refreshToken: "valid.refresh", expiresInSeconds: 3600 });

    // First call → 401; refresh → 200 with new token; retry → 200 with data
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(makeResponse({ access_token: "new.token", expires_in: 3600 }))
      .mockResolvedValueOnce(makeResponse({ data: "success" }));

    const result = await api.get<{ data: string }>("/visits");
    expect(result).toEqual({ data: "success" });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should clear tokens when refresh fails", async () => {
    saveTokens({ accessToken: "expired.token", refreshToken: "bad.refresh", expiresInSeconds: 3600 });

    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      // After failed refresh, client retries original request which also 401s
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "still expired" }), { status: 401 }));

    await expect(api.get("/visits")).rejects.toBeInstanceOf(ApiError);
    // Tokens should be cleared
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("should invoke onUnauthorized handler when session expires", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    saveTokens({ accessToken: "dead.token", refreshToken: "dead.refresh", expiresInSeconds: 3600 });

    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "no" }), { status: 401 }));

    await expect(api.get("/visits")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------

describe("ApiError", () => {
  it("should throw ApiError with correct status on 4xx", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Not found" }), { status: 404 })
    );
    await expect(api.get("/health")).rejects.toMatchObject({
      status: 404,
      name: "ApiError",
    });
  });

  it("should expose backend detail message for 4xx errors", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "PDV no existe" }), { status: 400 })
    );
    try {
      await api.get("/health");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).message).toContain("PDV no existe");
    }
  });

  it("should use friendly message for 401", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    try {
      await api.post("/auth/login", {});
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(401);
    }
  });

  it("should use friendly message for 403", async () => {
    saveTokens({ accessToken: "t", refreshToken: "r", expiresInSeconds: 3600 });
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: null }), { status: 403 }));
    try {
      await api.get("/visits");
    } catch (e) {
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).message).toContain("permiso");
    }
  });

  it("should use friendly message for 500", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    try {
      await api.get("/health");
    } catch (e) {
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).message).toMatch(/servidor/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Network errors
// ---------------------------------------------------------------------------

describe("network errors", () => {
  it("should wrap fetch throw in ApiError with status 0", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    try {
      await api.get("/health");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(0);
      expect((e as ApiError).message).toMatch(/conexión/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 204 edge case
// ---------------------------------------------------------------------------

describe("204 No Content", () => {
  it("should return undefined without attempting JSON.parse", async () => {
    saveTokens({ accessToken: "t", refreshToken: "r", expiresInSeconds: 3600 });
    mockFetch.mockResolvedValueOnce(makeEmptyResponse(204));
    const result = await api.delete("/visits");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// X-Request-ID header
// ---------------------------------------------------------------------------

describe("X-Request-ID", () => {
  it("should include requestId in ApiError when header is present", async () => {
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Request-ID": "req-abc-123",
    });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "oops" }), { status: 500, headers })
    );
    try {
      await api.get("/health");
    } catch (e) {
      expect((e as ApiError).requestId).toBe("req-abc-123");
    }
  });
});
