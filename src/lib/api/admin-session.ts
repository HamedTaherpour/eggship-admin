import type { components } from "@/generated/api-types";

import { csrfHeaders, getCsrfToken, invalidateCsrfToken } from "./csrf.ts";
import { ApiRequestError, createAdminApiTransport } from "./transport.ts";

export type AdminIdentity = components["schemas"]["AdminIdentityDto"];

type AdminLoginResponse = components["schemas"]["AdminLoginResponseDto"];
type CurrentAdminResponse = components["schemas"]["CurrentAdminResponseDto"];
type SessionStatusResponse = components["schemas"]["AuthSessionStatusResponseDto"];

const transport = createAdminApiTransport();
let refreshPromise: Promise<void> | null = null;

function isCsrfFailure(error: unknown): error is ApiRequestError {
  return (
    error instanceof ApiRequestError &&
    (error.status === 403 ||
      error.envelope?.error?.code === "CSRF_TOKEN_MISSING" ||
      error.envelope?.error?.code === "CSRF_TOKEN_INVALID")
  );
}

async function refreshSession(): Promise<void> {
  refreshPromise ??= (async () => {
    const headers = await csrfHeaders();
    try {
      await transport<SessionStatusResponse>("/api/v1/admin/auth/refresh", { method: "POST", headers });
    } catch (error) {
      if (isCsrfFailure(error)) invalidateCsrfToken();
      throw error;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export async function loginAdmin(email: string, password: string): Promise<AdminIdentity> {
  const headers = await csrfHeaders();
  try {
    const { data } = await transport<AdminLoginResponse>("/api/v1/admin/auth/login", {
      method: "POST",
      headers,
      json: { email, password },
    });
    return data.data.admin;
  } catch (error) {
    if (isCsrfFailure(error)) invalidateCsrfToken();
    throw error;
  }
}

export async function getAdminIdentity(): Promise<AdminIdentity> {
  try {
    const { data } = await transport<CurrentAdminResponse>("/api/v1/admin/auth/me");
    return data.data.admin;
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
    await refreshSession();
    const { data } = await transport<CurrentAdminResponse>("/api/v1/admin/auth/me");
    return data.data.admin;
  }
}

export async function logoutAdmin(): Promise<void> {
  const headers = await csrfHeaders();
  try {
    await transport<SessionStatusResponse>("/api/v1/admin/auth/logout", { method: "POST", headers });
    resetAdminSessionState();
  } catch (error) {
    if (isCsrfFailure(error)) invalidateCsrfToken();
    throw error;
  }
}

export function getAdminErrorCode(error: unknown): string | null {
  return error instanceof ApiRequestError ? (error.envelope?.error?.code ?? null) : null;
}

export function isRetryableCsrfError(error: unknown): boolean {
  return isCsrfFailure(error);
}

export function resetAdminSessionState(): void {
  invalidateCsrfToken();
  refreshPromise = null;
}

export { getCsrfToken };
