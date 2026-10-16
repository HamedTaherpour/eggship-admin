import { createAdminApiTransport } from "./transport.ts";

type CsrfResponse = { data: { token: string } };

let csrfToken: string | null = null;
let bootstrapPromise: Promise<string> | null = null;

const transport = createAdminApiTransport();

export function invalidateCsrfToken(): void {
  csrfToken = null;
}

export async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (bootstrapPromise !== null) return await bootstrapPromise;

  bootstrapPromise = transport<CsrfResponse>("/api/v1/admin/auth/csrf").then(({ data }) => {
    csrfToken = data.data.token;
    return csrfToken;
  });

  try {
    return await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}

export async function csrfHeaders(): Promise<Headers> {
  return new Headers({ "X-CSRF-Token": await getCsrfToken() });
}
