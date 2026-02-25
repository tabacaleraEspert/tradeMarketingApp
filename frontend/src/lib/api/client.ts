import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
    throw new ApiError(
      (data as { detail?: string })?.detail || res.statusText,
      res.status,
      data
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

type RequestOptions = RequestInit & { params?: Record<string, string | number | boolean | undefined> };

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, ...init } = options;

  let url = `${API_BASE_URL}${path}`;
  if (params) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        search.set(k, String(v));
      }
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  return handleResponse<T>(res);
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined>) =>
    apiRequest<T>(path, { method: "GET", params }),

  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),

  patch: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),

  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
