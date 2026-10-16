import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Admin route protection and login preserve safe redirect boundaries", async () => {
  const route = await readFile(new URL("src/routes/(main)/route.tsx", root), "utf8");
  const login = await readFile(new URL("src/routes/login.tsx", root), "utf8");
  const redirect = await readFile(new URL("src/lib/auth/redirect.ts", root), "utf8");

  assert.match(route, /getAdminSession/);
  assert.match(route, /status === "unauthenticated"/);
  assert.match(route, /status === "forbidden"/);
  assert.match(route, /status === "unauthenticated" \|\| session\.status === "forbidden"/);
  assert.doesNotMatch(route, /AccessDenied|دسترسی غیرمجاز|accessDenied/);
  assert.doesNotMatch(route, /to: "\/unauthorized"/);
  assert.match(login, /safeAdminRedirect/);
  assert.match(redirect, /startsWith\("\/\/"\)/);
  assert.match(redirect, /includes\("\\\\"\)/);
});

test("CSRF bootstrap is coordinated and uses the typed backend token", async () => {
  let bootstrapCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    bootstrapCalls += 1;
    assert.equal(String(input), "/api/v1/admin/auth/csrf");
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ data: { token: "csrf-test-token" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const { getCsrfToken, invalidateCsrfToken } = await import("../src/lib/api/csrf.ts");
    invalidateCsrfToken();
    const tokens = await Promise.all([getCsrfToken(), getCsrfToken(), getCsrfToken()]);
    assert.deepEqual(tokens, ["csrf-test-token", "csrf-test-token", "csrf-test-token"]);
    assert.equal(bootstrapCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logout waits for an in-flight refresh so refresh cannot restore the session", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let releaseRefresh;
  let refreshStartedResolve;
  const refreshStarted = new Promise((resolve) => {
    refreshStartedResolve = resolve;
  });
  const refreshResponse = new Promise((resolve) => {
    releaseRefresh = resolve;
  });

  globalThis.fetch = async (input) => {
    const path = new URL(String(input), "https://admin.example.test").pathname;
    calls.push(path);

    if (path.endsWith("/csrf")) {
      return Response.json({ data: { token: "csrf-race-token" } });
    }
    if (path.endsWith("/refresh")) {
      refreshStartedResolve();
      return refreshResponse;
    }
    if (path.endsWith("/me")) {
      return new Response(null, { status: 401 });
    }
    if (path.endsWith("/logout")) {
      return Response.json({ data: { authenticated: false } });
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  try {
    const { getAdminIdentity, logoutAdmin } = await import("../src/lib/api/admin-session.ts");
    const { invalidateCsrfToken } = await import("../src/lib/api/csrf.ts");
    invalidateCsrfToken();

    const identityRequest = getAdminIdentity();
    await refreshStarted;
    const logoutRequest = logoutAdmin();

    assert.equal(calls.includes("/api/v1/admin/auth/logout"), false);
    releaseRefresh(Response.json({ data: { authenticated: true } }));

    await logoutRequest;
    await assert.rejects(identityRequest, /API request failed with status 401/);
    assert.equal(calls.filter((path) => path.endsWith("/logout")).length, 1);
    assert.ok(calls.indexOf("/api/v1/admin/auth/refresh") < calls.indexOf("/api/v1/admin/auth/logout"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logout refreshes a stale CSRF cache only after an explicit CSRF rejection", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let csrfBootstraps = 0;

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), "https://admin.example.test").pathname;
    const headers = new Headers(init?.headers);
    requests.push({ path, csrf: headers.get("x-csrf-token") });

    if (path.endsWith("/csrf")) {
      csrfBootstraps += 1;
      return Response.json({ data: { token: csrfBootstraps === 1 ? "stale-token" : "current-token" } });
    }
    if (path.endsWith("/logout") && requests.filter((request) => request.path.endsWith("/logout")).length === 1) {
      return Response.json(
        { error: { code: "CSRF_TOKEN_INVALID", message: "Invalid CSRF token" } },
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    if (path.endsWith("/logout")) return Response.json({ data: { authenticated: false } });
    throw new Error(`Unexpected request: ${path}`);
  };

  try {
    const { getCsrfToken } = await import("../src/lib/api/csrf.ts");
    const { logoutAdmin } = await import("../src/lib/api/admin-session.ts");
    const { invalidateCsrfToken } = await import("../src/lib/api/csrf.ts");
    invalidateCsrfToken();
    await getCsrfToken();

    await logoutAdmin();

    assert.deepEqual(
      requests.map(({ path, csrf }) => ({ path, csrf })),
      [
        { path: "/api/v1/admin/auth/csrf", csrf: null },
        { path: "/api/v1/admin/auth/logout", csrf: "stale-token" },
        { path: "/api/v1/admin/auth/csrf", csrf: null },
        { path: "/api/v1/admin/auth/logout", csrf: "current-token" },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("login validation covers required fields, email format, and valid credentials", async () => {
  const { adminLoginSchema } = await import("../src/lib/auth/admin-login-form.ts");

  const empty = adminLoginSchema.safeParse({ email: "", password: "" });
  assert.equal(empty.success, false);
  if (!empty.success) {
    assert.deepEqual(
      empty.error.issues.map((issue) => issue.message),
      ["ایمیل معتبر وارد کنید.", "رمز عبور را وارد کنید."],
    );
  }

  const malformedEmail = adminLoginSchema.safeParse({ email: "not-an-email", password: "secret" });
  assert.equal(malformedEmail.success, false);
  assert.equal(adminLoginSchema.safeParse({ email: "ops@example.test", password: "secret" }).success, true);
});

test("login errors preserve backend messages and safely fall back", async () => {
  const { ApiRequestError } = await import("../src/lib/api/transport.ts");
  const { getSafeLoginError } = await import("../src/lib/auth/login-error.ts");

  const backendError = new ApiRequestError(
    new Response(JSON.stringify({ error: { message: "حساب کاربری غیرفعال است." } }), {
      status: 403,
      headers: { "content-type": "application/json", "x-request-id": "req-123" },
    }),
    { error: { message: "حساب کاربری غیرفعال است." } },
  );
  assert.deepEqual(getSafeLoginError(backendError), {
    message: "حساب کاربری غیرفعال است.",
    requestId: "req-123",
  });
  assert.match(getSafeLoginError(new Error("network down")).message, /ورود انجام نشد/);
  assert.match(
    getSafeLoginError(new ApiRequestError(new Response("bad", { status: 502 }), null)).message,
    /ورود انجام نشد/,
  );
});

test("CSRF behavior remains code-driven and duplicate login submissions are disabled", async () => {
  const { ApiRequestError } = await import("../src/lib/api/transport.ts");
  const { isRetryableCsrfError } = await import("../src/lib/api/admin-session.ts");
  const login = await readFile(new URL("src/routes/-components/admin-login.tsx", root), "utf8");
  const csrfError = new ApiRequestError(
    new Response(JSON.stringify({ error: { code: "CSRF_TOKEN_INVALID", message: "توکن نامعتبر است." } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
    { error: { code: "CSRF_TOKEN_INVALID", message: "توکن نامعتبر است." } },
  );

  assert.equal(isRetryableCsrfError(csrfError), true);
  assert.match(login, /form\.formState\.isSubmitting/);
  assert.match(login, /disabled=\{form\.formState\.isSubmitting\}/);
});

test("SSR auth is request-scoped and preserves separate user cookies", async () => {
  const { resolveAdminSession } = await import("../src/server/admin-auth.ts");
  const fetchImpl = async (input, init) => {
    assert.equal(new URL(input).pathname, "/api/v1/admin/auth/me");
    const cookie = new Headers(init?.headers).get("cookie");
    const email = cookie?.includes("session-a") ? "a@example.test" : "b@example.test";
    return Response.json({ data: { admin: { id: email, email, role: "WAREHOUSE" } } });
  };

  const [first, second] = await Promise.all([
    resolveAdminSession(
      new Request("https://admin.example.test/dashboard", { headers: { cookie: "eggship_admin_at=session-a" } }),
      fetchImpl,
    ),
    resolveAdminSession(
      new Request("https://admin.example.test/dashboard", { headers: { cookie: "eggship_admin_at=session-b" } }),
      fetchImpl,
    ),
  ]);

  assert.equal(first.status, "authenticated");
  assert.equal(second.status, "authenticated");
  assert.equal(first.admin.email, "a@example.test");
  assert.equal(second.admin.email, "b@example.test");
});

test("SSR refreshes an expired access cookie with the request's refresh session", async () => {
  const { resolveAdminSession } = await import("../src/server/admin-auth.ts");
  const calls = [];
  const forwardedCookies = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push(url.pathname);
    const headers = new Headers(init?.headers);
    if (url.pathname.endsWith("/me") && calls.filter((path) => path.endsWith("/me")).length === 1) {
      return new Response(JSON.stringify({ error: { code: "AUTH_ACCESS_EXPIRED" } }), { status: 401 });
    }
    if (url.pathname.endsWith("/csrf")) {
      return new Response(JSON.stringify({ data: { token: "csrf-ssr" } }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname.endsWith("/refresh")) {
      forwardedCookies.push(headers.get("cookie"));
      const response = new Response(JSON.stringify({ data: { authenticated: true } }), { status: 200 });
      response.headers.append("set-cookie", "eggship_admin_at=rotated-access; Path=/; HttpOnly");
      response.headers.append("set-cookie", "eggship_admin_rt=rotated-refresh; Path=/; HttpOnly");
      return response;
    }
    return Response.json({ data: { admin: { id: "admin-1", email: "ops@example.test", role: "SUPER_ADMIN" } } });
  };
  const setCookies = [];

  const result = await resolveAdminSession(
    new Request("https://admin.example.test/dashboard", {
      headers: { cookie: "eggship_admin_at=expired; eggship_admin_rt=refresh-a" },
    }),
    fetchImpl,
    (cookie) => setCookies.push(cookie),
  );

  assert.equal(result.status, "authenticated");
  assert.deepEqual(calls, [
    "/api/v1/admin/auth/me",
    "/api/v1/admin/auth/csrf",
    "/api/v1/admin/auth/refresh",
    "/api/v1/admin/auth/me",
  ]);
  assert.equal(forwardedCookies[0], "eggship_admin_at=expired; eggship_admin_rt=refresh-a");
  assert.deepEqual(setCookies, [
    "eggship_admin_at=rotated-access; Path=/; HttpOnly",
    "eggship_admin_rt=rotated-refresh; Path=/; HttpOnly",
  ]);
});

test("SSR refresh reuses the current CSRF cookie instead of bootstrapping over it", async () => {
  const { resolveAdminSession } = await import("../src/server/admin-auth.ts");
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, csrf: new Headers(init?.headers).get("x-csrf-token") });
    if (url.pathname.endsWith("/me") && calls.filter(({ path }) => path.endsWith("/me")).length === 1) {
      return new Response(null, { status: 401 });
    }
    if (url.pathname.endsWith("/refresh")) return Response.json({ data: { authenticated: true } });
    return Response.json({ data: { admin: { id: "admin-1", email: "ops@example.test", role: "SUPER_ADMIN" } } });
  };

  const result = await resolveAdminSession(
    new Request("https://admin.example.test/dashboard", {
      headers: { cookie: "eggship_admin_at=expired; eggship_admin_rt=refresh-a; eggship_admin_csrf=current-token" },
    }),
    fetchImpl,
  );

  assert.equal(result.status, "authenticated");
  assert.deepEqual(calls, [
    { path: "/api/v1/admin/auth/me", csrf: null },
    { path: "/api/v1/admin/auth/refresh", csrf: "current-token" },
    { path: "/api/v1/admin/auth/me", csrf: null },
  ]);
});

test("SSR distinguishes revoked sessions and temporary backend failures", async () => {
  const { resolveAdminSession } = await import("../src/server/admin-auth.ts");
  const revoked = await resolveAdminSession(
    new Request("https://admin.example.test/dashboard", { headers: { cookie: "eggship_admin_at=revoked" } }),
    async (input) => {
      const path = new URL(input).pathname;
      if (path.endsWith("/me")) return new Response(null, { status: 401 });
      if (path.endsWith("/csrf")) return Response.json({ data: { token: "csrf" } });
      return new Response(null, { status: 401 });
    },
  );
  const unavailable = await resolveAdminSession(
    new Request("https://admin.example.test/dashboard"),
    async () => new Response(null, { status: 503 }),
  );

  assert.equal(revoked.status, "unauthenticated");
  assert.equal(unavailable.status, "unavailable");
});

test("protected navigation sends unauthenticated and forbidden sessions to Login", async () => {
  const route = await readFile(new URL("src/routes/(main)/route.tsx", root), "utf8");
  const navUser = await readFile(new URL("src/routes/(main)/dashboard/-components/sidebar/nav-user.tsx", root), "utf8");
  const session = await readFile(new URL("src/lib/api/admin-session.ts", root), "utf8");

  assert.match(route, /to: "\/login"/);
  assert.match(route, /search: \{ redirect: location\.href \}/);
  assert.match(route, /status === "unauthenticated" \|\| session\.status === "forbidden"/);
  assert.doesNotMatch(route, /AccessDenied|دسترسی غیرمجاز|accessDenied/);
  assert.doesNotMatch(route, /to: "\/unauthorized"/);
  assert.match(navUser, /await logoutAdmin\(\);[\s\S]*window\.location\.replace\("\/login"\)/);
  assert.doesNotMatch(navUser, /useNavigate|navigate\(\{ to: "\/login"/);
  assert.match(session, /await transport<SessionStatusResponse>\("\/api\/v1\/admin\/auth\/logout"/);
  assert.match(session, /resetAdminSessionState\(\);/);
});
