import {
  normalizeCodexBarSnapshot,
  normalizeDashboardSnapshot,
} from "./normalize-snapshot.mjs";

const DEFAULT_CODEXBAR_ORIGIN = "http://127.0.0.1:8080";
const DASHBOARD_PATH = "/dashboard/v1/snapshot";
const GATEWAY_VERSION = "0.1.0";
const ENRICHMENT_MAX_AGE_MS = 5 * 60_000;
const PROVIDER_QUOTA_FALLBACK_MAX_AGE_MS = 6 * 60_000;
const TRANSIENT_PROVIDER_ERRORS = new Set([
  "timeout",
  "unavailable",
  "rate_limited",
  "provider_error",
]);

export class CodexBarUpstreamError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = "CodexBarUpstreamError";
    this.status = status;
  }
}

/**
 * @param {{
 *   token?: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 *   timeoutMs?: number,
 *   enrichmentTimeoutMs?: number,
 *   maxResponseBytes?: number,
 *   origin?: string,
 * }} options
 */
export function createCodexBarClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const token = normalizeToken(options.token);
  const timeoutMs = options.timeoutMs ?? 65_000;
  const enrichmentTimeoutMs = options.enrichmentTimeoutMs ?? Math.min(timeoutMs, 12_000);
  const maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
  const origin = options.origin ?? DEFAULT_CODEXBAR_ORIGIN;
  const shutdownController = new AbortController();
  let lastGoodSnapshot = null;
  let lastGoodEnrichment = emptyEnrichment();
  const lastGoodProviderQuotas = new Map();
  let lastDashboardIdentityKey = null;
  let dashboardIdentityInitialized = false;
  let enrichmentIdentityBlocked = false;
  let identityGeneration = 0;
  let enrichmentRevision = 0;
  let appliedEnrichmentRevision = 0;
  let enrichmentInFlight = null;
  let refreshInFlight = null;
  let closed = false;

  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation required");

  async function fetchFreshSnapshot({ collectEnrichment = true } = {}) {
    if (token) {
      if (collectEnrichment && dashboardIdentityInitialized) startEnrichment();
      const response = await fetchJSON(DASHBOARD_PATH, {
        origin,
        fetchImpl,
        timeoutMs,
        maxResponseBytes,
        authorization: `Bearer ${token}`,
        shutdownSignal: shutdownController.signal,
      });

      if (response.status === 200) {
        const providerIdentityKeys = dashboardProviderIdentityKeys(response.body);
        updateDashboardIdentity(response.body);
        if (collectEnrichment && !enrichmentIdentityBlocked) startEnrichment();
        const enrichment = currentEnrichment();
        const receivedAt = now();
        const snapshot = normalizeDashboardSnapshot(
          response.body,
          receivedAt.toISOString(),
          enrichment.cost,
          enrichment.usage,
        );
        appliedEnrichmentRevision = enrichmentRevision;
        return retainRecentProviderQuotas(snapshot, receivedAt, providerIdentityKeys);
      }
      if (response.status !== 404) {
        throw new CodexBarUpstreamError("CodexBar dashboard request failed", {
          status: response.status === 504 ? 504 : 502,
        });
      }
      blockEnrichmentWithoutIdentity();
    }

    // Keep the legacy fallback quota-only. An unfiltered /usage request honors
    // CodexBar's enabled-provider config; provider=all fans out to every
    // registered integration and can stall the critical dashboard path.
    const usageResponse = await fetchJSON("/usage", {
      origin,
      fetchImpl,
      timeoutMs,
      maxResponseBytes,
      shutdownSignal: shutdownController.signal,
    });

    if (usageResponse.status !== 200 || !Array.isArray(usageResponse.body)) {
      throw new CodexBarUpstreamError("CodexBar usage request failed", {
        status: usageResponse.status === 504 ? 504 : 502,
      });
    }

    const snapshot = normalizeCodexBarSnapshot({
      fetchedAt: now().toISOString(),
      health: null,
      usage: usageResponse.body,
      cost: [],
      mode: "legacy",
    });
    appliedEnrichmentRevision = enrichmentRevision;
    return snapshot;
  }

  function currentEnrichment() {
    if (enrichmentIdentityBlocked) return { cost: [], usage: [] };
    const currentMilliseconds = now().getTime();
    return {
      cost: freshEnrichmentBody(lastGoodEnrichment.cost, currentMilliseconds),
      usage: freshEnrichmentBody(lastGoodEnrichment.usage, currentMilliseconds),
    };
  }

  function updateDashboardIdentity(value) {
    const identityKey = dashboardIdentityKey(value);
    if (!identityKey) {
      blockEnrichmentWithoutIdentity();
      return;
    }
    if (!dashboardIdentityInitialized) {
      dashboardIdentityInitialized = true;
      lastDashboardIdentityKey = identityKey;
      return;
    }
    if (identityKey === lastDashboardIdentityKey) return;

    lastDashboardIdentityKey = identityKey;
    identityGeneration += 1;
    enrichmentRevision += 1;
    lastGoodEnrichment = emptyEnrichment();
    enrichmentIdentityBlocked = false;
  }

  function blockEnrichmentWithoutIdentity() {
    const shouldInvalidate = !dashboardIdentityInitialized
      || lastDashboardIdentityKey !== null
      || !enrichmentIdentityBlocked;
    dashboardIdentityInitialized = true;
    lastDashboardIdentityKey = null;
    enrichmentIdentityBlocked = true;
    if (!shouldInvalidate) return;
    identityGeneration += 1;
    enrichmentRevision += 1;
    lastGoodEnrichment = emptyEnrichment();
  }

  function startEnrichment() {
    if (closed || enrichmentInFlight || enrichmentIdentityBlocked) return;
    const requestGeneration = identityGeneration;
    const request = (path, key) => fetchJSON(path, {
      origin,
      fetchImpl,
      timeoutMs: enrichmentTimeoutMs,
      maxResponseBytes,
      shutdownSignal: shutdownController.signal,
    }).then((response) => {
      if (
        response.status === 200
        && Array.isArray(response.body)
        && requestGeneration === identityGeneration
        && !enrichmentIdentityBlocked
      ) {
        lastGoodEnrichment = {
          ...lastGoodEnrichment,
          [key]: { body: response.body, receivedAt: now().getTime() },
        };
        enrichmentRevision += 1;
        return true;
      }
      return false;
    }).catch(() => false);

    const operation = Promise.all([
      request("/cost?provider=codex", "cost"),
      request("/usage?provider=codex", "usage"),
    ]);
    enrichmentInFlight = operation;
    operation.then(finishEnrichment, clearEnrichment);

    function finishEnrichment(results) {
      clearEnrichment();
      if (requestGeneration !== identityGeneration) {
        startEnrichment();
        return;
      }
      if (
        results.some(Boolean)
        && !enrichmentIdentityBlocked
      ) {
        scheduleEnrichmentApply(requestGeneration, enrichmentRevision);
      }
    }

    function clearEnrichment() {
      if (enrichmentInFlight === operation) enrichmentInFlight = null;
    }
  }

  function scheduleEnrichmentApply(requestGeneration, revision) {
    Promise.resolve().then(async () => {
      while (refreshInFlight) {
        const activeRefresh = refreshInFlight;
        await activeRefresh.catch(() => undefined);
        if (refreshInFlight === activeRefresh) await Promise.resolve();
      }
      if (
        closed
        || enrichmentIdentityBlocked
        || requestGeneration !== identityGeneration
        || revision <= appliedEnrichmentRevision
      ) return;
      await startRefresh({ collectEnrichment: false });
    }).catch(() => undefined);
  }

  function startRefresh({ collectEnrichment = true } = {}) {
    if (closed) {
      return Promise.reject(new CodexBarUpstreamError("Quota Deck is stopping"));
    }
    if (refreshInFlight) return refreshInFlight;

    const operation = fetchFreshSnapshot({ collectEnrichment }).then((snapshot) => {
      lastGoodSnapshot = snapshot;
      return snapshot;
    });
    refreshInFlight = operation;
    operation.then(clearRefresh, clearRefresh);
    return operation;

    function clearRefresh() {
      if (refreshInFlight === operation) refreshInFlight = null;
    }
  }

  function refreshSnapshot() {
    return startRefresh().then((snapshot) => presentSnapshot(snapshot, now()));
  }

  return {
    async getSnapshot() {
      if (!lastGoodSnapshot) return refreshSnapshot();
      startRefresh().catch(() => undefined);
      return presentSnapshot(lastGoodSnapshot, now());
    },
    refreshSnapshot,
    close() {
      if (closed) return;
      closed = true;
      identityGeneration += 1;
      lastGoodEnrichment = emptyEnrichment();
      lastGoodProviderQuotas.clear();
      shutdownController.abort(new CodexBarUpstreamError("Quota Deck is stopping"));
    },
  };

  function retainRecentProviderQuotas(snapshot, receivedAt, providerIdentityKeys) {
    const receivedAtMs = receivedAt.getTime();
    const visibleProviderIDs = new Set();
    const providers = snapshot.providers.map((provider) => {
      visibleProviderIDs.add(provider.id);
      if (provider.state === "ok" && provider.windows.length > 0) {
        lastGoodProviderQuotas.set(provider.id, {
          identityKey: providerIdentityKeys.get(provider.id) ?? null,
          provider: structuredClone(provider),
          receivedAtMs,
        });
        return provider;
      }

      if (provider.error?.kind === "unauthorized") {
        lastGoodProviderQuotas.delete(provider.id);
        return provider;
      }

      const cached = lastGoodProviderQuotas.get(provider.id);
      const currentIdentityKey = providerIdentityKeys.get(provider.id) ?? null;
      if (
        cached?.identityKey
        && currentIdentityKey
        && cached.identityKey !== currentIdentityKey
      ) {
        lastGoodProviderQuotas.delete(provider.id);
        return provider;
      }
      const cacheAgeMs = cached ? receivedAtMs - cached.receivedAtMs : Number.POSITIVE_INFINITY;
      if (
        provider.state === "error"
        && TRANSIENT_PROVIDER_ERRORS.has(provider.error?.kind)
        && cached
        && cacheAgeMs >= 0
        && cacheAgeMs <= PROVIDER_QUOTA_FALLBACK_MAX_AGE_MS
      ) {
        return {
          ...provider,
          state: "partial",
          updatedAt: cached.provider.updatedAt,
          windows: structuredClone(cached.provider.windows),
        };
      }
      return provider;
    });

    for (const providerID of lastGoodProviderQuotas.keys()) {
      if (!visibleProviderIDs.has(providerID)) lastGoodProviderQuotas.delete(providerID);
    }
    return { ...snapshot, providers };
  }
}

