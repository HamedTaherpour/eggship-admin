import type { paths } from "@/generated/api-types";

export type AdminApiPath = Extract<keyof paths, `/api/v1/admin${string}`>;
export type ApiRequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  readonly envelope: ApiErrorEnvelope | null;

  constructor(response: Response, envelope: ApiErrorEnvelope | null) {
    super(envelope?.error?.message ?? `API request failed with status ${response.status}`);
    this.name = "ApiRequestError";
    this.status = response.status;
    this.requestId = response.headers.get("x-request-id") ?? envelope?.error?.requestId ?? null;
    this.envelope = envelope;
  }
}

export type AdminApiTransportOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  headers?: HeadersInit;
};

export type AdminApiRequestOptions = Omit<RequestInit, "body" | "headers" | "method"> & {
  body?: BodyInit | null;
  json?: unknown;
  method?: ApiRequestMethod;
  headers?: HeadersInit;
};

function assertRelativeAdminPath(path: string): void {
  let url: URL;
  try {
    url = new URL(path, "https://admin.invalid");
  } catch {
    throw new TypeError("Admin API paths must be valid same-origin paths");
  }

  if (
    url.origin !== "https://admin.invalid" ||
    (url.pathname !== "/api/v1/admin" && !url.pathname.startsWith("/api/v1/admin/"))
  ) {
    throw new TypeError("Admin API paths must stay under /api/v1/admin");
  }

  if (/%(?:2e|2f|5c)/i.test(url.pathname) || url.pathname.includes("\\")) {
    throw new TypeError("Admin API paths must not contain encoded traversal");
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new TypeError("Admin API paths must use valid encoding");
  }

  if (decodedPath.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("Admin API paths must not contain traversal segments");
  }
}

function resolveRequestUrl(baseUrl: string, path: string): string {
  assertRelativeAdminPath(path);
  if (!baseUrl) return path;

  const base = new URL(baseUrl, "https://admin.invalid");
  if (base.origin !== "https://admin.invalid") {
    throw new TypeError("Admin API transport only supports same-origin URLs");
  }

  return new URL(path, base).toString();
}

function parseJson(value: string): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asErrorEnvelope(value: unknown): ApiErrorEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  return error && typeof error === "object" ? (value as ApiErrorEnvelope) : null;
}

export function createAdminApiTransport(options: AdminApiTransportOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? "";

  return async function requestAdminApi<TResponse = unknown>(
    path: AdminApiPath,
    requestOptions: AdminApiRequestOptions = {},
  ): Promise<{ data: TResponse; response: Response }> {
    const headers = new Headers(options.headers);
    new Headers(requestOptions.headers).forEach((value, name) => {
      headers.set(name, value);
    });

    let body = requestOptions.body;
    if (requestOptions.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(requestOptions.json);
    }

    const requestUrl = resolveRequestUrl(baseUrl, path);
    const response = await fetchImpl(requestUrl, {
      ...requestOptions,
      method: requestOptions.method ?? "GET",
      headers,
      body,
      credentials: requestOptions.credentials ?? "include",
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const isJson = contentType.includes("application/json") || contentType.includes("+json");
    const bytes = await response.arrayBuffer();
    let data: unknown = null;
    if (bytes.byteLength > 0) {
      data = isJson ? parseJson(new TextDecoder().decode(bytes)) : bytes;
    }

    if (!response.ok) {
      throw new ApiRequestError(response, isJson ? asErrorEnvelope(data) : null);
    }

    return { data: data as TResponse, response };
  };
}
