import { createAdminApiTransport } from "./transport.ts";

type CsrfResponse = { data: { token: string } };

let csrfToken: string | null = null;
let bootstrapPromise: { generation: number; promise: Promise<string> } | null = null;
let csrfGeneration = 0;

const transport = createAdminApiTransport();

export function invalidateCsrfToken(): void {
  csrfToken = null;
  csrfGeneration += 1;
}

export async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (bootstrapPromise !== null) {
    if (bootstrapPromise.generation === csrfGeneration) return await bootstrapPromise.promise;

    await bootstrapPromise.promise.catch(() => undefined);
    return await getCsrfToken();
  }

  const generation = csrfGeneration;
  const promise = transport<CsrfResponse>("/api/v1/admin/auth/csrf").then(({ data }) => {
    const token = data.data.token;
    if (generation === csrfGeneration) csrfToken = token;
    return token;
  });
  const currentBootstrap = { generation, promise };
  bootstrapPromise = currentBootstrap;

  try {
    return await promise;
  } finally {
    if (bootstrapPromise === currentBootstrap) bootstrapPromise = null;
  }
}

export async function csrfHeaders(): Promise<Headers> {
  return new Headers({ "X-CSRF-Token": await getCsrfToken() });
}
