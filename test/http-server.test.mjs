import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createQuotaDeckServer } from "../src/server/http-server.mjs";

const snapshot = {
  schemaVersion: 1,
  fetchedAt: "2026-07-19T08:31:05.000Z",
  source: { mode: "legacy", status: "ok", version: "0.43.0" },
  providers: [],
};

const publicDir = fileURLToPath(new URL("../public", import.meta.url));

test("serves the private snapshot interface with no-store and security headers", async (t) => {
  const server = createQuotaDeckServer({
    codexBarClient: {
      getSnapshot: async () => snapshot,
    },
    instanceID: "0123456789abcdef0123456789abcdef",
  });
  await listen(server);
  t.after(() => close(server));

  const origin = serverOrigin(server);
  const response = await fetch(`${origin}/api/snapshot`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-quota-deck-instance"), "0123456789abcdef0123456789abcdef");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
});

test("serves the PWA shell from an explicit asset map", async (t) => {
  const server = createQuotaDeckServer({
    codexBarClient: { getSnapshot: async () => snapshot },
    publicDir,
  });
  await listen(server);
  t.after(() => close(server));
  const origin = serverOrigin(server);

  const response = await fetch(`${origin}/`);
  const missing = await fetch(`${origin}/.env`);
  const traversal = await fetch(`${origin}/..%2fpackage.json`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.match(await response.text(), /<title>Quota Deck<\/title>/);
  assert.equal(missing.status, 404);
  assert.equal(traversal.status, 404);
});

test("allows a trusted cross-site top-level navigation to open the PWA shell", async (t) => {
  const server = createQuotaDeckServer({
    codexBarClient: { getSnapshot: async () => snapshot },
    publicDir,
    allowedHosts: ["127.0.0.1", "quota-deck.example.ts.net"],
    publicOrigin: "https://quota-deck.example.ts.net",
  });
  await listen(server);
  t.after(() => close(server));
  const origin = serverOrigin(server);

  const response = await requestWithHeaders(`${origin}/`, {
    Host: "quota-deck.example.ts.net",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
  });

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /^text\/html/);
});

test("allows trusted cross-site API refreshes from the configured public origin", async (t) => {
  const server = createQuotaDeckServer({
    codexBarClient: { getSnapshot: async () => snapshot },
    allowedHosts: ["127.0.0.1", "quota-deck.example.ts.net"],
    publicOrigin: "https://quota-deck.example.ts.net",
  });
  await listen(server);
  t.after(() => close(server));
  const origin = serverOrigin(server);

  const response = await requestWithHeaders(`${origin}/api/snapshot`, {
    Host: "quota-deck.example.ts.net",
    Origin: "https://quota-deck.example.ts.net",
    "Sec-Fetch-Site": "cross-site",
  });

  assert.equal(response.status, 200);
});

test("rejects writes and unknown API routes without calling CodexBar", async (t) => {
  let calls = 0;
  const server = createQuotaDeckServer({
    codexBarClient: {
      getSnapshot: async () => {
        calls += 1;
        return snapshot;
      },
    },
  });
  await listen(server);
  t.after(() => close(server));
  const origin = serverOrigin(server);

  const writeResponse = await fetch(`${origin}/api/snapshot`, { method: "POST" });
  const missingResponse = await fetch(`${origin}/api/private`);

  assert.equal(writeResponse.status, 405);
  assert.equal(writeResponse.headers.get("allow"), "GET, HEAD");
  assert.equal(missingResponse.status, 404);
  assert.equal(writeResponse.headers.get("cache-control"), "no-store");
  assert.equal(missingResponse.headers.get("cache-control"), "no-store");
  assert.equal(calls, 0);
});

test("requires a bearer access token for /api/snapshot when configured", async (t) => {
  const accessToken = "b".repeat(64);
  let calls = 0;
  const server = createQuotaDeckServer({
    codexBarClient: {
      getSnapshot: async () => {
        calls += 1;
        return snapshot;
      },
    },
    accessToken,
  });
  await listen(server);
  t.after(() => close(server));
  const origin = serverOrigin(server);

  const missing = await fetch(`${origin}/api/snapshot`);
  const wrong = await fetch(`${origin}/api/snapshot`, {
    headers: { Authorization: `Bearer ${"c".repeat(64)}` },
  });
  const ok = await fetch(`${origin}/api/snapshot`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const shell = await fetch(`${origin}/?t=${accessToken}`);

  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), snapshot);
  assert.equal(shell.status, 200);
  assert.equal(calls, 1);
});

test("rejects untrusted Host and cross-site browser requests", async (t) => {
  let calls = 0;
  const server = createQuotaDeckServer({
    codexBarClient: {
      getSnapshot: async () => {
        calls += 1;
        return snapshot;
      },
    },
    allowedHosts: ["127.0.0.1", "quota-deck.example.ts.net"],
  });
  await listen(server);
  t.after(() => close(server));
  const origin = serverOrigin(server);

  const badHost = await requestWithHeaders(`${origin}/api/snapshot`, {
    Host: "evil.example",
  });
  const crossSite = await fetch(`${origin}/api/snapshot`, {
    headers: {
      Origin: "https://evil.example",
      "Sec-Fetch-Site": "cross-site",
    },
  });

  assert.equal(badHost.status, 403);
  assert.equal(crossSite.status, 403);
  assert.equal(badHost.headers["cache-control"], "no-store");
  assert.equal(crossSite.headers.get("cache-control"), "no-store");
  assert.equal(calls, 0);
});

test("maps upstream failures to generic no-store API errors", async (t) => {
  const failures = [
    Object.assign(new Error("private@example.invalid timed out"), { status: 504 }),
    new Error("/Users/private/provider credential failed"),
  ];
  const logged = [];
  const server = createQuotaDeckServer({
    codexBarClient: {
      getSnapshot: async () => {
        throw failures.shift();
      },
    },
    logger: {
      error: (...values) => logged.push(values),
    },
  });
  await listen(server);
  t.after(() => close(server));
  const origin = serverOrigin(server);

  const timeout = await fetch(`${origin}/api/snapshot`);
  const unavailable = await fetch(`${origin}/api/snapshot`);

  assert.equal(timeout.status, 504);
  assert.deepEqual(await timeout.json(), { error: "upstream_timeout" });
  assert.equal(unavailable.status, 502);
  assert.deepEqual(await unavailable.json(), { error: "upstream_unavailable" });
  assert.equal(timeout.headers.get("cache-control"), "no-store");
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(JSON.stringify(logged), /private@example\.invalid|\/Users\/private/u);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function serverOrigin(server) {
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

function requestWithHeaders(url, headers) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers,
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          resolve({ status: response.statusCode, headers: response.headers });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}
