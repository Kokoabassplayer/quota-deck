import assert from "node:assert/strict";
import test from "node:test";

const appURL = new URL("../public/app.mjs", import.meta.url);
let moduleGeneration = 0;

test("shows loading until the first snapshot becomes a live dashboard", async (t) => {
  const request = deferred();
  const harness = await loadApp({ fetchImpl: () => request.promise });
  t.after(harness.restore);

  assert.equal(harness.element("provider-list").getAttribute("aria-busy"), "true");
  assert.equal(harness.element("provider-list").getAttribute("role"), null);
  assert.equal(harness.element("provider-switcher").hidden, true);
  assert.equal(harness.element("refresh-button").tagName, "BUTTON");
  assert.equal(harness.element("refresh-button").disabled, true);
  assert.equal(harness.element("refresh-button").getAttribute("aria-busy"), "true");
  assert.equal(harness.element("refresh-label").textContent, "กำลังซิงก์");
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.fetchCalls[0].url, "/api/snapshot");
  assert.equal(harness.fetchCalls[0].options.cache, "no-store");
  assert(harness.fetchCalls[0].options.signal, "snapshot request carries an AbortSignal");

  request.resolve(jsonResponse(snapshot({ state: "live" })));
  await waitFor(() => harness.element("refresh-button").dataset.tone === "live");

  assert.equal(harness.element("provider-count").textContent, "1 ผู้ให้บริการ");
  assert.equal(harness.element("source-version").textContent, "CODEXBAR 0.45.1");
  assert.equal(harness.element("provider-list").children.length, 1);
  assert.match(harness.element("provider-list").textContent, /Codex/);
  assert.match(harness.element("provider-list").textContent, /เหลือ 72%/);
  assert.equal(harness.element("provider-list").getAttribute("aria-busy"), "false");
  assert.equal(harness.element("refresh-button").disabled, false);
  assert.equal(harness.element("refresh-button").getAttribute("aria-busy"), "false");
  assert.match(harness.element("refresh-button").getAttribute("aria-label"), /^ซิงก์ใหม่, อัปเดต /);
  assert.equal(harness.element("refresh-label").textContent, "ซิงก์ใหม่");
});

test("renders a stale snapshot as an explicit warning", async (t) => {
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshot({ state: "stale" })),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("refresh-button").dataset.tone === "stale");

  assert.match(harness.element("sync-label").textContent, /^ข้อมูลเมื่อ /);
  assert.equal(harness.element("provider-count").textContent, "1 ผู้ให้บริการ");
});

test("renders an empty snapshot without inventing providers or reset events", async (t) => {
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshot({ state: "empty" })),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("refresh-button").dataset.tone === "empty");

  assert.equal(harness.element("sync-label").textContent, "ยังไม่มีข้อมูล");
  assert.equal(harness.element("provider-count").textContent, "0 ผู้ให้บริการ");
  assert.equal(harness.element("provider-list").children.length, 1);
  assert.match(harness.element("provider-list").textContent, /ยังไม่มีข้อมูลโควตา/);
  assert.equal(harness.element("provider-switcher").hidden, true);
  assert.equal(harness.element("reset-board").hidden, true);
});

test("renders provider failure as an error state with recovery guidance", async (t) => {
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshot({ state: "error" })),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("refresh-button").dataset.tone === "error");

  assert.equal(harness.element("sync-label").textContent, "อ่านโควตาไม่ได้");
  assert.equal(harness.element("provider-count").textContent, "1 ผู้ให้บริการ");
  assert.match(harness.element("provider-list").textContent, /CodexBar อ่านผู้ให้บริการนี้ไม่ได้/);
  assert.equal(harness.element("provider-list").children[0].dataset.tone, "error");
});

