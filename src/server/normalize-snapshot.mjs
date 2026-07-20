const PROVIDER_LABELS = {
  codex: "Codex",
  claude: "Claude",
  zai: "z.ai",
};

const POSITIONAL_WINDOW_KINDS = {
  primary: "session",
  secondary: "weekly",
  tertiary: "other",
};

const ZAI_WINDOW_KINDS = {
  primary: "tokens",
  secondary: "mcp",
  tertiary: "session",
};

const SAFE_ERROR_KINDS = new Map([
  ["unauthorized", "unauthorized"],
  ["authentication", "unauthorized"],
  ["rate_limit", "rate_limited"],
  ["rate_limited", "rate_limited"],
  ["timeout", "timeout"],
  ["timed_out", "timeout"],
  ["unavailable", "unavailable"],
  ["service_unavailable", "unavailable"],
  ["provider_error", "provider_error"],
  ["upstream", "provider_error"],
]);

const HTTP_ERROR_KINDS = new Map([
  [401, "unauthorized"],
  [403, "unauthorized"],
  [408, "timeout"],
  [429, "rate_limited"],
  [502, "unavailable"],
  [503, "unavailable"],
  [504, "timeout"],
]);

/**
 * Project CodexBar payloads into the stable, privacy-safe Quota Deck interface.
 *
 * @param {{
 *   fetchedAt: string,
 *   health?: unknown,
 *   usage?: unknown,
 *   cost?: unknown,
 *   mode?: string,
 * }} input
 */
export function normalizeCodexBarSnapshot(input) {
  const usagePayloads = Array.isArray(input.usage) ? input.usage : [];
  const costPayloads = Array.isArray(input.cost) ? input.cost : [];

  return {
    schemaVersion: 1,
    fetchedAt: input.fetchedAt,
    staleAfterSeconds: 180,
    source: {
      mode: input.mode ?? "legacy",
      status:
        (isRecord(input.health) && input.health.status === "ok") || Array.isArray(input.usage)
          ? "ok"
          : "unknown",
      version:
        isRecord(input.health) && typeof input.health.version === "string"
          ? input.health.version
          : null,
    },
    providers: usagePayloads
      .filter((payload) => isRecord(payload) && typeof payload.provider === "string")
      .map((payload) => normalizeProvider(payload, costPayloads, input.fetchedAt)),
  };
}

/**
 * Sanitize CodexBar's versioned dashboard payload into Quota Deck's interface.
 * CodexBar redacts email local-parts, but Quota Deck drops identity entirely.
 *
 * @param {unknown} value
 * @param {string} fallbackFetchedAt
 * @param {unknown} costPayloads
 * @param {unknown} usagePayloads
 */
export function normalizeDashboardSnapshot(
  value,
  fallbackFetchedAt,
  costPayloads = [],
  usagePayloads = [],
) {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.providers)) {
    throw new TypeError("Unsupported CodexBar dashboard snapshot");
  }

  const host = isRecord(value.host) ? value.host : {};
  return {
    schemaVersion: 1,
    fetchedAt: typeof value.generatedAt === "string" ? value.generatedAt : fallbackFetchedAt,
    staleAfterSeconds: Number.isFinite(value.staleAfterSeconds)
      ? Math.min(3600, Math.max(30, Math.round(value.staleAfterSeconds)))
      : 180,
    source: {
      mode: "dashboard",
      status: "ok",
      version: typeof host.codexBarVersion === "string" ? host.codexBarVersion : null,
    },
    providers: value.providers
      .filter(
        (provider) =>
          isRecord(provider) &&
          typeof provider.id === "string" &&
          provider.enabled !== false,
      )
      .map((provider) => normalizeDashboardProvider(
        provider,
        costPayloads,
        usagePayloads,
        fallbackFetchedAt,
      )),
  };
}

