const DEFAULT_TIME_ZONE = "Asia/Bangkok";
const PROVIDER_PRIORITY = new Map([
  ["codex", 0],
  ["zai", 1],
  ["gemini", 2],
  ["openrouter", 3],
]);

/**
 * Build the complete, presentation-ready dashboard state from a safe snapshot.
 *
 * @param {unknown} snapshot
 * @param {{ now?: Date, timeZone?: string }} options
 */
export function buildDashboardViewModel(snapshot, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const providers = Array.isArray(snapshot?.providers)
    ? snapshot.providers.map((provider) => providerView(provider, { now, timeZone }))
    : [];

  providers.sort(compareProviderPreference);

  const quotaWindows = providers
    .filter((provider) => provider.state !== "error")
    .flatMap((provider) =>
      provider.windows
        .filter((window) => Number.isFinite(window.remainingPercent))
        .map((window) => ({ provider, window })),
    );
  quotaWindows.sort(
    (left, right) => left.window.remainingPercent - right.window.remainingPercent,
  );
  const tightest = quotaWindows[0] ?? null;
  const tightestScore = tightest?.window.remainingPercent ?? null;
  const bestProvider = providers
    .filter((provider) => Number.isFinite(provider.score))
    .sort((left, right) => right.score - left.score)[0];
  const stale = isSnapshotStale(snapshot, now);
  const state = dashboardState({ providers, stale });

  return {
    state,
    headline: dashboardHeadline({ state, tightestScore }),
    summary: tightest
      ? `${tightest.provider.label} / ${tightest.window.label} ตึงสุด, เหลือ ${formatPercent(tightest.window.remainingPercent)}%, ${tightest.window.reset.relative}`
      : "เปิด CodexBar บน Mac แล้วซิงก์ใหม่",
    tightestQuota: tightest
      ? {
          providerID: tightest.provider.id,
          providerLabel: tightest.provider.label,
          windowLabel: tightest.window.label,
          remainingPercent: tightest.window.remainingPercent,
          resetRelative: tightest.window.reset.relative,
        }
      : null,
    bestProvider: bestProvider
      ? {
          id: bestProvider.id,
          label: bestProvider.label,
          remainingPercent: bestProvider.score,
        }
      : null,
    providers,
    syncedAt: formatTimestamp(snapshot?.fetchedAt, timeZone),
    sourceVersion:
      typeof snapshot?.source?.version === "string" ? snapshot.source.version : null,
  };
}

function providerView(provider, context) {
  const windows = Array.isArray(provider?.windows)
    ? provider.windows
        .filter((window) => window?.synthetic !== true)
        .map((window) => windowView(window, context))
    : [];
  const remaining = windows
    .map((window) => window.remainingPercent)
    .filter(Number.isFinite);
  const score = remaining.length > 0 ? Math.min(...remaining) : null;
  const nextReset = windows
    .filter((window) => window.reset.iso)
    .sort((left, right) => new Date(left.reset.iso) - new Date(right.reset.iso))[0]?.reset ?? null;

  return {
    id: typeof provider?.id === "string" ? provider.id : "unknown",
    label: typeof provider?.label === "string" ? provider.label : "Unknown",
    source: typeof provider?.source === "string" ? provider.source : "unknown",
    state: provider?.state === "error" ? "error" : provider?.state ?? "ok",
    errorKind: typeof provider?.error?.kind === "string" ? provider.error.kind : null,
    statusLabel: providerStatusLabel(provider?.state, score),
    tone: providerTone(provider?.state, score),
    score,
    windows,
    updatedAt: formatTimestamp(provider?.updatedAt, context.timeZone),
    nextReset,
    resetCredits: resetCreditsView(provider?.resetCredits, context),
    cost: costView(provider?.cost),
  };
}

function resetCreditsView(value, context) {
  if (!Number.isFinite(value?.available)) return null;
  return {
    available: Math.max(0, Math.round(value.available)),
    updatedAt: typeof value.updatedAt === "string"
      ? formatTimestamp(value.updatedAt, context.timeZone)
      : null,
    expiries: Array.isArray(value.expiresAt)
      ? value.expiresAt.map((expiresAt) => formatReset(expiresAt, context)).filter((reset) => reset.iso)
      : [],
  };
}

function costView(value) {
  if (!value || typeof value !== "object") return null;
  const daily = Array.isArray(value.daily)
    ? value.daily
        .filter((day) =>
          typeof day?.date === "string"
          && /^\d{4}-\d{2}-\d{2}$/u.test(day.date)
          && (Number.isFinite(day.tokens) || Number.isFinite(day.cost)),
        )
        .map((day) => ({
          date: day.date,
          tokens: Number.isFinite(day.tokens) ? Math.max(0, day.tokens) : null,
          cost: Number.isFinite(day.cost) ? Math.max(0, day.cost) : null,
        }))
        .slice(-31)
    : [];
  const cost = {
    currency: typeof value.currency === "string" ? value.currency : "USD",
    today: finiteNonnegative(value.today),
    session: finiteNonnegative(value.session),
    last30Days: finiteNonnegative(value.last30Days),
    sessionTokens: finiteNonnegative(value.sessionTokens),
    last30DaysTokens: finiteNonnegative(value.last30DaysTokens),
    historyDays: finiteNonnegative(value.historyDays),
    topModel: typeof value.topModel === "string" ? value.topModel : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    daily,
  };
  const hasData = [
    cost.today,
    cost.session,
    cost.last30Days,
    cost.sessionTokens,
    cost.last30DaysTokens,
  ].some(Number.isFinite) || cost.daily.length > 0 || cost.topModel;
  return hasData ? cost : null;
}

