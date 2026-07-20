import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCodexBarSnapshot,
  normalizeDashboardSnapshot,
} from "../src/server/normalize-snapshot.mjs";
import {
  currentCost,
  currentHealth,
  currentUsage,
  dashboardV1Snapshot,
  detailedCodexCost,
  detailedCodexUsage,
  fetchedAt,
  mixedProviderUsage,
} from "./fixtures/codexbar-payloads.mjs";

test("normalizes current CodexBar usage without leaking account or project data", () => {
  const snapshot = normalizeCodexBarSnapshot({
    fetchedAt,
    health: currentHealth,
    usage: currentUsage,
    cost: currentCost,
    mode: "legacy",
  });

  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    fetchedAt,
    staleAfterSeconds: 180,
    source: {
      mode: "legacy",
      status: "ok",
      version: "0.43.0",
    },
    providers: [
      {
        id: "codex",
        label: "Codex",
        source: "web",
        state: "ok",
        updatedAt: "2026-07-19T08:29:30.000Z",
        windows: [
          {
            kind: "session",
            label: "5H",
            usedPercent: 64,
            remainingPercent: 36,
            windowMinutes: 300,
            resetsAt: "2026-07-19T10:00:00.000Z",
            synthetic: false,
            pace: {
              stage: "steady",
              deltaPercent: -8,
              expectedUsedPercent: 72,
              willLastToReset: true,
              etaSeconds: null,
            },
          },
          {
            kind: "weekly",
            label: "WEEK",
            usedPercent: 28,
            remainingPercent: 72,
            windowMinutes: 10080,
            resetsAt: "2026-07-25T00:00:00.000Z",
            synthetic: false,
          },
        ],
        cost: {
          currency: "USD",
          session: 1.25,
          last30Days: 42.5,
          updatedAt: "2026-07-19T08:29:00.000Z",
        },
      },
    ],
  });

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /private@example\.invalid/);
  assert.doesNotMatch(serialized, /Secret Studio/);
  assert.doesNotMatch(serialized, /private-project/);
  assert.doesNotMatch(serialized, /\/Users\/example/);
});

test("classifies Claude and z.ai windows and keeps provider errors non-sensitive", () => {
  const snapshot = normalizeCodexBarSnapshot({
    fetchedAt,
    health: currentHealth,
    usage: mixedProviderUsage,
    cost: [],
    mode: "legacy",
  });

  assert.deepEqual(
    snapshot.providers.map(({ id, label, state, windows, error }) => ({
      id,
      label,
      state,
      windows: windows.map(({ kind, label: windowLabel, synthetic }) => ({
        kind,
        label: windowLabel,
        synthetic,
      })),
      error,
    })),
    [
      {
        id: "claude",
        label: "Claude",
        state: "ok",
        windows: [
          { kind: "session", label: "5H", synthetic: true },
          { kind: "weekly", label: "WEEK", synthetic: false },
        ],
        error: undefined,
      },
      {
        id: "zai",
        label: "z.ai",
        state: "ok",
        windows: [
          { kind: "tokens", label: "TOKENS", synthetic: false },
          { kind: "mcp", label: "MCP", synthetic: false },
          { kind: "session", label: "5H", synthetic: false },
        ],
        error: undefined,
      },
      {
        id: "gemini",
        label: "Gemini",
        state: "error",
        windows: [],
        error: { code: "provider_error", kind: "unauthorized" },
      },
    ],
  );

  assert.doesNotMatch(JSON.stringify(snapshot), /private@example\.invalid/);
  assert.doesNotMatch(JSON.stringify(snapshot), /needs attention/);
});

test("marks legacy usage with an error as partial", () => {
  const snapshot = normalizeCodexBarSnapshot({
    fetchedAt,
    health: currentHealth,
    usage: [
      {
        ...currentUsage[0],
        error: {
          code: "provider_error",
          kind: "timeout",
          message: "Refresh timed out",
        },
      },
    ],
    cost: [],
    mode: "legacy",
  });

  assert.equal(snapshot.providers[0].state, "partial");
  assert.deepEqual(snapshot.providers[0].error, {
    code: "provider_error",
    kind: "timeout",
  });
});

