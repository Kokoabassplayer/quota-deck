const CACHE_NAME = "quota-deck-shell-v10";
const SHELL_ASSETS = [
  "/",
  "/app.mjs",
  "/i18n.mjs",
  "/view-model.mjs",
  "/styles.css",
  "/manifest.webmanifest",
  "/icons/quota-deck.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      url.pathname === "/"
        ? networkFirstShell(event.request, "/")
        : fetch(event.request).catch(() => caches.match("/")),
    );
    return;
  }

  if (!SHELL_ASSETS.includes(url.pathname)) return;
  event.respondWith(networkFirstShell(event.request, url.pathname));
});

async function networkFirstShell(request, cacheKey) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(cacheKey, response.clone());
      } catch {
        // A cache quota failure must not discard a successful network response.
      }
    }
    return response;
  } catch (error) {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}