function normalizeDashboardProvider(payload, costPayloads, usagePayloads, referenceTime) {
  const id = payload.id.toLowerCase();
  const windows = (Array.isArray(payload.windows) ? payload.windows : [])
    .map((window) => normalizeDashboardWindow(id, window))
    .filter(Boolean);
  const provider = {
    id,
    label:
      typeof payload.name === "string" ? payload.name : PROVIDER_LABELS[id] ?? titleCase(id),
    source: typeof payload.source === "string" ? payload.source : "unknown",
    state: dashboardProviderState(payload, windows),
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
    windows,
  };

  const detailedCost = Array.isArray(costPayloads)
    ? costPayloads.find(
        (entry) =>
          isRecord(entry)
          && typeof entry.provider === "string"
          && entry.provider.toLowerCase() === id,
      )
    : null;
  const cost = normalizeDashboardCost(payload.cost, provider.updatedAt, detailedCost);
  if (cost) provider.cost = cost;
  const detailedUsage = Array.isArray(usagePayloads)
    ? usagePayloads.find(
        (entry) =>
          isRecord(entry)
          && typeof entry.provider === "string"
          && entry.provider.toLowerCase() === id,
      )
    : null;
  const resetCredits = normalizeResetCredits(
    isRecord(detailedUsage?.usage) ? detailedUsage.usage.codexResetCredits : null,
    referenceTime,
  );
  if (resetCredits) provider.resetCredits = resetCredits;
  const error = normalizeError(payload.error);
  if (error) provider.error = error;

  return provider;
}

function dashboardProviderState(payload, windows) {
  const status = isRecord(payload.status) ? payload.status : {};
  if (status.level === "partial") return "partial";
  if (payload.error) return windows.length > 0 ? "partial" : "error";
  return status.level === "error" ? "error" : "ok";
}

function normalizeDashboardWindow(providerID, value) {
  if (!isRecord(value)) return null;
  const usedPercent = finiteField(value, "usedPercent", "used_percent");
  if (!Number.isFinite(usedPercent)) return null;
  const label = typeof value.label === "string" ? value.label.toUpperCase() : "QUOTA";
  const kind = dashboardWindowKind(providerID, value.kind, label);
  const normalizedUsedPercent = clampPercent(usedPercent);

  return {
    kind,
    label,
    usedPercent: normalizedUsedPercent,
    remainingPercent: Number.isFinite(value.remainingPercent)
      ? clampPercent(value.remainingPercent)
      : roundPercent(100 - normalizedUsedPercent),
    windowMinutes: null,
    resetsAt: typeof value.resetAt === "string"
      ? value.resetAt
      : typeof value.reset_at === "string" ? value.reset_at : null,
    synthetic: false,
  };
}

function dashboardWindowKind(providerID, upstreamKind, label) {
  if (providerID === "zai") {
    if (label.includes("TOKEN")) return "tokens";
    if (label.includes("MCP")) return "mcp";
    if (label.includes("HOUR") || label.includes("5H")) return "session";
  }
  if (["session", "weekly", "monthly", "tertiary"].includes(upstreamKind)) {
    return upstreamKind;
  }
  return typeof upstreamKind === "string" ? upstreamKind : "other";
}

function normalizeDashboardCost(value, updatedAt, detailedValue) {
  const dashboardCost = isRecord(value) ? value : {};
  const detailedCost = normalizeCost(detailedValue);
  if (
    !Number.isFinite(dashboardCost.todayUSD)
    && !Number.isFinite(dashboardCost.last30DaysUSD)
    && !detailedCost
  ) return null;

  const cost = {
    currency: "USD",
    today: finiteOrNull(dashboardCost.todayUSD),
    last30Days: Number.isFinite(dashboardCost.last30DaysUSD)
      ? dashboardCost.last30DaysUSD
      : detailedCost?.last30Days ?? null,
    updatedAt: detailedCost?.updatedAt ?? updatedAt,
  };
  for (const key of [
    "session",
    "sessionTokens",
    "last30DaysTokens",
    "historyDays",
    "topModel",
    "daily",
  ]) {
    if (detailedCost?.[key] != null) cost[key] = detailedCost[key];
  }
  return cost;
}

