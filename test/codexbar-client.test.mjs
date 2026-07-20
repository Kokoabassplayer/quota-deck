import assert from "node:assert/strict";
import test from "node:test";

import { createCodexBarClient } from "../src/server/codexbar-client.mjs";
import {
  currentUsage,
  dashboardV1Snapshot,
  detailedCodexCost,
  detailedCodexUsage,
} from "./fixtures/codexbar-payloads.mjs";

test("uses the authenticated dashboard snapshot when CodexBar supports it", async () => {
  const calls = [];
  const client = createCodexBarClient({
    token: "test-token",
    now: () => new Date("2026-07-19T08:31:05.000Z"),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(url);
      const body = parsed.pathname === "/cost"
        ? detailedCodexCost
        : parsed.pathname === "/usage"
          ? detailedCodexUsage
          : dashboardV1Snapshot;
      return Response.json(body, {
        headers: { "cache-control": "no-store" },
      });
    },
  });

  const quotaSnapshot = await client.getSnapshot();
  assert.equal(quotaSnapshot.providers[0].cost.sessionTokens, undefined);
  await waitFor(() => calls.filter(({ url }) => url.endsWith("/dashboard/v1/snapshot")).length >= 2);
  const snapshot = await client.getSnapshot();

  const dashboardCall = calls.find(({ url }) => url.endsWith("/dashboard/v1/snapshot"));
  const costCall = calls.find(({ url }) => url.endsWith("/cost?provider=codex"));
  const usageCall = calls.find(({ url }) => url.endsWith("/usage?provider=codex"));
  assert.equal(dashboardCall.options.headers.Authorization, "Bearer test-token");
  assert.equal(costCall.options.headers.Authorization, undefined);
  assert.equal(usageCall.options.headers.Authorization, undefined);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.staleAfterSeconds, 180);
  assert.deepEqual(snapshot.gateway, { version: "0.1.0" });
  assert.deepEqual(snapshot.freshness, {
    state: "fresh",
    staleAt: "2026-07-19T08:34:00.000Z",
  });
  assert.deepEqual(snapshot.source, {
    mode: "dashboard",
    status: "ok",
    version: "0.45.1",
  });
  assert.deepEqual(snapshot.providers[0], {
    id: "codex",
    label: "Codex",
    source: "oauth",
    state: "ok",
    updatedAt: "2026-07-19T08:30:30.000Z",
    windows: [
      {
        kind: "session",
        label: "SESSION",
        usedPercent: 25,
        remainingPercent: 75,
        windowMinutes: null,
        resetsAt: "2026-07-19T12:00:00.000Z",
        synthetic: false,
      },
    ],
    cost: {
      currency: "USD",
      today: 2.5,
      session: 2.75,
      last30Days: 31,
      sessionTokens: 12_233_096,
      last30DaysTokens: 2_750_469_967,
      historyDays: 30,
      topModel: "gpt-5.6-sol",
      daily: [
        { date: "2026-07-18", tokens: 18_000_000, cost: 11.25 },
        { date: "2026-07-19", tokens: 12_233_096, cost: 9.74 },
      ],
      updatedAt: "2026-07-19T08:30:50.000Z",
    },
    resetCredits: {
      available: 2,
      expiresAt: [
        "2026-07-31T20:00:30.000Z",
        "2026-08-12T17:36:39.000Z",
      ],
      updatedAt: "2026-07-19T08:30:55.000Z",
    },
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /example\.invalid|accentColor|plan/);
});

