import { ApiRequestError, createAdminApiTransport } from "../src/lib/api/transport.ts";
import { ApiProxyPathError, proxyAdminApiRequest } from "../src/server/api-proxy.ts";
import assert from "node:assert/strict";
import test from "node:test";

test("proxies approved paths, methods, bodies, CSRF, request IDs, and multiple cookies", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const response = await proxyAdminApiRequest(
    new Request("https://admin.example.test/api/v1/admin/orders?status=paid", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "eggship_admin_at=opaque; csrf_token=csrf-value",
        origin: "https://admin.example.test",
        referer: "https://admin.example.test/orders",
        "sec-fetch-site": "same-origin",
        "x-csrf-token": "csrf-value",
        "x-request-id": "request-123",
        authorization: "Bearer must-not-forward",
        host: "attacker.example.test",
      },
      body: JSON.stringify({ orderId: "order-1" }),
    }),
    {
      backendOrigin: "https://api.example.test/",
      fetchImpl: async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        const backendResponse = new Response(JSON.stringify({ ok: true }), {
          status: 202,
          headers: {
            "content-type": "application/json",
            "x-request-id": "backend-request-456",
          },
        });
        backendResponse.headers.append("set-cookie", "eggship_admin_at=a; Path=/api/v1/admin; HttpOnly");
        backendResponse.headers.append("set-cookie", "eggship_admin_rt=b; Path=/api/v1/admin; HttpOnly");
        return backendResponse;
      },
    },
  );

  assert.equal(capturedUrl, "https://api.example.test/api/v1/admin/orders?status=paid");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(await new Response(capturedInit?.body).text(), JSON.stringify({ orderId: "order-1" }));
  const forwardedHeaders = new Headers(capturedInit?.headers);
  assert.equal(forwardedHeaders.get("x-csrf-token"), "csrf-value");
  assert.equal(forwardedHeaders.get("x-request-id"), "request-123");
  assert.equal(forwardedHeaders.get("origin"), "https://admin.example.test");
  assert.equal(forwardedHeaders.get("authorization"), null);
  assert.equal(forwardedHeaders.get("host"), null);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("x-request-id"), "backend-request-456");
  assert.deepEqual(response.headers.getSetCookie(), [
    "eggship_admin_at=a; Path=/api/v1/admin; HttpOnly",
    "eggship_admin_rt=b; Path=/api/v1/admin; HttpOnly",
  ]);
});

test("rejects paths outside the approved Admin API prefix", async () => {
  await assert.rejects(
    proxyAdminApiRequest(new Request("https://admin.example.test/api/v1/health"), {
      backendOrigin: "https://api.example.test/",
      fetchImpl: async () => new Response("unexpected"),
    }),
    ApiProxyPathError,
  );
});

test("returns 405 for methods outside the Admin API contract", async () => {
  const response = await proxyAdminApiRequest(
    new Request("https://admin.example.test/api/v1/admin/orders", { method: "OPTIONS" }),
    { backendOrigin: "https://api.example.test/" },
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, POST, PUT, PATCH, DELETE");
});

test("preserves non-JSON content and handles network failures without logging sensitive data", async () => {
  const response = await proxyAdminApiRequest(new Request("https://admin.example.test/api/v1/admin/media/file"), {
    backendOrigin: "https://api.example.test/",
    fetchImpl: async () => new Response("binary", { status: 206, headers: { "content-type": "image/png" } }),
  });

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(await response.text(), "binary");

  const unavailable = await proxyAdminApiRequest(
    new Request("https://admin.example.test/api/v1/admin/orders", {
      headers: { "x-request-id": "request-999", cookie: "secret-cookie" },
    }),
    {
      backendOrigin: "https://api.example.test/",
      fetchImpl: async () => {
        throw new Error("backend unavailable");
      },
    },
  );
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.headers.get("x-request-id"), "request-999");
  assert.deepEqual(await unavailable.json(), { error: { code: "API_UNAVAILABLE", message: "API unavailable" } });
});

test("typed transport forwards credentials and parses API error envelopes", async () => {
  const transport = createAdminApiTransport({
    fetchImpl: async (_input, init) => {
      assert.equal(init?.credentials, "include");
      assert.equal(new Headers(init?.headers).get("x-csrf-token"), "csrf-value");
      return new Response(JSON.stringify({ error: { code: "AUTH_FORBIDDEN", message: "Forbidden" } }), {
        status: 403,
        headers: { "content-type": "application/json", "x-request-id": "request-789" },
      });
    },
  });

  await assert.rejects(
    transport("/api/v1/admin/auth/me", {
      headers: { "x-csrf-token": "csrf-value" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 403);
      assert.equal(error.requestId, "request-789");
      return true;
    },
  );
});
