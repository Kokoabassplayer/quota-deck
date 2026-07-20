import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const origin = "https://quota-deck.example";
const workerURL = new URL("../public/sw.js", import.meta.url);

test("installs a new shell generation and removes the previous cache", async () => {
  const harness = await createWorkerHarness();
  const oldCache = await harness.caches.open("quota-deck-shell-v1");
  await oldCache.put("/app.mjs", new Response("old app"));

  await harness.dispatchLifecycle("install");
  await harness.dispatchLifecycle("activate");

  assert.deepEqual(await harness.caches.keys(), ["quota-deck-shell-v10"]);
});

test("serves a fresh same-origin shell asset and refreshes its cached fallback", async () => {
  let networkRequests = 0;
  const harness = await createWorkerHarness({
    fetchImpl: async () => {
      networkRequests += 1;
      return new Response("new app");
    },
  });
  const cache = await harness.caches.open("quota-deck-shell-v10");
  await cache.put("/app.mjs", new Response("old app"));

  const response = await harness.dispatchFetch("/app.mjs");

  assert.equal(await response.text(), "new app");
  assert.equal(await (await cache.match("/app.mjs")).text(), "new app");
  assert.equal(networkRequests, 1);
});

test("refreshes the cached root document after an online app navigation", async () => {
  const harness = await createWorkerHarness({
    fetchImpl: async () => new Response("new document", {
      headers: { "content-type": "text/html" },
    }),
  });
  const cache = await harness.caches.open("quota-deck-shell-v10");
  await cache.put("/", new Response("old document"));

  const response = await harness.dispatchFetch("/", { mode: "navigate" });

  assert.equal(await response.text(), "new document");
  assert.equal(await (await cache.match("/")).text(), "new document");
});

test("returns a successful network shell response when cache storage is unavailable", async () => {
  const harness = await createWorkerHarness({
    fetchImpl: async () => new Response("fresh despite cache failure"),
    failCacheWrites: true,
  });

  const response = await harness.dispatchFetch("/app.mjs");

  assert.equal(await response.text(), "fresh despite cache failure");
});

test("falls back to the cached shell offline but always routes API reads to the network", async () => {
  let apiRequests = 0;
  const offlineHarness = await createWorkerHarness({
    fetchImpl: async () => { throw new TypeError("offline"); },
  });
  const offlineCache = await offlineHarness.caches.open("quota-deck-shell-v10");
  await offlineCache.put("/styles.css", new Response("cached styles"));

  const shellResponse = await offlineHarness.dispatchFetch("/styles.css");
  assert.equal(await shellResponse.text(), "cached styles");

  const onlineHarness = await createWorkerHarness({
    fetchImpl: async () => {
      apiRequests += 1;
      return Response.json({ ok: true });
    },
  });
  const apiResponse = await onlineHarness.dispatchFetch("/api/snapshot");

  assert.deepEqual(await apiResponse.json(), { ok: true });
  assert.equal(apiRequests, 1);
  assert.equal(await onlineHarness.caches.match("/api/snapshot"), undefined);
});

async function createWorkerHarness({
  fetchImpl = async () => new Response("network"),
  failCacheWrites = false,
} = {}) {
  const listeners = new Map();
  const stores = new Map();
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(keys) {
          for (const key of keys) store.set(cacheKey(key), new Response(`cached ${key}`));
        },
        async put(key, response) {
          if (failCacheWrites) throw new Error("cache quota exceeded");
          store.set(cacheKey(key), response.clone());
        },
        async match(key) {
          return store.get(cacheKey(key))?.clone();
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(key) {
      for (const store of stores.values()) {
        const response = store.get(cacheKey(key));
        if (response) return response.clone();
      }
      return undefined;
    },
  };
  const workerSelf = {
    location: { origin },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const source = await readFile(workerURL, "utf8");
  vm.runInNewContext(source, {
    Response,
    URL,
    caches,
    fetch: fetchImpl,
    self: workerSelf,
  });

  return {
    caches,
    async dispatchFetch(pathname, options = {}) {
      const request = {
        method: options.method ?? "GET",
        mode: options.mode ?? "same-origin",
        url: new URL(pathname, origin).href,
      };
      let response;
      listeners.get("fetch")({
        request,
        respondWith(value) { response = Promise.resolve(value); },
      });
      return response;
    },
    async dispatchLifecycle(type) {
      let completion;
      listeners.get(type)({ waitUntil(value) { completion = Promise.resolve(value); } });
      await completion;
    },
  };
}

function cacheKey(value) {
  const url = typeof value === "string" ? value : value.url;
  return new URL(url, origin).href;
}
