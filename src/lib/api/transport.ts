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

    const requestUrl = baseUrl ? new URL(path, baseUrl).toString() : path;
    const response = await fetchImpl(requestUrl, {
      ...requestOptions,
      method: requestOptions.method ?? "GET",
      headers,
      body,
      credentials: requestOptions.credentials ?? "include",
    });

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const isJson = contentType.includes("application/json") || contentType.includes("+json");
    const data = (isJson ? await response.json() : await response.arrayBuffer()) as TResponse;

    if (!response.ok) {
      throw new ApiRequestError(response, isJson ? (data as ApiErrorEnvelope) : null);
    }

    return { data, response };
  };
}