test("falls back to legacy usage when the dashboard endpoint is unavailable", async () => {
  const calls = [];
  const missingDashboard = new Response('{"error":"not found"}', {
    status: 404,
    headers: { "content-type": "application/json" },
  });
  const responses = new Map([
    ["/dashboard/v1/snapshot", missingDashboard],
    ["/cost?provider=codex", Response.json([])],
    ["/usage?provider=codex", Response.json([])],
    ["/usage", Response.json(currentUsage)],
  ]);
  const client = createCodexBarClient({
    token: "test-token",
    now: () => new Date("2026-07-19T08:31:05.000Z"),
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      calls.push({ path: `${parsed.pathname}${parsed.search}`, options });
      return responses.get(`${parsed.pathname}${parsed.search}`);
    },
  });

  const snapshot = await client.getSnapshot();

  assert.deepEqual(calls.map(({ path }) => path).sort(), [
    "/dashboard/v1/snapshot",
    "/usage",
  ]);
  assert.equal(
    calls.find(({ path }) => path === "/dashboard/v1/snapshot").options.headers.Authorization,
    "Bearer test-token",
  );
  for (const call of calls.filter(({ path }) => path !== "/dashboard/v1/snapshot")) {
    assert.equal(call.options.headers.Authorization, undefined);
  }
  assert.deepEqual(snapshot.source, {
    mode: "legacy",
    status: "ok",
    version: null,
  });
  assert.equal(snapshot.fetchedAt, "2026-07-19T08:31:05.000Z");
  assert.equal(snapshot.providers[0].id, "codex");
  assert.equal(snapshot.providers[0].windows[0].remainingPercent, 36);
  assert.equal(snapshot.providers[0].cost, undefined);
  assert.equal(missingDashboard.bodyUsed, true);
});

test("uses a configurable strict loopback origin supplied by runtime configuration", async () => {
  const calls = [];
  const client = createCodexBarClient({
    origin: "http://127.0.0.1:9090",
    fetchImpl: async (url) => {
      calls.push(url);
      return Response.json(currentUsage);
    },
  });
  await client.refreshSnapshot();
  assert.equal(calls[0], "http://127.0.0.1:9090/usage");
  client.close();
});

test("returns last-known-good data while one background refresh is in flight", async () => {
  let dashboardCalls = 0;
  let resolveRefresh;
  let currentTime = new Date("2026-07-19T08:31:05.000Z");
  const client = createCodexBarClient({
    token: "test-token",
    now: () => currentTime,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/cost") return Response.json(detailedCodexCost);
      if (parsed.pathname === "/usage") return Response.json(detailedCodexUsage);
      dashboardCalls += 1;
      if (dashboardCalls === 1) return Response.json(dashboardV1Snapshot);
      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    },
  });

  const initial = await client.getSnapshot();
  currentTime = new Date("2026-07-19T08:35:05.000Z");
  const cached = await client.getSnapshot();
  const joinedRefresh = client.refreshSnapshot();
  const cachedAgain = await client.getSnapshot();

  assert.equal(dashboardCalls, 2);
  assert.equal(initial.freshness.state, "fresh");
  assert.equal(cached.freshness.state, "stale");
  assert.equal(cachedAgain.fetchedAt, initial.fetchedAt);

  resolveRefresh(Response.json({
    ...dashboardV1Snapshot,
    generatedAt: "2026-07-19T08:35:00.000Z",
  }));
  const refreshed = await joinedRefresh;

  assert.equal(refreshed.fetchedAt, "2026-07-19T08:35:00.000Z");
  assert.equal(refreshed.freshness.state, "fresh");
});

test("keeps recent provider quota when one dashboard refresh times out", async () => {
  const healthy = structuredClone(dashboardV1Snapshot);
  healthy.generatedAt = "2026-07-20T04:48:00.000Z";
  healthy.staleAfterSeconds = 360;
  healthy.providers[0].updatedAt = "2026-07-20T04:47:58.000Z";

  const timedOut = structuredClone(healthy);
  timedOut.generatedAt = "2026-07-20T04:49:04.000Z";
  timedOut.providers[0] = {
    ...timedOut.providers[0],
    source: "auto",
    status: { level: "error", updatedAt: timedOut.generatedAt },
    windows: [],
    error: { code: "provider_error", kind: "timeout" },
    updatedAt: timedOut.generatedAt,
    cost: { todayUSD: 54.59, last30DaysUSD: 1_900.14 },
  };

  const { client, setTime } = createDashboardSequenceClient({
    responses: [healthy, timedOut],
    initialTime: "2026-07-20T04:48:01.000Z",
  });

  const first = await client.refreshSnapshot();
  setTime("2026-07-20T04:49:05.000Z");
  const fallback = await client.refreshSnapshot();

  assert.equal(first.providers[0].state, "ok");
  assert.equal(fallback.providers[0].state, "partial");
  assert.deepEqual(fallback.providers[0].windows, first.providers[0].windows);
  assert.equal(fallback.providers[0].updatedAt, "2026-07-20T04:47:58.000Z");
  assert.deepEqual(fallback.providers[0].error, {
    code: "provider_error",
    kind: "timeout",
  });
  assert.equal(fallback.providers[0].cost.last30Days, 1_900.14);
  client.close();
});

