/**
 * Tests for auth-storage.ts
 *
 * Covers:
 * - saveTokens persists all three keys
 * - getAccessToken / getRefreshToken retrieval
 * - getTokenExpiresAt returns correct timestamp
 * - isAccessTokenExpired with various clock states
 * - clearTokens removes all keys including legacy keys
 * - Handling corrupt / missing data
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveTokens,
  getAccessToken,
  getRefreshToken,
  getTokenExpiresAt,
  isAccessTokenExpired,
  clearTokens,
} from "../lib/api/auth-storage";

// localStorage is already cleared by the global setup (beforeEach in setup.ts)

const BUNDLE = {
  accessToken: "eyJ.access.token",
  refreshToken: "eyJ.refresh.token",
  expiresInSeconds: 3600,
};

describe("saveTokens", () => {
  it("should persist access token in localStorage", () => {
    saveTokens(BUNDLE);
    expect(localStorage.getItem("espert.access_token")).toBe(BUNDLE.accessToken);
  });

  it("should persist refresh token in localStorage", () => {
    saveTokens(BUNDLE);
    expect(localStorage.getItem("espert.refresh_token")).toBe(BUNDLE.refreshToken);
  });

  it("should persist expiry timestamp in localStorage", () => {
    const before = Date.now();
    saveTokens(BUNDLE);
    const after = Date.now();
    const stored = Number(localStorage.getItem("espert.token_expires"));
    expect(stored).toBeGreaterThanOrEqual(before + BUNDLE.expiresInSeconds * 1000);
    expect(stored).toBeLessThanOrEqual(after + BUNDLE.expiresInSeconds * 1000);
  });

  it("should overwrite previous tokens on second save", () => {
    saveTokens(BUNDLE);
    saveTokens({ ...BUNDLE, accessToken: "new.access.token" });
    expect(getAccessToken()).toBe("new.access.token");
  });
});

describe("getAccessToken", () => {
  it("should return null when nothing is stored", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("should return the stored access token", () => {
    saveTokens(BUNDLE);
    expect(getAccessToken()).toBe(BUNDLE.accessToken);
  });
});

describe("getRefreshToken", () => {
  it("should return null when nothing is stored", () => {
    expect(getRefreshToken()).toBeNull();
  });

  it("should return the stored refresh token", () => {
    saveTokens(BUNDLE);
    expect(getRefreshToken()).toBe(BUNDLE.refreshToken);
  });
});

describe("getTokenExpiresAt", () => {
  it("should return null when nothing is stored", () => {
    expect(getTokenExpiresAt()).toBeNull();
  });

  it("should return a number when tokens are stored", () => {
    saveTokens(BUNDLE);
    const exp = getTokenExpiresAt();
    expect(typeof exp).toBe("number");
    expect(exp).toBeGreaterThan(Date.now());
  });

  it("should return null when expires key is missing but others exist", () => {
    saveTokens(BUNDLE);
    localStorage.removeItem("espert.token_expires");
    expect(getTokenExpiresAt()).toBeNull();
  });
});

describe("isAccessTokenExpired", () => {
  it("should return true when no token is stored", () => {
    expect(isAccessTokenExpired()).toBe(true);
  });

  it("should return false for a freshly saved token", () => {
    // 1 hour expiry
    saveTokens({ ...BUNDLE, expiresInSeconds: 3600 });
    expect(isAccessTokenExpired()).toBe(false);
  });

  it("should return true when token expires within the skew window", () => {
    // Token expires in 10 seconds — default skew is 30s, so it should be considered expired
    saveTokens({ ...BUNDLE, expiresInSeconds: 10 });
    expect(isAccessTokenExpired()).toBe(true);
  });

  it("should return false when token expires after the skew window", () => {
    // Token expires in 60 seconds — well beyond the 30s skew
    saveTokens({ ...BUNDLE, expiresInSeconds: 60 });
    expect(isAccessTokenExpired(0)).toBe(false);
  });

  it("should respect a custom skew value", () => {
    // Token expires in 50 seconds
    saveTokens({ ...BUNDLE, expiresInSeconds: 50 });
    // With 60s skew it should be expired
    expect(isAccessTokenExpired(60)).toBe(true);
    // With 10s skew it should NOT be expired
    expect(isAccessTokenExpired(10)).toBe(false);
  });

  it("should return true for a past expiry timestamp", () => {
    // Manually set expiry to the past
    localStorage.setItem("espert.token_expires", String(Date.now() - 1000));
    expect(isAccessTokenExpired()).toBe(true);
  });
});

describe("clearTokens", () => {
  it("should remove access token", () => {
    saveTokens(BUNDLE);
    clearTokens();
    expect(getAccessToken()).toBeNull();
  });

  it("should remove refresh token", () => {
    saveTokens(BUNDLE);
    clearTokens();
    expect(getRefreshToken()).toBeNull();
  });

  it("should remove expiry timestamp", () => {
    saveTokens(BUNDLE);
    clearTokens();
    expect(getTokenExpiresAt()).toBeNull();
  });

  it("should remove legacy 'user' and 'isAuthenticated' keys", () => {
    localStorage.setItem("user", JSON.stringify({ id: 1 }));
    localStorage.setItem("isAuthenticated", "true");
    clearTokens();
    expect(localStorage.getItem("user")).toBeNull();
    expect(localStorage.getItem("isAuthenticated")).toBeNull();
  });

  it("should be safe to call when nothing is stored", () => {
    expect(() => clearTokens()).not.toThrow();
  });

  it("isAccessTokenExpired returns true after clearTokens", () => {
    saveTokens(BUNDLE);
    clearTokens();
    expect(isAccessTokenExpired()).toBe(true);
  });
});