test("shows recent quota with a compact warning during a transient provider timeout", async (t) => {
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshot({
      state: "live",
      providers: [provider({
        id: "codex",
        label: "Codex",
        remainingPercent: 99,
        state: "partial",
        error: { code: "provider_error", kind: "timeout" },
        cost: { currency: "USD", last30Days: 1_900.14 },
      })],
    })),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("refresh-button").dataset.tone === "live");

  const providerRow = harness.element("provider-list").children[0];
  const providerTab = harness.element("provider-tabs").children[1];
  assert.equal(providerRow.dataset.tone, "warning");
  assert.match(providerRow.textContent, /CodexBar timeout ชั่วคราว · แสดงโควตาล่าสุดที่มี/);
  assert.match(providerRow.textContent, /เหลือ 99%/);
  assert.match(providerRow.textContent, /US\$1,900\.14/);
  assert.match(providerTab.getAttribute("aria-label"), /ข้อมูลไม่ครบ.*99 เปอร์เซ็นต์/);
});

test("renders provider quota tabs and filters the board without another request", async (t) => {
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshot({
      state: "live",
      providers: [
        provider({ id: "codex", label: "Codex", remainingPercent: 12 }),
        provider({ id: "zai", label: "z.ai", remainingPercent: 97 }),
      ],
    })),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("refresh-button").dataset.tone === "live");

  const tabs = harness.element("provider-tabs").children;
  assert.deepEqual(tabs.map((tab) => tab.ownText), ["ภาพรวม", "Codex", "z.ai"]);
  assert.equal(harness.element("provider-switcher").hidden, false);
  assert.equal(tabs[0].getAttribute("role"), "tab");
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(tabs[1].getAttribute("aria-selected"), "false");
  assert.equal(tabs[1].style["--remaining"], "12%");
  assert.equal(tabs[2].style["--remaining"], "97%");
  assert.match(tabs[1].getAttribute("aria-label"), /เหลือต่ำสุดประมาณ 12 เปอร์เซ็นต์/);
  assert.equal(harness.element("provider-list").getAttribute("role"), "tabpanel");

  tabs[2].click();

  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(tabs[0].getAttribute("aria-selected"), "false");
  assert.equal(tabs[2].getAttribute("aria-selected"), "true");
  assert.equal(harness.element("provider-list").children[0].hidden, true);
  assert.equal(harness.element("provider-list").children[1].hidden, false);
  assert.equal(harness.element("provider-count").textContent, "1 จาก 2 ผู้ให้บริการ");
  assert.equal(harness.element("provider-board").dataset.view, "provider");

  tabs[0].click();

  assert.equal(harness.element("provider-list").children.every((item) => item.hidden === false), true);
  assert.equal(harness.element("provider-count").textContent, "2 ผู้ให้บริการ");
  assert.equal(harness.element("provider-board").dataset.view, "overview");
});

test("renders real Codex detail metrics and history without exposing project data", async (t) => {
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshot({
      state: "live",
      providers: [provider({
        id: "codex",
        label: "Codex",
        remainingPercent: 12.5,
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
      })],
    })),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("provider-tabs").children.length === 2);

  harness.element("provider-tabs").children[1].click();
  const article = harness.element("provider-list").children[0];
  const detail = article.children.find((child) => child.className === "provider-detail");

  assert(detail, "provider detail section is rendered");
  assert.match(detail.textContent, /เครดิตรีเซ็ตโควตา2 ใช้ได้/);
  assert.match(detail.textContent, /วันนี้US\$8\.25/);
  assert.match(detail.textContent, /30 วันUS\$1,853\.69/);
  assert.match(detail.textContent, /โทเค็นล่าสุด12\.2M/);
  assert.match(detail.textContent, /โทเค็น 30 วัน2\.8B/);
  assert.match(detail.textContent, /รุ่นที่ใช้มากสุดgpt-5\.6-sol/);
  assert.match(detail.textContent, /ไม่ใช่ยอดเรียกเก็บจริง/);
  assert.doesNotMatch(detail.textContent, /private-project|Secret Project/);
});

