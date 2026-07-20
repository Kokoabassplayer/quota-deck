import assert from "node:assert/strict";
import test from "node:test";

import { loadRuntimeConfig } from "../src/server/runtime-config.mjs";

test("defaults to a loopback-only gateway", () => {
  assert.deepEqual(loadRuntimeConfig({}), {
    host: "127.0.0.1",
    port: 8787,
    allowedHosts: ["127.0.0.1", "localhost"],
    publicOrigin: null,
    dashboardToken: undefined,
    codexBarOrigin: "http://127.0.0.1:8080",
  });
});

test("accepts one exact Tailscale Serve HTTPS origin", () => {
  assert.deepEqual(
    loadRuntimeConfig({
      QUOTA_DECK_PORT: "9443",
      QUOTA_DECK_PUBLIC_ORIGIN: "https://quota-deck.example-tailnet.ts.net",
      CODEXBAR_DASHBOARD_TOKEN: "secret-token",
    }),
    {
      host: "127.0.0.1",
      port: 9443,
      allowedHosts: ["127.0.0.1", "localhost", "quota-deck.example-tailnet.ts.net"],
      publicOrigin: "https://quota-deck.example-tailnet.ts.net",
      dashboardToken: "secret-token",
      codexBarOrigin: "http://127.0.0.1:8080",
    },
  );
});

test("accepts an explicit HTTPS listener port for a non-default Serve route", () => {
  assert.equal(
    loadRuntimeConfig({
      QUOTA_DECK_PUBLIC_ORIGIN: "https://quota-deck.example-tailnet.ts.net:8443",
    }).publicOrigin,
    "https://quota-deck.example-tailnet.ts.net:8443",
  );
});

test("accepts one strict loopback CodexBar origin override", () => {
  assert.equal(
    loadRuntimeConfig({ QUOTA_DECK_CODEXBAR_ORIGIN: "http://127.0.0.1:9090" }).codexBarOrigin,
    "http://127.0.0.1:9090",
  );
});

test("allows gateway port 8080 when CodexBar uses a different custom port", () => {
  const config = loadRuntimeConfig({
    QUOTA_DECK_PORT: "8080",
    QUOTA_DECK_CODEXBAR_ORIGIN: "http://127.0.0.1:9001",
  });
  assert.equal(config.port, 8080);
  assert.equal(config.codexBarOrigin, "http://127.0.0.1:9001");
});

test("rejects public, ambiguous, or conflicting gateway configuration", () => {
  for (const env of [
    { QUOTA_DECK_PORT: "8080" },
    { QUOTA_DECK_PORT: "80" },
    { QUOTA_DECK_PORT: "not-a-port" },
    { QUOTA_DECK_PUBLIC_ORIGIN: "http://quota.example.ts.net" },
    { QUOTA_DECK_PUBLIC_ORIGIN: "https://example.com" },
    { QUOTA_DECK_PUBLIC_ORIGIN: "https://user@quota.example.ts.net" },
    { QUOTA_DECK_PUBLIC_ORIGIN: "https://quota.example.ts.net/path" },
    { CODEXBAR_DASHBOARD_TOKEN: "bad\ntoken" },
    { QUOTA_DECK_CODEXBAR_ORIGIN: "https://127.0.0.1:8080" },
    { QUOTA_DECK_CODEXBAR_ORIGIN: "http://localhost:8080" },
    { QUOTA_DECK_CODEXBAR_ORIGIN: "http://0.0.0.0:8080" },
    { QUOTA_DECK_CODEXBAR_ORIGIN: "http://127.0.0.1:8080/path" },
    { QUOTA_DECK_CODEXBAR_ORIGIN: "http://user@127.0.0.1:8080" },
    { QUOTA_DECK_CODEXBAR_ORIGIN: "http://127.0.0.1:80" },
    { QUOTA_DECK_CODEXBAR_ORIGIN: "http://127.0.0.1:8787" },
  ]) {
    assert.throws(() => loadRuntimeConfig(env));
  }
});
