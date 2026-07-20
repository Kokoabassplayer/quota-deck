import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboardViewModel } from "../public/view-model.mjs";
import { normalizeCodexBarSnapshot } from "../src/server/normalize-snapshot.mjs";
import {
  currentHealth,
  fetchedAt,
  mixedProviderUsage,
} from "./fixtures/codexbar-payloads.mjs";

test("turns normalized quota data into a Thai departure board", () => {
  const snapshot = normalizeCodexBarSnapshot({
    fetchedAt,
    health: currentHealth,
    usage: mixedProviderUsage,
    cost: [],
    mode: "legacy",
  });

  const view = buildDashboardViewModel(snapshot, {
    now: new Date("2026-07-19T08:30:00.000Z"),
    timeZone: "Asia/Bangkok",
  });

  assert.equal(view.state, "live");
  assert.equal(view.headline, "โควตาเริ่มตึง");
  assert.deepEqual(view.bestProvider, {
    id: "zai",
    label: "z.ai",
    remainingPercent: 20,
  });
  assert.deepEqual(view.tightestQuota, {
    providerID: "claude",
    providerLabel: "Claude",
    windowLabel: "WEEK",
    remainingPercent: 13,
    resetRelative: "อีก 2 วัน 15 ชม.",
  });
  assert.equal(view.summary, "Claude / WEEK ตึงสุด, เหลือ 13%, อีก 2 วัน 15 ชม.");
  assert.deepEqual(
    view.providers.map(({ id }) => id),
    ["zai", "gemini", "claude"],
  );
  assert.equal(view.providers[2].statusLabel, "จำกัด");
  assert.equal(view.providers[2].windows.length, 1, "synthetic session is hidden");
  assert.equal(view.providers[2].windows[0].remainingLabel, "เหลือ 13%");
  assert.equal(view.providers[0].windows[2].reset.relative, "อีก 2 ชม. 30 นาที");
  assert.equal(view.providers[0].windows[2].reset.absolute, "18:00");
  assert.equal(view.providers[1].statusLabel, "อ่านไม่ได้");
});

test("orders the provider board by the preferred provider sequence", () => {
  const providers = [
    ["openrouter", "OpenRouter", 10],
    ["gemini", "Gemini", 20],
    ["zai", "z.ai", 30],
    ["codex", "Codex", 40],
  ].map(([id, label, remainingPercent]) => ({
    id,
    label,
    source: "api",
    state: "ok",
    windows: [{ kind: "weekly", label: "WEEK", remainingPercent, resetsAt: null }],
  }));

  const view = buildDashboardViewModel({
    schemaVersion: 1,
    fetchedAt,
    freshness: { state: "fresh", staleAt: "2026-07-20T08:31:05.000Z" },
    source: { mode: "dashboard", status: "ok", version: "0.45.1" },
    providers,
  }, {
    now: new Date("2026-07-19T08:30:00.000Z"),
  });

  assert.deepEqual(
    view.providers.map(({ id }) => id),
    ["codex", "zai", "gemini", "openrouter"],
  );
});

test("prepares real provider detail metrics without inventing history", () => {
  const view = buildDashboardViewModel({
    schemaVersion: 1,
    fetchedAt,
    freshness: { state: "fresh", staleAt: "2026-07-20T08:31:05.000Z" },
    source: { mode: "dashboard", status: "ok", version: "0.45.1" },
    providers: [{
      id: "codex",
      label: "Codex",
      source: "oauth",
      state: "ok",
      updatedAt: "2026-07-19T08:30:00.000Z",
      windows: [{
        kind: "weekly",
        label: "WEEKLY",
        remainingPercent: 12.5,
        resetsAt: "2026-07-20T08:30:00.000Z",
      }],
      resetCredits: {
        available: 2,
        expiresAt: ["2026-07-31T20:00:30.000Z"],
      },
      cost: {
        currency: "USD",
        today: 8.25,
        last30Days: 1_853.69,
        sessionTokens: 12_233_096,
        last30DaysTokens: 2_750_469_967,
        topModel: "gpt-5.6-sol",
        daily: [
          { date: "2026-07-18", tokens: 18_000_000, cost: 11.25 },
          { date: "2026-07-19", tokens: 12_233_096, cost: 9.74 },
        ],
      },
    }],
  }, {
    now: new Date("2026-07-19T08:30:00.000Z"),
    timeZone: "Asia/Bangkok",
  });

  const [provider] = view.providers;
  assert.equal(provider.updatedAt, "15:30");
  assert.equal(provider.nextReset.relative, "อีก 1 วัน");
  assert.equal(provider.resetCredits.available, 2);
  assert.equal(provider.resetCredits.expiries[0].absolute, "03:00");
  assert.equal(provider.cost.topModel, "gpt-5.6-sol");
  assert.deepEqual(provider.cost.daily.map(({ tokens }) => tokens), [18_000_000, 12_233_096]);
});