test("does not reuse cached quota after the dashboard identity changes", async () => {
  const healthy = structuredClone(dashboardV1Snapshot);
  healthy.generatedAt = "2026-07-20T04:48:00.000Z";
  healthy.staleAfterSeconds = 360;
  healthy.providers[0].identity = { accountEmail: "account-a@example.invalid", plan: "Pro" };

  const changedAccountFailure = structuredClone(healthy);
  changedAccountFailure.generatedAt = "2026-07-20T04:49:04.000Z";
  changedAccountFailure.providers[0] = {
    ...changedAccountFailure.providers[0],
    identity: { accountEmail: "account-b@example.invalid", plan: "Pro" },
    status: { level: "error", updatedAt: changedAccountFailure.generatedAt },
    windows: [],
    error: { code: "provider_error", kind: "timeout" },
    updatedAt: changedAccountFailure.generatedAt,
  };

  const { client, setTime } = createDashboardSequenceClient({
    responses: [healthy, changedAccountFailure],
    initialTime: "2026-07-20T04:48:01.000Z",
  });

  await client.refreshSnapshot();
  setTime("2026-07-20T04:49:05.000Z");
  const result = await client.refreshSnapshot();

  assert.equal(result.providers[0].state, "error");
  assert.deepEqual(result.providers[0].windows, []);
  client.close();
});

test("expires retained quota six minutes after the last successful provider refresh", async () => {
  const healthy = structuredClone(dashboardV1Snapshot);
  healthy.generatedAt = "2026-07-20T04:48:00.000Z";
  healthy.staleAfterSeconds = 60;
  const timedOut = structuredClone(healthy);
  timedOut.providers[0] = {
    ...timedOut.providers[0],
    status: { level: "error" },
    windows: [],
    error: { kind: "timeout" },
  };

  const { client, setTime } = createDashboardSequenceClient({
    responses: [healthy, timedOut, timedOut],
    initialTime: "2026-07-20T04:48:01.000Z",
  });

  await client.refreshSnapshot();
  setTime("2026-07-20T04:49:01.000Z");
  const firstTimeout = await client.refreshSnapshot();
  setTime("2026-07-20T04:54:02.000Z");
  const expired = await client.refreshSnapshot();

  assert.equal(firstTimeout.providers[0].state, "partial");
  assert.equal(expired.providers[0].state, "error");
  assert.deepEqual(expired.providers[0].windows, []);
  client.close();
});

test("replaces retained quota on recovery without blocking healthy providers", async () => {
  const healthy = structuredClone(dashboardV1Snapshot);
  healthy.generatedAt = "2026-07-20T04:48:00.000Z";
  healthy.staleAfterSeconds = 360;
  healthy.providers.push({
    id: "zai",
    name: "z.ai",
    enabled: true,
    source: "api",
    identity: { accountEmail: "zai@example.invalid", plan: "Pro" },
    windows: [{ kind: "tokens", label: "Tokens", usedPercent: 10, remainingPercent: 90 }],
    error: null,
    updatedAt: "2026-07-20T04:47:59.000Z",
  });

  const timedOut = structuredClone(healthy);
  timedOut.generatedAt = "2026-07-20T04:49:04.000Z";
  timedOut.providers[0] = {
    ...timedOut.providers[0],
    status: { level: "error" },
    windows: [],
    error: { kind: "timeout" },
  };
  timedOut.providers[1].windows[0] = {
    kind: "tokens",
    label: "Tokens",
    usedPercent: 20,
    remainingPercent: 80,
  };

  const recovered = structuredClone(healthy);
  recovered.generatedAt = "2026-07-20T04:50:04.000Z";
  recovered.providers[0].updatedAt = "2026-07-20T04:50:03.000Z";
  recovered.providers[0].windows[0].usedPercent = 2;
  recovered.providers[0].windows[0].remainingPercent = 98;

  const { client, setTime } = createDashboardSequenceClient({
    responses: [healthy, timedOut, recovered],
    initialTime: "2026-07-20T04:48:01.000Z",
  });

  await client.refreshSnapshot();
  setTime("2026-07-20T04:49:05.000Z");
  const fallback = await client.refreshSnapshot();
  setTime("2026-07-20T04:50:05.000Z");
  const result = await client.refreshSnapshot();

  assert.equal(fallback.providers.find(({ id }) => id === "codex").state, "partial");
  assert.equal(
    fallback.providers.find(({ id }) => id === "zai").windows[0].remainingPercent,
    80,
  );
  assert.equal(result.providers.find(({ id }) => id === "codex").state, "ok");
  assert.equal(
    result.providers.find(({ id }) => id === "codex").windows[0].remainingPercent,
    98,
  );
  client.close();
});