test("marks a legacy error with no usable quota windows as error", () => {
  const snapshot = normalizeCodexBarSnapshot({
    fetchedAt,
    health: currentHealth,
    usage: [{
      provider: "codex",
      source: "oauth",
      usage: {},
      error: { kind: "timeout" },
    }],
    cost: [],
    mode: "legacy",
  });

  assert.equal(snapshot.providers[0].state, "error");
  assert.deepEqual(snapshot.providers[0].windows, []);
});

test("preserves dashboard partial state and filters disabled providers", () => {
  const dashboard = structuredClone(dashboardV1Snapshot);
  dashboard.providers[0].status.level = "partial";
  dashboard.providers.push({
    id: "disabled-private-provider",
    name: "Disabled Private Provider",
    enabled: false,
    status: { level: "ok" },
    windows: [{ kind: "weekly", label: "Week", usedPercent: 99 }],
  });

  const snapshot = normalizeDashboardSnapshot(dashboard, fetchedAt);

  assert.equal(snapshot.source.version, "0.45.1");
  assert.deepEqual(snapshot.providers.map(({ id, state }) => ({ id, state })), [
    { id: "codex", state: "partial" },
  ]);
});

test("adds privacy-safe Codex usage totals and daily history to a dashboard snapshot", () => {
  const snapshot = normalizeDashboardSnapshot(
    dashboardV1Snapshot,
    fetchedAt,
    detailedCodexCost,
    detailedCodexUsage,
  );

  assert.deepEqual(snapshot.providers[0].cost, {
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
  });
  assert.deepEqual(snapshot.providers[0].resetCredits, {
    available: 2,
    expiresAt: [
      "2026-07-31T20:00:30.000Z",
      "2026-08-12T17:36:39.000Z",
    ],
    updatedAt: "2026-07-19T08:30:55.000Z",
  });

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /private@example\.invalid/);
  assert.doesNotMatch(serialized, /Secret Project|private-project|private-credit-id/);
  assert.doesNotMatch(serialized, /Private reset credit/);
});

test("ignores malformed optional enrichment and forces USD-safe cost formatting", () => {
  const dashboard = normalizeDashboardSnapshot(
    dashboardV1Snapshot,
    fetchedAt,
    [{ provider: 123, currencyCode: "NOT-A-CURRENCY", sessionCostUSD: 999 }],
    [{ provider: { private: true }, usage: detailedCodexUsage[0].usage }],
  );
  assert.equal(dashboard.providers[0].cost.session, undefined);
  assert.equal(dashboard.providers[0].resetCredits, undefined);

  const legacy = normalizeCodexBarSnapshot({
    fetchedAt,
    health: currentHealth,
    usage: currentUsage,
    cost: [{
      ...currentCost[0],
      currencyCode: "NOT-A-CURRENCY",
    }],
    mode: "legacy",
  });
  assert.equal(legacy.providers[0].cost.currency, "USD");
});

test("maps arbitrary upstream error fields to privacy-safe generic values", () => {
  const sensitiveError = {
    code: "code-private@example.invalid-/Users/alice/Secret Project",
    kind: "kind-private@example.invalid-/Users/alice/Secret Project",
    message: "message-private@example.invalid-/Users/alice/Secret Project",
  };
  const legacy = normalizeCodexBarSnapshot({
    fetchedAt,
    health: currentHealth,
    usage: [
      {
        provider: "gemini",
        usage: null,
        error: sensitiveError,
      },
    ],
    cost: [],
    mode: "legacy",
  });
  const dashboard = structuredClone(dashboardV1Snapshot);
  dashboard.providers[0].windows = [];
  dashboard.providers[0].error = sensitiveError;
  const normalizedDashboard = normalizeDashboardSnapshot(dashboard, fetchedAt);

  for (const snapshot of [legacy, normalizedDashboard]) {
    assert.deepEqual(snapshot.providers[0].error, {
      code: "provider_error",
      kind: "provider_error",
    });
    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, /private@example\.invalid/);
    assert.doesNotMatch(serialized, /\/Users\/alice/);
    assert.doesNotMatch(serialized, /Secret Project/);
  }
});
