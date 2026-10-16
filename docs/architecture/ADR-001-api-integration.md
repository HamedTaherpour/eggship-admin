# ADR-001: EggShip Admin API integration boundary

Status: **Implemented foundation — backend and deployment security review required; unresolved decisions remain pending**

Date: 2026-10-16

## Context

EggShip Admin is an independent TanStack Start frontend. The NestJS backend owns authentication and authorization. The backend OpenAPI document is the contract source; this ADR intentionally does not invent endpoints or DTOs.

## Proposed baseline

Use a same-origin reverse proxy at the deployment boundary. The browser calls the Admin origin; the proxy forwards approved requests to NestJS, preserves `Set-Cookie`, and forwards only the required request headers. This keeps host-only Admin cookies available to browser requests and SSR requests reaching the Admin server without making tokens browser-readable. It avoids introducing a bespoke BFF in application code while leaving TanStack Start server functions available for narrowly scoped server-only operations.

The public proxy path should preserve `/api/v1/admin` as the upstream request path. This is the lowest-risk baseline because the backend currently sets cookie `Path=/api/v1/admin`; requests under that path will then naturally receive the cookies without a cookie-path transformation. A different public path is possible only after an explicit cookie and CSRF review.

This is a proposal, not an implementation or backend cookie change.

## ADMIN-04 implementation

The frontend now owns a narrow TanStack Start server route at `/api/v1/admin/$`. Its handler delegates to `src/server/api-proxy.ts`, validates that the incoming pathname is exactly `/api/v1/admin` or below it, permits only `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`, and forwards the unchanged request bytes to the configured `API_BACKEND_ORIGIN`. The backend origin is server-only and must be an absolute HTTP(S) origin without credentials or a path. The proxy does not log request data and does not expose backend configuration to the browser.

The proxy request-header allowlist is explicit: `Accept`, `Accept-Language`, `Content-Type`, `Cookie`, `Origin`, `Referer`, `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site`, `X-CSRF-Token`, and `X-Request-Id`. `Authorization`, `Host`, forwarding headers, and arbitrary client headers are not forwarded. Response status, content type, selected safe diagnostic/cache headers, and every `Set-Cookie` value are preserved. No cookie or token is parsed, rewritten, or returned to JavaScript. Automatic refresh and bearer-token transport are intentionally out of scope.

The typed transport in `src/lib/api/transport.ts` is a small same-origin client for generated Admin paths. It defaults to `credentials: "include"`, accepts an `AbortSignal` through `RequestInit`, supports JSON and raw bodies, parses JSON error envelopes, returns non-JSON responses as bytes, and exposes the response/request ID for diagnostics. It does not retry or refresh.

### Required deployment routing

The public Admin origin must send `/api/v1/admin/*` requests to the TanStack Start/Nitro server and must not route them directly to a static asset fallback. `API_BACKEND_ORIGIN` must point to the independent NestJS origin, with no trailing path beyond `/`. The Nitro server must be able to reach that origin over the deployment network. This repository does not configure an edge/load-balancer reverse proxy, TLS termination, DNS, or network policy.

### Cookie and CSRF compatibility

The selected public path preserves the backend cookie path `/api/v1/admin`; therefore no `Path` rewrite is performed. The proxy copies multiple `Set-Cookie` headers independently, so backend access/refresh rotation and clearing responses remain intact. `Domain`, `SameSite`, `Secure`, expiry, and cookie values are not rewritten. This is verified by mocked `Response` tests only; a browser against a real backend is still required to verify browser cookie storage and sending behavior.

Browser mutations must send the CSRF cookie-derived `X-CSRF-Token` while the proxy preserves the browser's `Origin`, `Referer`, and Fetch Metadata headers. The backend must allow the actual public Admin origin(s) in its trusted-origin policy and must validate those headers against that public origin, not the internal `API_BACKEND_ORIGIN`. The proxy never forges or removes those security headers. The CSRF bootstrap endpoint and exact cookie attributes remain backend-owned.

SSR callers must explicitly use an absolute public Admin URL and forward only the incoming request's approved `Cookie`, CSRF, origin, referer, Fetch Metadata, and request-ID headers. SSR data must not serialize cookie values, tokens, or sensitive error bodies into loader data, HTML, or logs. Browser callers use the relative same-origin path.

## Options and decisions to resolve

### 1. Browser-to-API versus same-origin proxy/BFF

Direct browser-to-API requests require cross-origin credentials and CORS coordination, while a same-origin reverse proxy avoids exposing that browser boundary. A full BFF/server-function layer centralizes policy but adds server code and SSR forwarding responsibility. The proposed reverse proxy is preferred; exact ownership, routing, and observability remain **Unresolved**.

### 2. TanStack Start SSR cookie forwarding

TanStack Start executes initial route loaders on the server by default. SSR loaders may forward the incoming request's relevant `Cookie` header to the proxy and may use the response status/body to decide whether the user is authenticated. They must never put access tokens, refresh tokens, raw cookie values, or CSRF secrets in loader data, dehydrated query state, logs, or HTML. If an SSR request causes login or refresh, the server must forward only the backend's intended `Set-Cookie` headers to the browser and must not expose their values to application code. The exact allowlisted headers, redirect behavior, and response-header forwarding remain **Unresolved**.

