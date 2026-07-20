import { buildDashboardViewModel } from "./view-model.mjs";
import {
  applyStaticLocale,
  browserTimeZone,
  detectBrowserLocale,
  localizeText,
  persistLocale,
} from "./i18n.mjs";

const OVERVIEW_PROVIDER_ID = "overview";
const LOCALE = detectBrowserLocale();
const TIME_ZONE = browserTimeZone();
applyStaticLocale(document, LOCALE);

const elements = {
  announcer: byID("sync-announcer"),
  board: byID("provider-board"),
  count: byID("provider-count"),
  list: byID("provider-list"),
  languageButton: document.getElementById("language-button"),
  providerSwitcher: byID("provider-switcher"),
  providerTabs: byID("provider-tabs"),
  refreshButton: byID("refresh-button"),
  refreshLabel: byID("refresh-label"),
  resetBoard: byID("reset-board"),
  resetList: byID("reset-list"),
  sourceVersion: byID("source-version"),
  syncLabel: byID("sync-label"),
};

if (elements.languageButton) {
  elements.languageButton.textContent = LOCALE === "th" ? "EN" : "ไทย";
  elements.languageButton.setAttribute("aria-label", LOCALE === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย");
}

const appState = {
  selectedProviderID: OVERVIEW_PROVIDER_ID,
  snapshot: null,
  syncing: false,
  view: null,
};

elements.refreshButton.addEventListener("click", () => sync({ announce: true }));
elements.languageButton?.addEventListener("click", () => {
  persistLocale(LOCALE === "th" ? "en" : "th");
  window.location.reload();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") sync({ announce: false });
});
window.addEventListener("online", () => sync({ announce: true }));
window.addEventListener("offline", () => renderConnectionFailure("ออฟไลน์ · ใช้ข้อมูลล่าสุดบนหน้าจอ"));

setInterval(() => {
  if (appState.snapshot && document.visibilityState === "visible") renderSnapshot(appState.snapshot);
}, 60_000);
setInterval(() => {
  if (document.visibilityState === "visible") sync({ announce: false });
}, 60_000);

registerServiceWorker();
sync({ announce: false });

async function sync({ announce }) {
  if (appState.syncing) return;
  appState.syncing = true;
  setSyncing(true);

  try {
    const response = await fetch("/api/snapshot", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
    const snapshot = await response.json();
    appState.snapshot = snapshot;
    if (announce) setText(elements.announcer, "ซิงก์ข้อมูลโควตาล่าสุดแล้ว");
    renderSnapshot(snapshot);
  } catch {
    if (appState.snapshot) {
      renderSnapshot(appState.snapshot);
      renderConnectionFailure("เชื่อมต่อ Mac ไม่ได้ · แสดงข้อมูลล่าสุดบนหน้าจอ");
    } else {
      renderEmptyFailure();
    }
    if (announce) setText(elements.announcer, "เชื่อมต่อ CodexBar ไม่ได้");
  } finally {
    appState.syncing = false;
    setSyncing(false);
  }
}

function renderSnapshot(snapshot) {
  const view = buildDashboardViewModel(snapshot, {
    now: new Date(),
    timeZone: TIME_ZONE,
    locale: LOCALE,
  });
  const selectedProviderRemoved = appState.selectedProviderID !== OVERVIEW_PROVIDER_ID
    && !view.providers.some((provider) => provider.id === appState.selectedProviderID);
  if (selectedProviderRemoved) appState.selectedProviderID = OVERVIEW_PROVIDER_ID;
  appState.view = view;

  setText(elements.sourceVersion, view.sourceVersion
    ? `CODEXBAR ${view.sourceVersion}`
    : "CODEXBAR · VERSION UNKNOWN");
  updateSyncControl(
    view.state,
    view.state === "empty"
      ? "ยังไม่มีข้อมูล"
      : view.state === "error"
        ? "อ่านโควตาไม่ได้"
      : `${view.state === "stale" ? "ข้อมูลเมื่อ" : "อัปเดต"} ${view.syncedAt}`,
  );
  elements.list.replaceChildren(...view.providers.map(renderProvider));
  elements.list.setAttribute("aria-busy", "false");
  if (view.providers.length === 0) renderEmptySnapshot();
  else {
    renderProviderTabs(view.providers);
    applyProviderSelection();
  }
  if (selectedProviderRemoved) {
    setText(elements.announcer, "ผู้ให้บริการที่เลือกไม่อยู่ในข้อมูลล่าสุด กลับไปที่ภาพรวมแล้ว");
  }

  elements.list.classList.remove("is-updated");
  requestAnimationFrame(() => elements.list.classList.add("is-updated"));
}

function renderProvider(provider) {
  const article = create("article", "provider-strip");
  article.dataset.providerId = provider.id;
  article.dataset.tone = provider.tone;

  const heading = create("header", "provider-heading");
  const identity = create("div", "provider-identity");
  const status = create("p", "provider-status", provider.statusLabel);
  status.dataset.tone = provider.tone;
  status.prepend(create("span", "status-shape"));
  const name = create("h2", "provider-name", provider.label);
  const source = create("p", "provider-source");
  source.append(
    create("span", "provider-source-name", `SOURCE / ${provider.source.toUpperCase()}`),
    create("span", "provider-updated", `อัปเดต ${provider.updatedAt}`),
  );
  identity.append(name, source);
  heading.append(status, identity);

  const tracks = create("div", "quota-tracks");
  const fallbackMessage = providerFallbackMessage(provider);
  if (fallbackMessage) tracks.append(create("p", "provider-notice", fallbackMessage));
  if (provider.windows.length === 0) {
    tracks.append(create("p", "empty-track", provider.state === "error"
      ? "CodexBar อ่านผู้ให้บริการนี้ไม่ได้ กดซิงก์ใหม่หลังตรวจการเชื่อมต่อ"
      : "ผู้ให้บริการนี้ยังไม่ส่งข้อมูลรอบโควตา"));
  } else {
    tracks.append(...provider.windows.map((window) => renderWindow(provider, window)));
  }

  article.append(heading, tracks);
  if (provider.cost) article.append(renderCost(provider.cost));
  article.append(renderProviderDetail(provider));
  return article;
}

function providerFallbackMessage(provider) {
  if (provider.state !== "partial" || provider.windows.length === 0 || !provider.errorKind) {
    return null;
  }
  if (provider.errorKind === "timeout") {
    return "CodexBar timeout ชั่วคราว · แสดงโควตาล่าสุดที่มี";
  }
  if (provider.errorKind === "rate_limited") {
    return "CodexBar ถูกจำกัดชั่วคราว · แสดงโควตาล่าสุดที่มี";
  }
  if (provider.errorKind === "unavailable") {
    return "ติดต่อ CodexBar ไม่ได้ชั่วคราว · แสดงโควตาล่าสุดที่มี";
  }
  return "CodexBar อัปเดตไม่สำเร็จ · แสดงโควตาล่าสุดที่มี";
}

function renderProviderTabs(providers) {
  const focusedTab = [...elements.providerTabs.children]
    .find((tab) => tab === document.activeElement);
  const focusedProviderID = focusedTab?.dataset.providerId ?? null;
  const tabs = [
    renderProviderTab({ id: OVERVIEW_PROVIDER_ID, label: "ภาพรวม" }),
    ...providers.map(renderProviderTab),
  ];

  elements.providerTabs.replaceChildren(...tabs);
  elements.providerSwitcher.hidden = false;
  elements.list.setAttribute("role", "tabpanel");
  elements.list.setAttribute("tabindex", "0");

  const focusTarget = tabs.find((tab) => tab.dataset.providerId === focusedProviderID)
    ?? (focusedTab
      ? tabs.find((tab) => tab.dataset.providerId === appState.selectedProviderID)
      : null);
  if (focusTarget) focusTarget.focus({ preventScroll: true });
}

function renderProviderTab(provider) {
  const tab = create("button", "provider-tab", provider.label);
  const selected = provider.id === appState.selectedProviderID;
  tab.id = `provider-tab-${provider.id}`;
  tab.dataset.providerId = provider.id;
  tab.dataset.tone = provider.tone ?? "overview";
  tab.setAttribute("type", "button");
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", "provider-list");
  tab.setAttribute("aria-selected", String(selected));
  tab.setAttribute("tabindex", selected ? "0" : "-1");
  tab.setAttribute("aria-label", l(providerTabAccessibleLabel(provider)));

  if (Number.isFinite(provider.score)) {
    tab.style.setProperty("--remaining", `${provider.score}%`);
  }

  const meter = create("span", "provider-tab-meter");
  meter.setAttribute("aria-hidden", "true");
  meter.append(create("span", "provider-tab-meter-fill"));
  tab.append(meter);
  tab.addEventListener("click", () => selectProvider(provider.id));
  tab.addEventListener("keydown", (event) => handleProviderTabKeydown(event, tab));
  return tab;
}

function providerTabAccessibleLabel(provider) {
  if (provider.id === OVERVIEW_PROVIDER_ID) return "ภาพรวมผู้ให้บริการทั้งหมด";
  if (provider.state === "error") return `${provider.label}, อ่านโควตาไม่ได้`;
  if (provider.state === "partial") {
    return Number.isFinite(provider.score)
      ? `${provider.label}, ข้อมูลไม่ครบ, เหลือต่ำสุดประมาณ ${Math.round(provider.score)} เปอร์เซ็นต์`
      : `${provider.label}, ข้อมูลไม่ครบ, ยังไม่มีข้อมูลโควตา`;
  }
  if (Number.isFinite(provider.score)) {
    return `${provider.label}, เหลือต่ำสุดประมาณ ${Math.round(provider.score)} เปอร์เซ็นต์`;
  }
  return `${provider.label}, ยังไม่มีข้อมูลโควตา`;
}

function selectProvider(providerID, { focus = false } = {}) {
  if (!appState.view) return;
  const isAvailable = providerID === OVERVIEW_PROVIDER_ID
    || appState.view.providers.some((provider) => provider.id === providerID);
  if (!isAvailable) return;

  appState.selectedProviderID = providerID;
  updateProviderTabSelection();
  applyProviderSelection();

  const selectedTab = [...elements.providerTabs.children]
    .find((tab) => tab.dataset.providerId === providerID);
  if (focus) selectedTab?.focus({ preventScroll: true });
  selectedTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  const selectedProvider = appState.view.providers
    .find((provider) => provider.id === providerID);
  setText(elements.announcer, selectedProvider
    ? `กำลังแสดง ${selectedProvider.label}`
    : "กำลังแสดงผู้ให้บริการทั้งหมด");
}

function updateProviderTabSelection() {
  for (const tab of elements.providerTabs.children) {
    const selected = tab.dataset.providerId === appState.selectedProviderID;
    tab.setAttribute("aria-selected", String(selected));
    tab.setAttribute("tabindex", selected ? "0" : "-1");
  }
}

function applyProviderSelection() {
  const providers = appState.view?.providers ?? [];
  const selectedProvider = providers
    .find((provider) => provider.id === appState.selectedProviderID) ?? null;
  const visibleProviders = selectedProvider ? [selectedProvider] : providers;

  for (const strip of elements.list.children) {
    strip.hidden = selectedProvider ? strip.dataset.providerId !== selectedProvider.id : false;
  }

  setText(elements.count, selectedProvider
    ? `1 จาก ${providers.length} ผู้ให้บริการ`
    : `${providers.length} ผู้ให้บริการ`);
  elements.board.dataset.view = selectedProvider ? "provider" : "overview";
  if (selectedProvider) {
    elements.board.removeAttribute("aria-labelledby");
    elements.board.setAttribute("aria-label", l(`${selectedProvider.label} โควตา`));
  } else {
    elements.board.removeAttribute("aria-label");
    elements.board.setAttribute("aria-labelledby", "providers-title");
  }

  const selectedTab = [...elements.providerTabs.children]
    .find((tab) => tab.dataset.providerId === appState.selectedProviderID);
  if (selectedTab) elements.list.setAttribute("aria-labelledby", selectedTab.id);
  renderResetSchedule(visibleProviders);
}

function handleProviderTabKeydown(event, currentTab) {
  const tabs = [...elements.providerTabs.children];
  const currentIndex = tabs.indexOf(currentTab);
  if (currentIndex < 0) return;

  let nextIndex = null;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (nextIndex === null) return;

  event.preventDefault();
  selectProvider(tabs[nextIndex].dataset.providerId, { focus: true });
}

function renderWindow(provider, window) {
  const track = create("section", "quota-track");
  const top = create("div", "track-labels");
  const label = create("h3", "track-name", window.label);
  const remaining = create("p", "quota-value", window.remainingLabel);
  remaining.dataset.tone = window.tone;
  top.append(label, remaining);

  const rail = create("div", "quota-rail");
  rail.setAttribute("role", "progressbar");
  rail.setAttribute("aria-label", l(`${provider.label} ${window.label} ${window.remainingLabel}`));
  rail.setAttribute("aria-valuemin", "0");
  rail.setAttribute("aria-valuemax", "100");
  if (Number.isFinite(window.remainingPercent)) {
    rail.setAttribute("aria-valuenow", String(window.remainingPercent));
    rail.style.setProperty("--remaining", `${window.remainingPercent}%`);
  }
  const fill = create("span", "rail-fill");
  const marker = create("span", "rail-marker");
  marker.dataset.tone = window.tone;
  rail.append(fill, marker);

  const reset = create("p", "track-reset");
  const time = create("time", "reset-time", window.reset.absolute);
  if (window.reset.iso) time.dateTime = window.reset.iso;
  reset.append(time, create("span", "reset-relative", window.reset.relative));
  track.append(top, rail, reset);
  return track;
}

function renderCost(cost) {
  const row = create("p", "cost-row");
  row.append(create("span", "cost-label", "ค่าใช้จ่าย 30 วัน"));
  const amount = formatCurrency(cost.last30Days, cost.currency);
  row.append(create("strong", "cost-value", amount));
  return row;
}

function renderProviderDetail(provider) {
  const detail = create("section", "provider-detail");
  detail.setAttribute("aria-label", l(`ข้อมูลเพิ่มเติมของ ${provider.label}`));

  if (provider.resetCredits) detail.append(renderResetCredits(provider.resetCredits));

  const metrics = providerDetailMetrics(provider);
  const metricList = create("dl", "provider-metrics");
  for (const metric of metrics) {
    const item = create("div", "detail-metric");
    item.append(
      create("dt", "detail-label", metric.label),
      create("dd", "detail-value", metric.value),
    );
    metricList.append(item);
  }
  detail.append(metricList);

  const history = renderUsageHistory(provider.cost);
  if (history) detail.append(history);
  return detail;
}

function providerDetailMetrics(provider) {
  const metrics = [];
  const cost = provider.cost;
  if (Number.isFinite(cost?.today)) {
    metrics.push({ label: "วันนี้", value: formatCurrency(cost.today, cost.currency) });
  }
  if (Number.isFinite(cost?.last30Days)) {
    metrics.push({ label: "30 วัน", value: formatCurrency(cost.last30Days, cost.currency) });
  }
  if (Number.isFinite(cost?.sessionTokens)) {
    metrics.push({ label: "โทเค็นล่าสุด", value: formatCompactNumber(cost.sessionTokens) });
  }
  if (Number.isFinite(cost?.last30DaysTokens)) {
    metrics.push({ label: "โทเค็น 30 วัน", value: formatCompactNumber(cost.last30DaysTokens) });
  }

  const operational = [
    { label: "รอบที่ติดตาม", value: `${provider.windows.length} รอบ` },
    {
      label: "เหลือต่ำสุด",
      value: Number.isFinite(provider.score) ? `${formatPercent(provider.score)}%` : "-",
    },
    { label: "รีเซ็ตถัดไป", value: provider.nextReset?.relative ?? "ยังไม่ทราบ" },
    {
      label: "อัปเดตรายละเอียด",
      value: formatDetailTimestamp(cost?.updatedAt) ?? provider.resetCredits?.updatedAt ?? provider.updatedAt,
    },
  ];
  for (const metric of operational) {
    if (metrics.length >= 4) break;
    metrics.push(metric);
  }
  return metrics;
}

function renderResetCredits(resetCredits) {
  const row = create("div", "reset-credit-summary");
  const copy = create("div", "reset-credit-copy");
  copy.append(
    create("h3", "reset-credit-title", "เครดิตรีเซ็ตโควตา"),
    create("strong", "reset-credit-value", `${resetCredits.available} ใช้ได้`),
  );
  row.append(copy);
  if (resetCredits.expiries.length > 0) {
    const expiries = resetCredits.expiries
      .slice(0, 2)
      .map((expiry) => expiry.relative.replace(/^อีก /u, ""))
      .join(" / ");
    row.append(create("p", "reset-credit-expiry", `หมดอายุใน ${expiries}`));
  }
  return row;
}

function renderUsageHistory(cost) {
  const days = Array.isArray(cost?.daily)
    ? cost.daily.filter((day) => Number.isFinite(day.tokens)).slice(-14)
    : [];
  if (days.length === 0) return null;

  const figure = create("figure", "usage-history");
  const heading = create("div", "usage-history-heading");
  heading.append(
    create("h3", "usage-history-title", `โทเค็น ${days.length} วันล่าสุด`),
    create("p", "usage-history-max", `สูงสุด ${formatCompactNumber(Math.max(...days.map((day) => day.tokens)))}`),
  );
  const bars = create("ol", "usage-bars");
  bars.setAttribute("aria-label", l("ประวัติโทเค็นรายวัน"));
  const maxTokens = Math.max(1, ...days.map((day) => day.tokens));
  for (const day of days) {
    const item = create("li", "usage-bar-item");
    item.setAttribute("aria-label", l(`${formatShortDate(day.date)} ${formatFullNumber(day.tokens)} โทเค็น`));
    const bar = create("span", "usage-bar");
    bar.style.setProperty("--usage-level", `${Math.max(3, (day.tokens / maxTokens) * 100)}%`);
    item.append(bar);
    bars.append(item);
  }
  const range = create("p", "usage-range");
  range.append(
    create("time", "usage-date", formatShortDate(days[0].date)),
    create("time", "usage-date", formatShortDate(days.at(-1).date)),
  );
  figure.append(heading, bars, range);
  if (cost.topModel) {
    const model = create("p", "top-model");
    model.append(create("span", "top-model-label", "รุ่นที่ใช้มากสุด"), create("strong", "top-model-value", cost.topModel));
    figure.append(model);
  }
  figure.append(create("figcaption", "usage-caption", "ประเมินจากการใช้โทเค็น ไม่ใช่ยอดเรียกเก็บจริง"));
  return figure;
}

function formatCurrency(value, currency = "USD") {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat(LOCALE === "th" ? "th-TH-u-nu-latn" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactNumber(value) {
  if (!Number.isFinite(value)) return "-";
  const formats = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [divisor, suffix] of formats) {
    if (value >= divisor) {
      const scaled = value / divisor;
      return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/u, "")}${suffix}`;
    }
  }
  return formatFullNumber(value);
}

function formatFullNumber(value) {
  return new Intl.NumberFormat(LOCALE === "th" ? "th-TH-u-nu-latn" : "en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatShortDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALE === "th" ? "th-TH-u-nu-latn" : "en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatDetailTimestamp(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALE === "th" ? "th-TH-u-nu-latn" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  }).format(date);
}

function formatPercent(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function renderResetSchedule(providers) {
  const events = providers
    .flatMap((provider) => provider.windows.map((window) => ({ provider, window })))
    .filter(({ window }) => window.reset.iso)
    .sort((left, right) => new Date(left.window.reset.iso) - new Date(right.window.reset.iso));

  elements.resetList.replaceChildren(...events.slice(0, 6).map(({ provider, window }) => {
    const item = create("li", "reset-event");
    const marker = create("span", "event-marker");
    marker.dataset.tone = window.tone;
    const copy = create("div", "event-copy");
    const title = create("p", "event-title", `${provider.label} · ${window.label}`);
    const time = create("time", "event-time", `${window.reset.relative} · ${window.reset.absolute}`);
    time.dateTime = window.reset.iso;
    copy.append(title, time);
    item.append(marker, copy);
    return item;
  }));
  elements.resetBoard.hidden = events.length === 0;
}

function renderEmptyFailure() {
  appState.view = null;
  appState.selectedProviderID = OVERVIEW_PROVIDER_ID;
  updateSyncControl("error", "Mac ออฟไลน์");
  setText(elements.count, "0 ผู้ให้บริการ");
  elements.providerSwitcher.hidden = true;
  elements.providerTabs.replaceChildren();
  elements.list.removeAttribute("role");
  elements.list.removeAttribute("tabindex");
  elements.list.removeAttribute("aria-labelledby");
  elements.list.setAttribute("aria-busy", "false");
  elements.list.replaceChildren(create("p", "board-message", "ยังไม่มีข้อมูลบนอุปกรณ์นี้"));
  elements.resetBoard.hidden = true;
  setText(elements.sourceVersion, "COMPUTER OFFLINE");
}

function renderEmptySnapshot() {
  const focusedTabRemoved = [...elements.providerTabs.children]
    .some((tab) => tab === document.activeElement);
  appState.selectedProviderID = OVERVIEW_PROVIDER_ID;
  setText(elements.count, "0 ผู้ให้บริการ");
  elements.board.dataset.view = "overview";
  elements.board.removeAttribute("aria-label");
  elements.board.setAttribute("aria-labelledby", "providers-title");
  elements.providerSwitcher.hidden = true;
  elements.providerTabs.replaceChildren();
  elements.list.removeAttribute("role");
  if (focusedTabRemoved) elements.list.setAttribute("tabindex", "-1");
  else elements.list.removeAttribute("tabindex");
  elements.list.removeAttribute("aria-labelledby");
  elements.list.replaceChildren(create("p", "board-message", "ยังไม่มีข้อมูลโควตาจาก CodexBar"));
  elements.resetBoard.hidden = true;
  if (focusedTabRemoved) {
    elements.list.focus({ preventScroll: true });
    setText(elements.announcer, "ไม่มีผู้ให้บริการในข้อมูลล่าสุด");
  }
}

function renderConnectionFailure(message) {
  updateSyncControl("stale", message);
}

function setSyncing(syncing) {
  elements.refreshButton.disabled = syncing;
  elements.refreshButton.setAttribute("aria-busy", String(syncing));
  setText(elements.refreshLabel, syncing ? "กำลังซิงก์" : "ซิงก์ใหม่");
  elements.refreshButton.setAttribute(
    "aria-label",
    l(syncing ? "กำลังซิงก์ข้อมูล" : `ซิงก์ใหม่, ${elements.syncLabel.textContent}`),
  );
}

function updateSyncControl(tone, label) {
  elements.refreshButton.dataset.tone = tone;
  setText(elements.syncLabel, label);
  if (!appState.syncing) {
    elements.refreshButton.setAttribute("aria-label", l(`ซิงก์ใหม่, ${label}`));
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function byID(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = l(text);
  return element;
}

function setText(element, value) {
  element.textContent = l(value);
}

function l(value) {
  return localizeText(value, LOCALE);
}