test("does not retain quota after an unauthorized provider response", async () => {
  const healthy = structuredClone(dashboardV1Snapshot);
  healthy.generatedAt = "2026-07-20T04:48:00.000Z";
  healthy.staleAfterSeconds = 360;
  const unauthorized = structuredClone(healthy);
  unauthorized.providers[0] = {
    ...unauthorized.providers[0],
    status: { level: "error" },
    windows: [],
    error: { code: 401, kind: "authentication" },
  };

  const { client, setTime } = createDashboardSequenceClient({
    responses: [healthy, unauthorized],
    initialTime: "2026-07-20T04:48:01.000Z",
  });

  await client.refreshSnapshot();
  setTime("2026-07-20T04:49:05.000Z");
  const result = await client.refreshSnapshot();

  assert.equal(result.providers[0].state, "error");
  assert.equal(result.providers[0].error.kind, "unauthorized");
  assert.deepEqual(result.providers[0].windows, []);
  client.close();
});

test("drops expired enrichment after a later optional refresh fails", async () => {
  let enrichmentAvailable = true;
  let dashboardCalls = 0;
  let currentTime = new Date("2026-07-19T08:31:05.000Z");
  const client = createCodexBarClient({
    token: "test-token",
    now: () => currentTime,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/cost") {
        return enrichmentAvailable
          ? Response.json(detailedCodexCost)
          : Response.json([], { status: 503 });
      }
      if (parsed.pathname === "/usage") {
        return enrichmentAvailable
          ? Response.json(detailedCodexUsage)
          : Response.json([], { status: 503 });
      }
      dashboardCalls += 1;
      return Response.json({
        ...dashboardV1Snapshot,
        generatedAt: currentTime.toISOString(),
      });
    },
  });

  await client.refreshSnapshot();
  await waitFor(() => dashboardCalls >= 2);
  const initial = await client.getSnapshot();
  assert.equal(initial.providers[0].cost.sessionTokens, 12_233_096);
  assert.equal(initial.providers[0].resetCredits.available, 2);
  await settleBackgroundWork();

  enrichmentAvailable = false;
  currentTime = new Date("2026-07-19T08:37:05.000Z");
  const refreshed = await client.refreshSnapshot();

  assert.equal(refreshed.providers[0].cost.today, 2.5);
  assert.equal(refreshed.providers[0].cost.sessionTokens, undefined);
  assert.equal(refreshed.providers[0].resetCredits, undefined);
});

test("discards slow enrichment when the dashboard account changes", async () => {
  let phase = "account-a";
  let resolveCost;
  let resolveUsage;
  const accountB = structuredClone(dashboardV1Snapshot);
  accountB.providers[0].identity.accountEmail = "account-b@example.invalid";
  const client = createCodexBarClient({
    token: "test-token",
    now: () => new Date("2026-07-19T08:31:05.000Z"),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/dashboard/v1/snapshot") {
        return Response.json(phase === "account-a" ? dashboardV1Snapshot : accountB);
      }
      if (phase === "account-a") return Response.json([]);
      if (phase === "switching") {
        return new Promise((resolve) => {
          if (parsed.pathname === "/cost") resolveCost = resolve;
          else resolveUsage = resolve;
        });
      }
      return Response.json([], { status: 503 });
    },
  });

  await client.refreshSnapshot();
  await settleBackgroundWork();
  phase = "switching";
  const switched = await client.refreshSnapshot();
  assert.equal(switched.providers[0].cost.sessionTokens, undefined);

  resolveCost(Response.json(detailedCodexCost));
  resolveUsage(Response.json(detailedCodexUsage));
  await settleBackgroundWork();
  phase = "account-b";
  const accountBAgain = await client.refreshSnapshot();

  assert.equal(accountBAgain.providers[0].cost.sessionTokens, undefined);
  assert.equal(accountBAgain.providers[0].resetCredits, undefined);
});