function finiteNonnegative(value) {
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function windowView(window, { now, timeZone }) {
  const remainingPercent = Number.isFinite(window?.remainingPercent)
    ? clampPercent(window.remainingPercent)
    : null;

  return {
    kind: typeof window?.kind === "string" ? window.kind : "other",
    label: typeof window?.label === "string" ? window.label : "QUOTA",
    remainingPercent,
    remainingLabel: Number.isFinite(remainingPercent)
      ? `เหลือ ${formatPercent(remainingPercent)}%`
      : "ยังไม่มีข้อมูล",
    tone: quotaTone(remainingPercent),
    reset: formatReset(window?.resetsAt, { now, timeZone }),
  };
}

function formatReset(value, { now, timeZone }) {
  const resetAt = typeof value === "string" ? new Date(value) : null;
  if (!resetAt || Number.isNaN(resetAt.getTime())) {
    return { iso: null, absolute: "-", relative: "ยังไม่ทราบเวลารีเซ็ต" };
  }

  return {
    iso: resetAt.toISOString(),
    absolute: formatTimestamp(resetAt, timeZone),
    relative: formatRelativeDuration(resetAt.getTime() - now.getTime()),
  };
}

function formatRelativeDuration(milliseconds) {
  if (milliseconds <= 0) return "ถึงเวลารีเซ็ตแล้ว";
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (totalMinutes < 60) return `อีก ${totalMinutes} นาที`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `อีก ${hours} ชม. ${minutes} นาที` : `อีก ${hours} ชม.`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `อีก ${days} วัน ${remainingHours} ชม.` : `อีก ${days} วัน`;
}

function dashboardState({ providers, stale }) {
  if (providers.length === 0) return "empty";
  if (stale) return "stale";
  if (providers.every((provider) => provider.state === "error")) return "error";
  return "live";
}

function dashboardHeadline({ state, tightestScore }) {
  if (state === "stale") return "ข้อมูลอาจเก่า";
  if (state === "empty") return "ยังไม่มีข้อมูลโควตา";
  if (state === "error") return "ยังอ่านโควตาไม่ได้";
  if (Number.isFinite(tightestScore) && tightestScore <= 0) return "มีโควตาหมดแล้ว";
  if (Number.isFinite(tightestScore) && tightestScore <= 20) return "โควตาเริ่มตึง";
  return "พร้อมลุย";
}

function providerStatusLabel(state, score) {
  if (state === "error") return "อ่านไม่ได้";
  if (state === "partial") return "ข้อมูลไม่ครบ";
  if (!Number.isFinite(score)) return "ยังไม่มีข้อมูล";
  if (score <= 0) return "หมด";
  if (score <= 20) return "จำกัด";
  return "พร้อม";
}

function providerTone(state, score) {
  if (state === "error") return "error";
  if (state === "partial") return "warning";
  return quotaTone(score);
}

function quotaTone(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value <= 0) return "error";
  if (value <= 20) return "warning";
  return "ready";
}

function compareProviderUrgency(left, right) {
  if (left.state === "error" && right.state !== "error") return 1;
  if (right.state === "error" && left.state !== "error") return -1;
  if (!Number.isFinite(left.score) && Number.isFinite(right.score)) return 1;
  if (!Number.isFinite(right.score) && Number.isFinite(left.score)) return -1;
  if (Number.isFinite(left.score) && Number.isFinite(right.score)) return left.score - right.score;
  return left.label.localeCompare(right.label, "th");
}

function compareProviderPreference(left, right) {
  const leftPriority = PROVIDER_PRIORITY.get(left.id) ?? Number.POSITIVE_INFINITY;
  const rightPriority = PROVIDER_PRIORITY.get(right.id) ?? Number.POSITIVE_INFINITY;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return compareProviderUrgency(left, right);
}

function isSnapshotStale(snapshot, now) {
  if (snapshot?.freshness?.state === "stale") return true;
  if (snapshot?.freshness?.state === "fresh") {
    const authoritativeStaleAt = new Date(snapshot.freshness.staleAt ?? "");
    if (!Number.isNaN(authoritativeStaleAt.getTime())) {
      return now.getTime() > authoritativeStaleAt.getTime();
    }
  }
  const fetchedAt = new Date(snapshot?.fetchedAt ?? "");
  if (Number.isNaN(fetchedAt.getTime())) return true;
  const staleAfterSeconds = Number.isFinite(snapshot?.staleAfterSeconds)
    ? Math.max(0, snapshot.staleAfterSeconds)
    : 180;
  return now.getTime() - fetchedAt.getTime() > staleAfterSeconds * 1000;
}

function formatTimestamp(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value ?? "");
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH-u-nu-latn", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
}

function clampPercent(value) {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function formatPercent(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