function emptyEnrichment() {
  return {
    cost: { body: [], receivedAt: null },
    usage: { body: [], receivedAt: null },
  };
}

function freshEnrichmentBody(entry, currentMilliseconds) {
  if (!entry || !Array.isArray(entry.body) || !Number.isFinite(entry.receivedAt)) return [];
  const age = currentMilliseconds - entry.receivedAt;
  return age >= 0 && age <= ENRICHMENT_MAX_AGE_MS ? entry.body : [];
}

function dashboardIdentityKey(value) {
  return dashboardProviderIdentityKeys(value).get("codex") ?? null;
}

function dashboardProviderIdentityKeys(value) {
  const keys = new Map();
  if (!value || typeof value !== "object" || !Array.isArray(value.providers)) return keys;
  for (const provider of value.providers) {
    if (!provider || typeof provider !== "object" || typeof provider.id !== "string") continue;
    const identityKey = providerIdentityKey(provider.identity);
    if (identityKey) keys.set(provider.id.toLowerCase(), identityKey);
  }
  return keys;
}

function providerIdentityKey(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null;
  const entries = Object.entries(identity)
    .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

async function fetchJSON(
  path,
  {
    origin = DEFAULT_CODEXBAR_ORIGIN,
    fetchImpl,
    timeoutMs,
    maxResponseBytes,
    authorization,
    shutdownSignal,
  },
) {
  const headers = { Accept: "application/json" };
  if (authorization) headers.Authorization = authorization;

  let response;
  try {
    const signal = shutdownSignal
      ? AbortSignal.any([AbortSignal.timeout(timeoutMs), shutdownSignal])
      : AbortSignal.timeout(timeoutMs);
    response = await fetchImpl(`${origin}${path}`, {
      method: "GET",
      headers,
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (error instanceof CodexBarUpstreamError) throw error;
    throw new CodexBarUpstreamError("CodexBar is unavailable", {
      status: error?.name === "TimeoutError" ? 504 : 502,
      cause: error,
    });
  }

  if (response.status === 404) {
    await cancelBody(response);
    return { status: 404, body: null };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    await cancelBody(response);
    throw new CodexBarUpstreamError("CodexBar returned a non-JSON response");
  }

  const contentLength = response.headers.get("content-length");
  if (/^\d+$/u.test(contentLength ?? "") && Number(contentLength) > maxResponseBytes) {
    await cancelBody(response);
    throw new CodexBarUpstreamError("CodexBar response exceeded the size limit");
  }
  const text = await readBoundedText(response, maxResponseBytes);

  let body;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch (error) {
    throw new CodexBarUpstreamError("CodexBar returned invalid JSON", { cause: error });
  }

  return { status: response.status, body };
}

async function readBoundedText(response, maxResponseBytes) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new CodexBarUpstreamError("CodexBar response exceeded the size limit");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof CodexBarUpstreamError) throw error;
    await reader.cancel().catch(() => undefined);
    throw new CodexBarUpstreamError("CodexBar response could not be read", {
      status: error?.name === "TimeoutError" ? 504 : 502,
      cause: error,
    });
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function cancelBody(response) {
  if (!response.body || response.bodyUsed) return;
  await response.body.cancel().catch(() => undefined);
}

function presentSnapshot(snapshot, currentTime) {
  const staleAfterSeconds = Number.isFinite(snapshot?.staleAfterSeconds)
    ? Math.max(0, snapshot.staleAfterSeconds)
    : 180;
  const fetchedAt = new Date(snapshot?.fetchedAt ?? "");
  const validFetchedAt = !Number.isNaN(fetchedAt.getTime());
  const staleAt = validFetchedAt
    ? new Date(fetchedAt.getTime() + staleAfterSeconds * 1000)
    : null;
  const validCurrentTime = currentTime instanceof Date && !Number.isNaN(currentTime.getTime());

  return {
    ...snapshot,
    gateway: { version: GATEWAY_VERSION },
    freshness: {
      state:
        validFetchedAt && validCurrentTime
          ? (currentTime.getTime() > staleAt.getTime() ? "stale" : "fresh")
          : "unknown",
      staleAt: staleAt?.toISOString() ?? null,
    },
  };
}

function normalizeToken(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new TypeError("Dashboard token must be a string");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || /[\r\n\0]/u.test(trimmed)) {
    throw new TypeError("Dashboard token is invalid");
  }
  return trimmed;
}
