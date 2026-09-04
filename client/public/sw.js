/*
 * Titan Pro service worker — offline app-shell caching.
 *
 * Purpose: let the app LOAD when a tech has no signal (basement/crawlspace).
 * Without this, the SPA can't even open offline. Data writes are NOT handled
 * here — they go through the app's IndexedDB outbox (offlineQueue.ts). This
 * worker only makes the shell + built assets available offline.
 *
 * Strategy:
 *   • Static build assets (/assets/*, icons, manifest): cache-first, since Vite
 *     content-hashes filenames so a changed file always has a new URL.
 *   • Navigations (HTML): network-first, falling back to the cached index.html
 *     so the SPA boots offline and hash-routing takes over.
 *   • API calls (/api/*): never intercepted — always go to network; the app's
 *     outbox handles offline writes and reads simply fail as before.
 */

// Bump this version any time we ship a chunk whose behavior users must
// see immediately (bug fixes, security fixes, interactive event handlers).
// The `activate` step deletes every cache whose key !== CACHE, so bumping
// this string invalidates the entire prior asset cache and forces a fresh
// fetch of index.html + hashed chunks on the next load.
const CACHE = "titan-shell-v2-2026-09-04";
const CORE = ["./", "./index.html", "./manifest.json", "./favicon.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache writes

  const url = new URL(req.url);

  // Never touch API traffic — outbox owns offline writes; reads pass through.
  if (url.pathname.includes("/api/")) return;

  // Cross-origin (fonts, CDNs) — let the browser handle normally.
  if (url.origin !== self.location.origin) return;

  const isNavigation = req.mode === "navigate";

  if (isNavigation) {
    // Network-first for the document so updates land immediately when online,
    // with the cached shell as the offline fallback.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Static assets — cache-first (hashed filenames make this safe), then fill
  // the cache on first fetch.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