test("moves through provider tabs with arrow, Home, and End keys", async (t) => {
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshot({
      state: "live",
      providers: [
        provider({ id: "codex", label: "Codex", remainingPercent: 12 }),
        provider({ id: "zai", label: "z.ai", remainingPercent: 97 }),
      ],
    })),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("provider-tabs").children.length === 3);

  const tabs = harness.element("provider-tabs").children;
  tabs[0].focus();
  tabs[0].keydown("ArrowRight");
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(harness.document.activeElement, tabs[1]);
  assert.equal(harness.element("provider-list").children[0].hidden, false);
  assert.equal(harness.element("provider-list").children[1].hidden, true);

  tabs[1].keydown("End");
  assert.equal(tabs[2].getAttribute("aria-selected"), "true");
  assert.equal(harness.document.activeElement, tabs[2]);

  tabs[2].keydown("Home");
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(harness.document.activeElement, tabs[0]);

  tabs[0].keydown("ArrowLeft");
  assert.equal(tabs[2].getAttribute("aria-selected"), "true");
  assert.equal(harness.document.activeElement, tabs[2]);
});

test("announces partial provider tabs even when no quota score is available", async (t) => {
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshot({
      state: "live",
      providers: [provider({
        id: "gemini",
        label: "Gemini",
        remainingPercent: null,
        state: "partial",
      })],
    })),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("provider-tabs").children.length === 2);

  assert.equal(
    harness.element("provider-tabs").children[1].getAttribute("aria-label"),
    "Gemini, ข้อมูลไม่ครบ, ยังไม่มีข้อมูลโควตา",
  );
});

test("preserves a provider selection across refresh and falls back when it disappears", async (t) => {
  const snapshots = [
    snapshot({
      state: "live",
      providers: [
        provider({ id: "codex", label: "Codex", remainingPercent: 12 }),
        provider({ id: "zai", label: "z.ai", remainingPercent: 97 }),
      ],
    }),
    snapshot({
      state: "live",
      providers: [
        provider({ id: "codex", label: "Codex", remainingPercent: 11 }),
        provider({ id: "zai", label: "z.ai", remainingPercent: 96 }),
      ],
    }),
    snapshot({
      state: "live",
      providers: [provider({ id: "codex", label: "Codex", remainingPercent: 10 })],
    }),
  ];
  let responseIndex = 0;
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshots[responseIndex++]),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("provider-tabs").children.length === 3);

  harness.element("provider-tabs").children[2].click();
  harness.element("refresh-button").click();
  await waitFor(() => harness.fetchCalls.length === 2 && !harness.element("refresh-button").disabled);

  let tabs = harness.element("provider-tabs").children;
  assert.equal(tabs[2].getAttribute("aria-selected"), "true");
  assert.equal(harness.element("provider-list").children[0].hidden, true);
  assert.equal(harness.element("provider-list").children[1].hidden, false);
  tabs[2].focus();

  harness.element("refresh-button").click();
  await waitFor(() => harness.fetchCalls.length === 3 && !harness.element("refresh-button").disabled);

  tabs = harness.element("provider-tabs").children;
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(harness.element("provider-list").children[0].hidden, false);
  assert.equal(harness.element("provider-count").textContent, "1 ผู้ให้บริการ");
  assert.equal(harness.document.activeElement, tabs[0]);
  assert.match(harness.element("sync-announcer").textContent, /กลับไปที่ภาพรวมแล้ว/);
});

test("moves focus to the empty board when a refresh removes every provider", async (t) => {
  const snapshots = [
    snapshot({
      state: "live",
      providers: [provider({ id: "codex", label: "Codex", remainingPercent: 12 })],
    }),
    snapshot({ state: "empty", providers: [] }),
  ];
  let responseIndex = 0;
  const harness = await loadApp({
    fetchImpl: async () => jsonResponse(snapshots[responseIndex++]),
  });
  t.after(harness.restore);
  await waitFor(() => harness.element("provider-tabs").children.length === 2);

  harness.element("provider-tabs").children[1].focus();
  harness.element("refresh-button").click();
  await waitFor(() => harness.fetchCalls.length === 2 && !harness.element("refresh-button").disabled);

  assert.equal(harness.element("provider-switcher").hidden, true);
  assert.equal(harness.element("provider-tabs").children.length, 0);
  assert.equal(harness.document.activeElement, harness.element("provider-list"));
  assert.equal(harness.element("provider-list").getAttribute("tabindex"), "-1");
  assert.match(harness.element("sync-announcer").textContent, /ไม่มีผู้ให้บริการ/);
});