test("marks old snapshots stale without turning missing quota into zero", () => {
  const view = buildDashboardViewModel(
    {
      schemaVersion: 1,
      fetchedAt,
      staleAfterSeconds: 180,
      source: { mode: "legacy", status: "ok", version: "0.43.0" },
      providers: [
        {
          id: "claude",
          label: "Claude",
          source: "web",
          state: "ok",
          updatedAt: fetchedAt,
          windows: [],
        },
      ],
    },
    {
      now: new Date("2026-07-19T08:40:00.000Z"),
      timeZone: "Asia/Bangkok",
    },
  );

  assert.equal(view.state, "stale");
  assert.equal(view.headline, "ข้อมูลอาจเก่า");
  assert.equal(view.providers[0].statusLabel, "ยังไม่มีข้อมูล");
  assert.equal(view.providers[0].score, null);
  assert.equal(view.bestProvider, null);
});

test("shows a partial provider as an explicit Thai warning even when its quota is healthy", () => {
  const view = buildDashboardViewModel(
    {
      schemaVersion: 1,
      fetchedAt,
      staleAfterSeconds: 180,
      source: { mode: "dashboard", status: "ok", version: "0.45.1" },
      providers: [
        {
          id: "codex",
          label: "Codex",
          source: "oauth",
          state: "partial",
          updatedAt: fetchedAt,
          windows: [
            {
              kind: "session",
              label: "5H",
              remainingPercent: 75,
              resetsAt: "2026-07-19T10:00:00.000Z",
            },
          ],
        },
      ],
    },
    {
      now: new Date("2026-07-19T08:30:00.000Z"),
      timeZone: "Asia/Bangkok",
    },
  );

  assert.equal(view.providers[0].state, "partial");
  assert.equal(view.providers[0].statusLabel, "ข้อมูลไม่ครบ");
  assert.equal(view.providers[0].tone, "warning");
});

test("trusts gateway freshness and excludes failed providers from the tightest active quota", () => {
  const snapshot = {
    schemaVersion: 1,
    fetchedAt: "2026-07-19T08:00:00.000Z",
    staleAfterSeconds: 60,
    freshness: { state: "fresh", staleAt: "2026-07-21T08:01:00.000Z" },
    source: { mode: "dashboard", status: "ok", version: "0.45.1" },
    providers: [
      {
        id: "failed",
        label: "Failed",
        source: "api",
        state: "error",
        windows: [{ label: "WEEK", remainingPercent: 1, resetsAt: null }],
      },
      {
        id: "healthy",
        label: "Healthy",
        source: "api",
        state: "ok",
        windows: [{ label: "WEEK", remainingPercent: 50, resetsAt: null }],
      },
    ],
  };

  const fresh = buildDashboardViewModel(snapshot, {
    now: new Date("2026-07-20T08:00:00.000Z"),
  });
  const stale = buildDashboardViewModel({
    ...snapshot,
    freshness: { ...snapshot.freshness, state: "stale" },
  }, {
    now: new Date("2026-07-19T08:00:01.000Z"),
  });
  const expired = buildDashboardViewModel(snapshot, {
    now: new Date("2026-07-22T08:00:00.000Z"),
  });

  assert.equal(fresh.state, "live");
  assert.equal(fresh.tightestQuota.providerID, "healthy");
  assert.equal(stale.state, "stale");
  assert.equal(expired.state, "stale");
});
