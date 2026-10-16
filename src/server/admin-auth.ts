import { createServerFn } from "@tanstack/react-start";

import type { components } from "@/generated/api-types";

type AdminIdentity = components["schemas"]["AdminIdentityDto"];

export type AdminSessionResult =
  | { status: "authenticated"; admin: AdminIdentity }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "unavailable" };

const FORWARDED_HEADERS = [
  "cookie",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "x-csrf-token",
  "x-request-id",
];

type CsrfResponse = { data?: { token?: string } };
type AdminResponse = { data?: { admin?: AdminIdentity } };

function copyRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  for (const cookie of cookieHeader?.split(/;\s*/) ?? []) {
    const separator = cookie.indexOf("=");
    if (separator > 0 && cookie.slice(0, separator) === name) return cookie.slice(separator + 1);
  }
  return null;
}

type SetCookieSink = (cookie: string) => void;

function forwardSetCookies(response: Response, setCookie: SetCookieSink): void {
  for (const cookie of response.headers.getSetCookie()) {
    setCookie(cookie);
  }
}

function mergeSetCookiesIntoRequestCookie(cookieHeader: string | null, setCookies: string[]): string {
  const cookies = new Map<string, string>();
  for (const cookie of cookieHeader?.split(/;\s*/) ?? []) {
    const separator = cookie.indexOf("=");
    if (separator > 0) cookies.set(cookie.slice(0, separator), cookie);
  }

  for (const cookie of setCookies) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator), pair);
  }

  return [...cookies.values()].join("; ");
}

type AuthFailureStatus = Exclude<AdminSessionResult["status"], "authenticated">;

function classifyAuthResponse(status: number): AuthFailureStatus {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  return "unavailable";
}

async function readAdmin(response: Response): Promise<AdminSessionResult> {
  if (!response.ok) return { status: classifyAuthResponse(response.status) };
  const body = (await response.json()) as AdminResponse;
  return body.data?.admin ? { status: "authenticated", admin: body.data.admin } : { status: "unavailable" };
}

export async function resolveAdminSession(
  request: Request,
  fetchImpl: typeof fetch = fetch,
  setCookie?: SetCookieSink,
): Promise<AdminSessionResult> {
  const headers = copyRequestHeaders(request);

  try {
    const meResponse = await fetchImpl(new URL("/api/v1/admin/auth/me", request.url), {
      headers,
      credentials: "include",
    });
    if (meResponse.status !== 401) return readAdmin(meResponse);

    let csrfToken = readCookie(headers.get("cookie"), "eggship_admin_csrf");
    if (!csrfToken) {
      const csrfResponse = await fetchImpl(new URL("/api/v1/admin/auth/csrf", request.url), {
        headers,
        credentials: "include",
      });
      if (setCookie) forwardSetCookies(csrfResponse, setCookie);
      if (!csrfResponse.ok) return { status: classifyAuthResponse(csrfResponse.status) };

      const csrfBody = (await csrfResponse.json()) as CsrfResponse;
      csrfToken = csrfBody.data?.token ?? null;
    }
    if (!csrfToken) return { status: "unavailable" };

    const refreshHeaders = new Headers(headers);
    refreshHeaders.set("x-csrf-token", csrfToken);
    const refreshResponse = await fetchImpl(new URL("/api/v1/admin/auth/refresh", request.url), {
      method: "POST",
      headers: refreshHeaders,
      credentials: "include",
    });
    if (setCookie) forwardSetCookies(refreshResponse, setCookie);
    if (!refreshResponse.ok) return { status: classifyAuthResponse(refreshResponse.status) };

    const refreshedHeaders = new Headers(headers);
    const refreshedCookies = mergeSetCookiesIntoRequestCookie(
      headers.get("cookie"),
      refreshResponse.headers.getSetCookie(),
    );
    if (refreshedCookies) refreshedHeaders.set("cookie", refreshedCookies);
    return readAdmin(
      await fetchImpl(new URL("/api/v1/admin/auth/me", request.url), {
        headers: refreshedHeaders,
        credentials: "include",
      }),
    );
  } catch {
    return { status: "unavailable" };
  }
}

const getAdminSessionServer = createServerFn({ method: "GET" }).handler(async () => {
  const { appendResponseHeader, getRequest } = await import("@tanstack/react-start/server");
  return resolveAdminSession(getRequest(), fetch, (cookie) => appendResponseHeader("set-cookie", cookie));
});

export function getAdminSession(): Promise<AdminSessionResult> {
  return getAdminSessionServer();
}