test("clears and blocks enrichment when a known dashboard identity disappears", async () => {
  let includeIdentity = true;
  let dashboardCalls = 0;
  let enrichmentCalls = 0;
  const client = createCodexBarClient({
    token: "test-token",
    now: () => new Date("2026-07-19T08:31:05.000Z"),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/dashboard/v1/snapshot") {
        dashboardCalls += 1;
        const dashboard = structuredClone(dashboardV1Snapshot);
        if (!includeIdentity) delete dashboard.providers[0].identity;
        return Response.json(dashboard);
      }
      enrichmentCalls += 1;
      return Response.json(parsed.pathname === "/cost" ? detailedCodexCost : detailedCodexUsage);
    },
  });

  await client.refreshSnapshot();
  await waitFor(() => dashboardCalls >= 2);
  const signedIn = await client.getSnapshot();
  assert.equal(signedIn.providers[0].cost.sessionTokens, 12_233_096);
  await settleBackgroundWork();

  includeIdentity = false;
  const signedOut = await client.refreshSnapshot();
  assert.equal(signedOut.providers[0].cost.sessionTokens, undefined);
  assert.equal(signedOut.providers[0].resetCredits, undefined);
  const callsAfterSignOut = enrichmentCalls;

  const stillSignedOut = await client.refreshSnapshot();
  assert.equal(enrichmentCalls, callsAfterSignOut);
  assert.equal(stillSignedOut.providers[0].cost.sessionTokens, undefined);
  assert.equal(stillSignedOut.providers[0].resetCredits, undefined);
});

test("keeps dashboard-404 legacy fallback quota-only across account changes", async () => {
  let account = "account-a@example.invalid";
  let optionalCalls = 0;
  const client = createCodexBarClient({
    token: "test-token",
    now: () => new Date("2026-07-19T08:31:05.000Z"),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/dashboard/v1/snapshot") {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      if (parsed.pathname === "/cost" || parsed.search === "?provider=codex") {
        optionalCalls += 1;
        return Response.json(parsed.pathname === "/cost" ? detailedCodexCost : detailedCodexUsage);
      }
      const usage = structuredClone(currentUsage);
      usage[0].account = account;
      return Response.json(usage);
    },
  });

  const accountA = await client.refreshSnapshot();
  assert.equal(accountA.providers[0].cost, undefined);
  await settleBackgroundWork();

  account = "account-b@example.invalid";
  const accountB = await client.refreshSnapshot();
  assert.equal(accountB.providers[0].cost, undefined);
  assert.equal(accountB.providers[0].resetCredits, undefined);
  assert.equal(optionalCalls, 0);
});

test("blocks cold-start enrichment when the first dashboard identity is missing", async () => {
  const missingIdentity = structuredClone(dashboardV1Snapshot);
  delete missingIdentity.providers[0].identity;
  const client = createCodexBarClient({
    token: "test-token",
    now: () => new Date("2026-07-19T08:31:05.000Z"),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/dashboard/v1/snapshot") {
        return Response.json(missingIdentity);
      }
      return Response.json(parsed.pathname === "/cost" ? detailedCodexCost : detailedCodexUsage);
    },
  });

  const snapshot = await client.refreshSnapshot();

  assert.equal(snapshot.providers[0].cost.today, 2.5);
  assert.equal(snapshot.providers[0].cost.sessionTokens, undefined);
  assert.equal(snapshot.providers[0].resetCredits, undefined);
});