test("a timed-out snapshot request releases the sync lock for a retry", async (t) => {
  const timeouts = createManualTimeouts();
  const harness = await loadApp({
    abortSignal: { timeout: timeouts.create },
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      const rejectOnAbort = () => reject(signal.reason);
      if (signal.aborted) rejectOnAbort();
      else signal.addEventListener("abort", rejectOnAbort, { once: true });
    }),
  });
  t.after(harness.restore);

  assert.equal(timeouts.records.length, 1);
  assert.equal(timeouts.records[0].milliseconds, 15_000);
  assert.equal(harness.fetchCalls[0].options.signal, timeouts.records[0].signal);
  assert.equal(harness.element("refresh-button").disabled, true);

  harness.element("refresh-button").click();
  assert.equal(harness.fetchCalls.length, 1, "a second request is blocked while syncing");

  timeouts.records[0].abort();
  await waitFor(() => harness.element("refresh-button").disabled === false);
  assert.equal(harness.element("refresh-button").dataset.tone, "error");
  assert.equal(harness.element("sync-label").textContent, "Mac ออฟไลน์");
  assert.equal(harness.element("refresh-label").textContent, "ซิงก์ใหม่");
  assert.equal(harness.element("provider-list").getAttribute("role"), null);

  harness.element("refresh-button").click();
  await waitFor(() => harness.fetchCalls.length === 2);
  assert.equal(harness.element("refresh-button").disabled, true);
  assert.notEqual(harness.fetchCalls[1].options.signal, harness.fetchCalls[0].options.signal);

  timeouts.records[1].abort();
  await waitFor(() => harness.element("refresh-button").disabled === false);
});

async function loadApp({ fetchImpl, abortSignal = AbortSignal }) {
  const dom = createDOM();
  const fetchCalls = [];
  const replacements = {
    AbortSignal: abortSignal,
    document: dom.document,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return fetchImpl(url, options);
    },
    navigator: {},
    requestAnimationFrame: (callback) => {
      callback(0);
      return 1;
    },
    setInterval: () => 1,
    window: dom.window,
  };
  const restore = replaceGlobals(replacements);

  try {
    moduleGeneration += 1;
    await import(`${appURL.href}?dom-test=${moduleGeneration}`);
  } catch (error) {
    restore();
    throw error;
  }

  return {
    document: dom.document,
    element: dom.element,
    fetchCalls,
    restore,
  };
}

function snapshot({ state, providers: providerOverride }) {
  const providers = providerOverride ?? (state === "empty" ? [] : [{
    id: "codex",
    label: "Codex",
    source: "oauth",
    state: state === "error" ? "error" : "ok",
    updatedAt: "2026-07-19T08:30:00.000Z",
    windows: state === "error" ? [] : [{
      kind: "session",
      label: "5H",
      remainingPercent: 72,
      resetsAt: "2026-07-19T12:00:00.000Z",
    }],
  }]);

  return {
    schemaVersion: 1,
    fetchedAt: "2026-07-19T08:30:00.000Z",
    staleAfterSeconds: 180,
    freshness: {
      state: state === "stale" ? "stale" : "fresh",
      staleAt: state === "stale"
        ? "2026-07-19T08:31:00.000Z"
        : "2099-01-01T00:00:00.000Z",
    },
    source: { mode: "dashboard", status: "ok", version: "0.45.1" },
    providers,
  };
}

function provider({
  id,
  label,
  remainingPercent,
  state = "ok",
  cost,
  error,
  resetCredits,
}) {
  return {
    id,
    label,
    source: "api",
    state,
    updatedAt: "2026-07-19T08:30:00.000Z",
    windows: Number.isFinite(remainingPercent) ? [{
      kind: "weekly",
      label: "WEEKLY",
      remainingPercent,
      resetsAt: "2026-07-20T08:30:00.000Z",
    }] : [],
    ...(cost ? { cost } : {}),
    ...(error ? { error } : {}),
    ...(resetCredits ? { resetCredits } : {}),
  };
}

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    json: async () => structuredClone(value),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createManualTimeouts() {
  const records = [];
  return {
    records,
    create(milliseconds) {
      const listeners = new Set();
      const signal = {
        aborted: false,
        reason: undefined,
        addEventListener(type, listener) {
          if (type === "abort") listeners.add(listener);
        },
      };
      const record = {
        milliseconds,
        signal,
        abort() {
          if (signal.aborted) return;
          signal.aborted = true;
          signal.reason = new DOMException("The operation timed out", "TimeoutError");
          for (const listener of listeners) listener.call(signal, { type: "abort" });
        },
      };
      records.push(record);
      return signal;
    },
  };
}

