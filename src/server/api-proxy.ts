export const ADMIN_API_PREFIX = "/api/v1/admin";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "x-csrf-token",
  "x-request-id",
]);
const FORWARDED_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-disposition",
  "content-type",
  "etag",
  "last-modified",
  "retry-after",
  "vary",
  "x-request-id",
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ADMIN_AUTH_COOKIE_NAMES = new Set(["eggship_admin_at", "eggship_admin_rt"]);

export class ApiProxyConfigurationError extends Error {}

export class ApiProxyPathError extends Error {}

function getBackendOrigin(): string {
  const configuredOrigin = process.env.API_BACKEND_ORIGIN;
  if (!configuredOrigin) {
    throw new ApiProxyConfigurationError("API_BACKEND_ORIGIN is not configured");
  }

  return configuredOrigin;
}

function validateBackendOrigin(origin: string): URL {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ApiProxyConfigurationError("API_BACKEND_ORIGIN must be an absolute HTTP(S) URL");
  }

  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new ApiProxyConfigurationError("API_BACKEND_ORIGIN must be an origin without credentials or a path");
  }

  return url;
}

export function assertAdminApiPath(pathname: string): void {
  if (pathname !== ADMIN_API_PREFIX && !pathname.startsWith(`${ADMIN_API_PREFIX}/`)) {
    throw new ApiProxyPathError("Only /api/v1/admin/* paths are proxied");
  }

  const pathRemainder = pathname.slice(ADMIN_API_PREFIX.length);
  if (/%(?:2e|2f|5c)/i.test(pathRemainder) || pathRemainder.includes("\\")) {
    throw new ApiProxyPathError("Encoded path traversal is not allowed");
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new ApiProxyPathError("Malformed encoded path");
  }
  if (decodedPath.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new ApiProxyPathError("Path traversal is not allowed");
  }
}

function copyAllowedRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  }
  return headers;
}

function rewriteAdminAuthCookiePath(cookie: string): string {
  const cookieName = cookie.slice(0, cookie.indexOf("=")).trim();
  if (!ADMIN_AUTH_COOKIE_NAMES.has(cookieName)) return cookie;

  return cookie.replace(/(;\s*Path=)\/api\/v1\/admin(?=\s*;|\s*$)/i, "$1/");
}

function copyAllowedResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  }

  for (const cookie of source.getSetCookie()) {
    headers.append("set-cookie", rewriteAdminAuthCookiePath(cookie));
  }

  return headers;
}

export type ProxyFetch = typeof fetch;

export async function proxyAdminApiRequest(
  request: Request,
  options: { backendOrigin?: string; fetchImpl?: ProxyFetch } = {},
): Promise<Response> {
  const requestUrl = new URL(request.url);
  assertAdminApiPath(requestUrl.pathname);

  if (!ALLOWED_METHODS.has(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: [...ALLOWED_METHODS].join(", ") },
    });
  }

  const backendOrigin = validateBackendOrigin(options.backendOrigin ?? getBackendOrigin());
  const backendUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, backendOrigin);
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = request.method === "GET" ? undefined : await request.arrayBuffer();

  let backendResponse: Response;
  try {
    backendResponse = await fetchImpl(backendUrl, {
      method: request.method,
      headers: copyAllowedRequestHeaders(request),
      body,
      redirect: "manual",
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }

    const requestId = request.headers.get("x-request-id");
    return new Response(JSON.stringify({ error: { code: "API_UNAVAILABLE", message: "API unavailable" } }), {
      status: 502,
      headers: {
        "content-type": "application/json",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
    });
  }

  if (REDIRECT_STATUSES.has(backendResponse.status)) {
    return new Response(JSON.stringify({ error: { code: "API_UPSTREAM_REDIRECT", message: "API unavailable" } }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: copyAllowedResponseHeaders(backendResponse.headers),
  });
}