function normalizeProvider(payload, costPayloads, referenceTime) {
  const id = payload.provider.toLowerCase();
  const usage = isRecord(payload.usage) ? payload.usage : {};
  const pace = isRecord(payload.pace) ? payload.pace : {};
  const matchingCost = costPayloads.find(
    (entry) =>
      isRecord(entry)
      && typeof entry.provider === "string"
      && entry.provider.toLowerCase() === id,
  );
  const windows = ["primary", "secondary", "tertiary"]
    .map((slot) =>
      normalizeWindow(usage[slot], classifyWindow(id, slot, usage[slot]), pace[slot]),
    )
    .filter(Boolean);
  const extraWindows = Array.isArray(usage.extra_rate_windows)
    ? usage.extra_rate_windows
        .map((entry) => normalizeExtraWindow(id, entry))
        .filter(Boolean)
    : [];

  const provider = {
    id,
    label: PROVIDER_LABELS[id] ?? titleCase(id),
    source: typeof payload.source === "string" ? payload.source : "unknown",
    state: payload.error ? (windows.length > 0 ? "partial" : "error") : "ok",
    updatedAt: typeof usage.updatedAt === "string"
      ? usage.updatedAt
      : typeof usage.updated_at === "string" ? usage.updated_at : null,
    windows: [...windows, ...extraWindows],
  };

  const error = normalizeError(payload.error);
  if (error) provider.error = error;

  const cost = normalizeCost(matchingCost);
  if (cost) provider.cost = cost;
  const resetCredits = normalizeResetCredits(usage.codexResetCredits, referenceTime);
  if (resetCredits) provider.resetCredits = resetCredits;

  return provider;
}

function normalizeWindow(value, kind, paceValue) {
  if (!isRecord(value)) return null;
  const usedPercent = finiteField(value, "usedPercent", "used_percent");
  if (!Number.isFinite(usedPercent)) return null;
  const windowMinutes = finiteField(value, "windowMinutes", "window_minutes");
  const resetsAt = stringField(value, "resetsAt", "resets_at");

  const normalizedUsedPercent = clampPercent(usedPercent);
  const window = {
    kind,
    label: windowLabel(windowMinutes, kind),
    usedPercent: normalizedUsedPercent,
    remainingPercent: roundPercent(100 - normalizedUsedPercent),
    windowMinutes: Number.isFinite(windowMinutes) ? windowMinutes : null,
    resetsAt,
    synthetic: value.isSyntheticPlaceholder === true,
  };

  const pace = normalizePace(paceValue);
  if (pace) window.pace = pace;

  return window;
}

function normalizeExtraWindow(providerID, entry) {
  if (!isRecord(entry) || !isRecord(entry.window)) return null;
  const value = entry.window;
  const windowMinutes = finiteField(value, "windowMinutes", "window_minutes");
  if (!Number.isFinite(windowMinutes)) return null;
  const kind = classifyWindow(providerID, "tertiary", value);
  const window = normalizeWindow(value, kind, null);
  if (!window) return null;
  const title = stringField(entry, "title", "name");
  if (title) window.label = title.toUpperCase();
  return window;
}

function normalizePace(value) {
  if (!isRecord(value) || typeof value.stage !== "string") return null;

  return {
    stage: value.stage,
    deltaPercent: finiteOrNull(value.deltaPercent),
    expectedUsedPercent: finiteOrNull(value.expectedUsedPercent),
    willLastToReset: value.willLastToReset === true,
    etaSeconds: finiteOrNull(value.etaSeconds),
  };
}