### 3. HttpOnly admin cookies and paths

Use backend-controlled HttpOnly access/refresh cookies with the narrowest valid paths. Browser code must not assume cookies expose tokens. The initial deployment must not rewrite `Domain` or `Path` unless the chosen public topology makes it unavoidable:

- Preserve the public `/api/v1/admin` path so `Path=/api/v1/admin` remains correct end to end.
- Prefer host-only cookies by omitting `Domain`; do not broaden a backend cookie to a parent domain merely to make proxying convenient.
- If a different public path is required, the proxy would need a deliberately reviewed `Set-Cookie` rewrite (at least `Path`, and possibly `Domain`). Such a rewrite changes the browser's cookie scope, can make cookies available to unintended routes or hosts, and must be tested for auth, CSRF, logout, and refresh behavior. It is not assumed harmless.

Exact names, `SameSite`, `Secure`, and any unavoidable rewrite rules come from backend and deployment review. **Unresolved.**

### 4. CSRF bootstrap and mutation headers

The backend's CSRF cookie may be readable by browser JavaScript when its host and path permit it. The frontend may read only that CSRF cookie and copy its value into `X-CSRF-Token` for every browser mutation. A same-origin, non-mutating bootstrap/request should establish or refresh the CSRF cookie before the first mutation; the frontend must not derive a CSRF token from an HttpOnly auth cookie. The proxy must preserve the browser's `Origin`, `Referer`, and `Sec-Fetch-Site` headers so backend validation applies to the public Admin origin, and the backend allowlist must contain the real public origin(s), not an internal upstream origin. Missing or expired CSRF tokens and rejected origin metadata fail closed; they are not fixed by retrying without the header. TanStack Start server-function CSRF protection must not be confused with the backend API's CSRF contract. **Unresolved pending backend naming, bootstrap endpoint, and deployment-origin review.**

### 5. Cross-origin versus same-site deployment

Choose a deployment topology that defines CORS, credentials, cookie attributes, and local development origins together. **Unresolved.**

### 6. Concurrent refresh-token rotation

Refresh tokens rotate atomically, so two refresh calls using the same cookie can race: one can succeed and invalidate the token used by the other. The client transport therefore needs single-flight refresh: when one request receives an authentication-expired response, it becomes the sole refresh owner; concurrent requests await the same promise, then retry their original request at most once with the resulting cookies. A failed refresh rejects all waiters and sends one unauthenticated outcome (for example, a login redirect), without recursively refreshing or starting a retry storm. SSR needs equivalent request coalescing at the server boundary, or an approved backend grace/idempotency mechanism; a browser-only mutex is insufficient for concurrent SSR requests or multiple tabs. Exact coordination scope and failure semantics remain **Unresolved**.

### 7. OpenAPI-generated TypeScript contracts

The backend contract snapshot is `contracts/eggship-backend.openapi.json`, supplied as an exact backend-generated artifact for this integration foundation. Do not generate DTOs, client types, or endpoint wrappers outside that specification. `openapi-typescript` is pinned, the snapshot is validated before generation, and generated code is kept separate from handwritten runtime code. Authentication, transport, proxying, and runtime integration remain unresolved.

### 8. Request IDs, API errors, and validation errors

Standardize request ID propagation, API error normalization, field validation mapping, and user-safe messages. Preserve request IDs for support diagnostics without displaying sensitive payloads. **Unresolved.**

### 9. Pagination and query caching

Define cursor/offset semantics, stable query keys, sort/filter encoding, and invalidation rules. Integrate with TanStack Query only after the contract and SSR prefetch boundary are approved. **Unresolved.**

### 10. Idempotency and bulk-operation partial results

Define which mutations accept idempotency keys, their scope/expiry, and how duplicate requests are reported. Define a stable partial-result envelope for bulk operations so successful and failed items can be rendered independently. **Unresolved.**

### 11. Permission-based authorization

The backend remains authoritative. The frontend may hide or disable controls based on returned capabilities, but every protected operation must be enforced by NestJS. Define capability naming, stale-session behavior, and 403 handling. **Unresolved.**

## Consequences

This foundation does not implement login/logout UI, session management, authorization, refresh, or business modules. It is not a full BFF and it does not make the backend independently secure: deployment routing, trusted-origin configuration, cookie flags, CSRF bootstrap behavior, TLS, and real browser cookie behavior require backend/deployment verification.

## Remaining backend and deployment dependencies / risks

- Confirm the exact public Admin origin(s), including local, preview, and production origins, in the backend trusted-origin/CSRF allowlist.
- Confirm the backend emits host-only cookies (no `Domain`), with the intended `Secure`, `SameSite`, expiry, and HttpOnly attributes for every Admin auth and CSRF cookie.
- Verify real browser login, refresh rotation, logout clearing, CSRF bootstrap, rejected origins, and rejected/missing CSRF headers through the deployed proxy.
- Ensure the deployment forwards `/api/v1/admin/*` to this server route, preserves response `Set-Cookie` multiplicity, and does not independently rewrite cookie attributes.
- Define observability handling so request IDs are retained without recording cookies, authorization material, tokens, or sensitive bodies.
- Concurrent refresh coordination, authorization UX, pagination/cache policy, idempotency, and API error presentation remain unresolved and are intentionally not implemented here.