test("starts cold enrichment only after the first dashboard identity resolves", async () => {
  let activeAccount = "account-a";
  let dashboardCalls = 0;
  let resolveFirstDashboard;
  const optionalAccounts = [];
  const accountB = structuredClone(dashboardV1Snapshot);
  accountB.providers[0].identity.accountEmail = "account-b@example.invalid";
  const client = createCodexBarClient({
    token: "test-token",
    now: () => new Date("2026-07-19T08:31:05.000Z"),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/dashboard/v1/snapshot") {
        dashboardCalls += 1;
        if (dashboardCalls === 1) {
          return new Promise((resolve) => {
            resolveFirstDashboard = resolve;
          });
        }
        return Response.json(accountB);
      }
      optionalAccounts.push(activeAccount);
      return Response.json(parsed.pathname === "/cost" ? detailedCodexCost : detailedCodexUsage);
    },
  });

  const firstRefresh = client.refreshSnapshot();
  await Promise.resolve();
  assert.deepEqual(optionalAccounts, []);

  activeAccount = "account-b";
  resolveFirstDashboard(Response.json(accountB));
  const quotaFirst = await firstRefresh;
  assert.equal(quotaFirst.providers[0].cost.sessionTokens, undefined);
  await waitFor(() => dashboardCalls >= 2);
  const enriched = await client.getSnapshot();

  assert.deepEqual(optionalAccounts.slice(0, 2), ["account-b", "account-b"]);
  assert.equal(enriched.providers[0].cost.sessionTokens, 12_233_096);
});

test("applies slow cold-start enrichment in one background follow-up", async () => {
  let resolveCost;
  let resolveUsage;
  let dashboardCalls = 0;
  const client = createCodexBarClient({
    token: "test-token",
    now: () => new Date("2026-07-19T08:31:05.000Z"),
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/dashboard/v1/snapshot") {
        dashboardCalls += 1;
        return Response.json(dashboardV1Snapshot);
      }
      return new Promise((resolve) => {
        if (parsed.pathname === "/cost") resolveCost = resolve;
        else resolveUsage = resolve;
      });
    },
  });

  const quotaFirst = await client.refreshSnapshot();
  assert.equal(quotaFirst.providers[0].cost.sessionTokens, undefined);

  resolveCost(Response.json(detailedCodexCost));
  resolveUsage(Response.json(detailedCodexUsage));
  await waitFor(() => dashboardCalls >= 2);
  const enriched = await client.getSnapshot();

  assert.equal(enriched.providers[0].cost.sessionTokens, 12_233_096);
  assert.equal(enriched.providers[0].resetCredits.available, 2);
});

test("bounds chunked upstream bodies and cancels the stream on overflow", async () => {
  let cancelled = false;
  let chunk = 0;
  const body = new ReadableStream({
    pull(controller) {
      chunk += 1;
      controller.enqueue(new TextEncoder().encode(chunk === 1 ? "123" : "456"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = createCodexBarClient({
    token: "test-token",
    maxResponseBytes: 4,
    fetchImpl: async (url) => new URL(url).pathname === "/dashboard/v1/snapshot"
      ? new Response(body, { headers: { "content-type": "application/json" } })
      : Response.json([]),
  });

  await assert.rejects(
    client.getSnapshot(),
    /response exceeded the size limit/,
  );
  assert.equal(cancelled, true);
});

test("aborts an active upstream refresh during gateway shutdown", async () => {
  let observedSignal;
  const client = createCodexBarClient({
    token: "test-token",
    fetchImpl: async (_url, options) => {
      observedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        });
      });
    },
  });

  const refresh = client.refreshSnapshot();
  client.close();

  await assert.rejects(refresh, /stopping/i);
  assert.equal(observedSignal.aborted, true);
});

test("preserves a body-stream timeout as a gateway timeout", async () => {
  const body = new ReadableStream({
    pull() {
      throw new DOMException("upstream body timed out", "TimeoutError");
    },
  });
  const client = createCodexBarClient({
    token: "test-token",
    fetchImpl: async (url) => new URL(url).pathname === "/dashboard/v1/snapshot"
      ? new Response(body, { headers: { "content-type": "application/json" } })
      : Response.json([]),
  });

  await assert.rejects(client.getSnapshot(), (error) => {
    assert.equal(error.status, 504);
    return true;
  });
});

function createDashboardSequenceClient({ responses, initialTime }) {
  const queue = [...responses];
  let currentTime = new Date(initialTime);
  const client = createCodexBarClient({
    token: "test-token",
    now: () => currentTime,
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/dashboard/v1/snapshot") {
        const response = queue.shift();
        assert(response, "dashboard response queue is exhausted");
        return Response.json(response);
      }
      // Keep optional enrichment pending so the quota sequence stays the only
      // variable exercised by these public-client behavior tests.
      return new Promise(() => {});
    },
  });
  return {
    client,
    setTime(value) {
      currentTime = new Date(value);
    },
  };
}

async function settleBackgroundWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for background work");
}