function normalizeCost(value) {
  if (!isRecord(value)) return null;
  const daily = normalizeDailyCost(value.daily);
  const cost = {
    currency: "USD",
    session: finiteOrNull(value.sessionCostUSD),
    last30Days: finiteOrNull(value.last30DaysCostUSD),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
  const latestDailyTokens = daily.at(-1)?.tokens;
  if (Number.isFinite(latestDailyTokens)) cost.sessionTokens = latestDailyTokens;
  else if (Number.isFinite(value.sessionTokens)) {
    cost.sessionTokens = Math.max(0, value.sessionTokens);
  }
  if (Number.isFinite(value.last30DaysTokens)) {
    cost.last30DaysTokens = Math.max(0, value.last30DaysTokens);
  }
  if (Number.isFinite(value.historyDays)) {
    cost.historyDays = Math.min(31, Math.max(0, Math.round(value.historyDays)));
  }
  const topModel = topModelFromDaily(value.daily);
  if (topModel) cost.topModel = topModel;
  if (daily.length > 0) cost.daily = daily;
  return cost;
}

function normalizeResetCredits(value, referenceTime) {
  if (!isRecord(value)) return null;
  const reference = new Date(referenceTime ?? "");
  const referenceMilliseconds = Number.isNaN(reference.getTime())
    ? Date.now()
    : reference.getTime();
  const credits = Array.isArray(value.credits) ? value.credits : null;
  const expiresAt = credits
    ? credits
        .filter((credit) => isRecord(credit) && credit.status === "available")
        .map((credit) => new Date(credit.expires_at ?? ""))
        .filter((date) => !Number.isNaN(date.getTime()) && date.getTime() > referenceMilliseconds)
        .sort((left, right) => left - right)
        .map((date) => date.toISOString())
    : [];
  const available = credits
    ? expiresAt.length
    : Number.isFinite(value.availableCount)
      ? Math.max(0, Math.round(value.availableCount))
      : null;
  if (!Number.isFinite(available)) return null;
  return {
    available,
    expiresAt,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

function normalizeDailyCost(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((day) =>
      isRecord(day)
      && typeof day.date === "string"
      && /^\d{4}-\d{2}-\d{2}$/u.test(day.date)
      && (Number.isFinite(day.totalTokens) || Number.isFinite(day.totalCost)),
    )
    .map((day) => ({
      date: day.date,
      tokens: Number.isFinite(day.totalTokens) ? Math.max(0, day.totalTokens) : null,
      cost: Number.isFinite(day.totalCost) ? Math.max(0, day.totalCost) : null,
    }))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-31);
}

function topModelFromDaily(value) {
  if (!Array.isArray(value)) return null;
  const totals = new Map();
  for (const day of value) {
    if (!isRecord(day) || !Array.isArray(day.modelBreakdowns)) continue;
    for (const model of day.modelBreakdowns) {
      if (!isRecord(model) || !isSafeModelName(model.modelName)) continue;
      const current = totals.get(model.modelName) ?? { cost: 0, tokens: 0 };
      current.cost += Number.isFinite(model.cost) ? Math.max(0, model.cost) : 0;
      current.tokens += Number.isFinite(model.totalTokens) ? Math.max(0, model.totalTokens) : 0;
      totals.set(model.modelName, current);
    }
  }
  return [...totals.entries()].sort((left, right) =>
    right[1].cost - left[1].cost
    || right[1].tokens - left[1].tokens
    || left[0].localeCompare(right[0]),
  )[0]?.[0] ?? null;
}

function isSafeModelName(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 100
    && /^[a-z0-9][a-z0-9._:/-]*$/iu.test(value);
}

function normalizeError(value) {
  if (!isRecord(value)) return null;

  return {
    code: "provider_error",
    kind: safeErrorKind(value),
  };
}

function safeErrorKind(value) {
  if (Number.isInteger(value.code) && HTTP_ERROR_KINDS.has(value.code)) {
    return HTTP_ERROR_KINDS.get(value.code);
  }

  for (const candidate of [value.kind, value.code]) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim().toLowerCase();
    if (SAFE_ERROR_KINDS.has(normalized)) return SAFE_ERROR_KINDS.get(normalized);
  }

  return "provider_error";
}

function classifyWindow(providerID, slot, value) {
  if (providerID === "zai") return ZAI_WINDOW_KINDS[slot];
  const windowMinutes = isRecord(value)
    ? finiteField(value, "windowMinutes", "window_minutes")
    : null;
  if (Number.isFinite(windowMinutes)) {
    if (windowMinutes <= 24 * 60) return "session";
    if (windowMinutes >= 6 * 24 * 60 && windowMinutes <= 8 * 24 * 60) {
      return "weekly";
    }
    if (windowMinutes >= 28 * 24 * 60) return "monthly";
  }
  return POSITIONAL_WINDOW_KINDS[slot];
}

function windowLabel(windowMinutes, kind) {
  if (kind === "tokens") return "TOKENS";
  if (kind === "mcp") return "MCP";
  if (windowMinutes === 300) return "5H";
  if (windowMinutes === 10080) return "WEEK";
  if (windowMinutes === 43200) return "MONTH";
  return kind.toUpperCase();
}

function clampPercent(value) {
  return roundPercent(Math.min(100, Math.max(0, value)));
}

function roundPercent(value) {
  return Math.round(value * 10) / 10;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function finiteField(value, camelName, snakeName) {
  if (!isRecord(value)) return null;
  if (Number.isFinite(value[camelName])) return value[camelName];
  return Number.isFinite(value[snakeName]) ? value[snakeName] : null;
}

function stringField(value, camelName, snakeName) {
  if (!isRecord(value)) return null;
  if (typeof value[camelName] === "string") return value[camelName];
  return typeof value[snakeName] === "string" ? value[snakeName] : null;
}

function titleCase(value) {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