function createDOM() {
  const elements = new Map();
  const initialElements = {
    "sync-announcer": {},
    "provider-board": { dataset: { view: "overview" } },
    "provider-count": { text: "— ผู้ให้บริการ" },
    "provider-list": { attributes: { "aria-busy": "true" } },
    "provider-switcher": { hidden: true },
    "provider-tabs": {},
    "refresh-button": { tag: "button", dataset: { tone: "loading" } },
    "refresh-label": { text: "รอสักครู่" },
    "reset-board": { hidden: true },
    "reset-list": {},
    "source-version": { text: "รอการเชื่อมต่อ" },
    "sync-label": { text: "กำลังเชื่อมต่อ" },
  };

  for (const [id, options] of Object.entries(initialElements)) {
    const element = new FakeElement(options.tag ?? "div");
    element.id = id;
    element.textContent = options.text ?? "";
    Object.assign(element.dataset, options.dataset);
    element.hidden = options.hidden ?? false;
    for (const [name, value] of Object.entries(options.attributes ?? {})) {
      element.setAttribute(name, value);
    }
    elements.set(id, element);
  }

  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    activeElement: null,
    visibilityState: "visible",
    addEventListener(type, listener) {
      addListener(documentListeners, type, listener);
    },
    createElement(tag) {
      return new FakeElement(tag);
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
  };
  const window = {
    isSecureContext: false,
    addEventListener(type, listener) {
      addListener(windowListeners, type, listener);
    },
  };

  return {
    document,
    element(id) {
      const element = elements.get(id);
      assert(element, `missing fake DOM element #${id}`);
      return element;
    },
    window,
  };
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.id = "";
    this.className = "";
    this.children = [];
    this.dataset = {};
    this.style = { setProperty: (name, value) => { this.style[name] = value; } };
    this.hidden = false;
    this.disabled = false;
    this.dateTime = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.ownText = "";
    this.classList = {
      add: (...names) => this.updateClasses((classes) => names.forEach((name) => classes.add(name))),
      contains: (name) => this.className.split(/\s+/u).includes(name),
      remove: (...names) => this.updateClasses((classes) => names.forEach((name) => classes.delete(name))),
    };
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent ?? String(child)).join("");
  }

  set textContent(value) {
    this.ownText = String(value);
    this.children = [];
  }

  addEventListener(type, listener) {
    addListener(this.listeners, type, listener);
  }

  append(...children) {
    this.children.push(...children);
  }

  click() {
    for (const listener of this.listeners.get("click") ?? []) {
      listener.call(this, { type: "click", target: this });
    }
  }

  keydown(key) {
    const event = {
      defaultPrevented: false,
      key,
      preventDefault() {
        this.defaultPrevented = true;
      },
      target: this,
      type: "keydown",
    };
    for (const listener of this.listeners.get("keydown") ?? []) {
      listener.call(this, event);
    }
    return event;
  }

  focus() {
    globalThis.document.activeElement = this;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  prepend(...children) {
    this.children.unshift(...children);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  replaceChildren(...children) {
    this.ownText = "";
    this.children = [...children];
  }

  scrollIntoView() {}

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  updateClasses(update) {
    const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
    update(classes);
    this.className = [...classes].join(" ");
  }
}

function addListener(registry, type, listener) {
  if (!registry.has(type)) registry.set(type, []);
  registry.get(type).push(listener);
}

function replaceGlobals(replacements) {
  const originals = new Map();
  for (const [name, value] of Object.entries(replacements)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("timed out waiting for DOM state");
}
