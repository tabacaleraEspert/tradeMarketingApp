/**
 * Tests for api/services.ts (authApi and visitPhotosApi)
 *
 * Strategy: mock the `api` object from client.ts so no real HTTP calls
 * are made. We verify that each service method:
 *   1. Calls the right HTTP verb (get/post/patch/delete/upload)
 *   2. Uses the correct endpoint path
 *   3. Passes through the expected arguments
 *   4. Returns whatever the mocked api returns (type plumbing)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// We mock the whole client module before the services module imports it.
vi.mock("../lib/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
  setUnauthorizedHandler: vi.fn(),
}));

import { api } from "../lib/api/client";
import { authApi, visitPhotosApi } from "../lib/api/services";

const mockedApi = api as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// authApi
// ---------------------------------------------------------------------------

describe("authApi.login", () => {
  it("should call api.post with /auth/login and credentials", async () => {
    mockedApi.post.mockResolvedValueOnce({ access_token: "t", refresh_token: "r", expires_in: 3600 });
    await authApi.login("user@test.com", "password123");
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/login", {
      email: "user@test.com",
      password: "password123",
    });
  });

  it("should return the response from api.post", async () => {
    const mockResponse = {
      UserId: 1,
      Email: "user@test.com",
      DisplayName: "Test",
      ZoneId: null,
      IsActive: true,
      access_token: "access",
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: 28800,
    };
    mockedApi.post.mockResolvedValueOnce(mockResponse);
    const result = await authApi.login("user@test.com", "password123");
    expect(result).toEqual(mockResponse);
  });

  it("should propagate errors from api.post", async () => {
    mockedApi.post.mockRejectedValueOnce(new Error("401 Unauthorized"));
    await expect(authApi.login("bad@test.com", "wrong")).rejects.toThrow("401 Unauthorized");
  });
});

describe("authApi.me", () => {
  it("should call api.get with /auth/me", async () => {
    mockedApi.get.mockResolvedValueOnce({ UserId: 1, Email: "u@u.com", Role: "vendedor" });
    await authApi.me();
    expect(mockedApi.get).toHaveBeenCalledWith("/auth/me");
  });

  it("should return the current user profile", async () => {
    const profile = { UserId: 42, Email: "x@x.com", DisplayName: "X", ZoneId: null, Role: "admin", IsActive: true };
    mockedApi.get.mockResolvedValueOnce(profile);
    const result = await authApi.me();
    expect(result.UserId).toBe(42);
    expect(result.Role).toBe("admin");
  });
});

describe("authApi.changePassword", () => {
  it("should call api.post with /auth/change-password and both passwords", async () => {
    mockedApi.post.mockResolvedValueOnce({ ok: true });
    await authApi.changePassword("oldPw", "newPw");
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/change-password", {
      current_password: "oldPw",
      new_password: "newPw",
    });
  });

  it("should return { ok: true } on success", async () => {
    mockedApi.post.mockResolvedValueOnce({ ok: true });
    const result = await authApi.changePassword("old", "new");
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// visitPhotosApi
// ---------------------------------------------------------------------------

describe("visitPhotosApi.list", () => {
  it("should call api.get with the correct visit photo path", async () => {
    mockedApi.get.mockResolvedValueOnce([]);
    await visitPhotosApi.list(77);
    expect(mockedApi.get).toHaveBeenCalledWith("/files/photos/visit/77");
  });

  it("should return an array of photos", async () => {
    const photos = [
      {
        VisitId: 77,
        FileId: 1,
        PhotoType: "store_front",
        SortOrder: 0,
        Notes: null,
        url: "https://example.com/photo.jpg",
        content_type: "image/jpeg",
        size_bytes: 1024,
        created_at: "2026-04-22T10:00:00Z",
      },
    ];
    mockedApi.get.mockResolvedValueOnce(photos);
    const result = await visitPhotosApi.list(77);
    expect(result).toHaveLength(1);
    expect(result[0].VisitId).toBe(77);
  });
});

describe("visitPhotosApi.upload", () => {
  it("should call api.upload with the correct path and FormData", async () => {
    mockedApi.upload.mockResolvedValueOnce({ VisitId: 5, FileId: 10 });
    const blob = new Blob(["fake-image"], { type: "image/jpeg" });
    await visitPhotosApi.upload(5, blob, { photoType: "shelf" });
    expect(mockedApi.upload).toHaveBeenCalledTimes(1);
    const [path, formData] = mockedApi.upload.mock.calls[0];
    expect(path).toBe("/files/photos/visit/5");
    expect(formData).toBeInstanceOf(FormData);
  });

  it("should include photoType in FormData when provided", async () => {
    mockedApi.upload.mockResolvedValueOnce({});
    const blob = new Blob(["img"], { type: "image/jpeg" });
    await visitPhotosApi.upload(1, blob, { photoType: "product" });
    const formData = mockedApi.upload.mock.calls[0][1] as FormData;
    expect(formData.get("photo_type")).toBe("product");
  });

  it("should include notes in FormData when provided", async () => {
    mockedApi.upload.mockResolvedValueOnce({});
    const blob = new Blob(["img"], { type: "image/jpeg" });
    await visitPhotosApi.upload(2, blob, { notes: "planogram compliant" });
    const formData = mockedApi.upload.mock.calls[0][1] as FormData;
    expect(formData.get("notes")).toBe("planogram compliant");
  });

  it("should include GPS coordinates when provided", async () => {
    mockedApi.upload.mockResolvedValueOnce({});
    const blob = new Blob(["img"], { type: "image/jpeg" });
    await visitPhotosApi.upload(3, blob, { lat: -34.6, lon: -58.4 });
    const formData = mockedApi.upload.mock.calls[0][1] as FormData;
    expect(formData.get("lat")).toBe("-34.6");
    expect(formData.get("lon")).toBe("-58.4");
  });

  it("should NOT include optional fields in FormData when not provided", async () => {
    mockedApi.upload.mockResolvedValueOnce({});
    const blob = new Blob(["img"], { type: "image/jpeg" });
    await visitPhotosApi.upload(4, blob);
    const formData = mockedApi.upload.mock.calls[0][1] as FormData;
    expect(formData.get("photo_type")).toBeNull();
    expect(formData.get("notes")).toBeNull();
    expect(formData.get("lat")).toBeNull();
    expect(formData.get("lon")).toBeNull();
  });
});

describe("visitPhotosApi.delete", () => {
  it("should call api.delete with the correct path including visitId and fileId", async () => {
    mockedApi.delete.mockResolvedValueOnce(undefined);
    await visitPhotosApi.delete(10, 99);
    expect(mockedApi.delete).toHaveBeenCalledWith("/files/photos/visit/10/99");
  });
});
