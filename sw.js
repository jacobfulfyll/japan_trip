// sw.js — hand-written service worker for the Japan trip companion (no build step).
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ MAINTAINER: bump CACHE_VERSION whenever you ship a change to any precached │
// │ shell file (index.html, app.js, data/days.js, manifest, icons). This is    │
// │ the cache-busting mechanism for this no-build site — the old caches are    │
// │ deleted on activate, so a new version forces fresh shell files to install. │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Fetch router (see handlers below):
//   - non-GET                  → not intercepted (pass through)
//   - same-origin navigations  → network-first, fall back to cached index.html
//   - same-origin data/days.js → network-first (content freshness), cache fallback
//   - same-origin app shell    → cache-first, fall back to network
//   - cross-origin images      → stale-while-revalidate (cache viewed hero photos)
//   - cross-origin Google Fonts→ stale-while-revalidate
//   - everything else (maps…)  → not intercepted (pass through)
//
// Every handler is wrapped defensively: any error falls back to a plain
// fetch(request) so a service-worker bug can never block the page.

const CACHE_VERSION = 'v20';
const SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
const EXPECTED_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

// Cap on entries kept in the runtime (photo/font) cache. Without a build step
// the runtime cache would otherwise grow unbounded across a long trip.
const RUNTIME_MAX_ENTRIES = 60;

// App-shell files to precache. Relative paths resolve against the SW scope, so
// this works both at the domain root and under the GitHub Pages subpath
// (/japan_trip/). '.' is the document root (serves index.html).
const PRECACHE_URLS = [
  '.',
  'index.html',
  'app.js',
  'data/days.js',
  'manifest.json',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/apple-touch-icon.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ---------------------------------------------------------------------------
// Install — precache the app shell, then take over immediately.
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Add individually so one missing/forbidden URL can't fail the whole
      // install (addAll is all-or-nothing).
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (err) {
            console.warn('[sw] precache failed for', url, err);
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

// ---------------------------------------------------------------------------
// Activate — drop caches from older versions, then claim open clients.
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !EXPECTED_CACHES.includes(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// ---------------------------------------------------------------------------
// Fetch router
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever handle GET — let POST/PUT/etc. hit the network untouched.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return; // unparseable URL — let the browser handle it
  }

  const sameOrigin = url.origin === self.location.origin;

  // 1) Same-origin navigations → network-first with index.html fallback.
  if (sameOrigin && request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  if (sameOrigin) {
    // 2) data/days.js → network-first for content freshness.
    if (url.pathname.endsWith('/data/days.js')) {
      event.respondWith(networkFirst(request, SHELL_CACHE));
      return;
    }
    // 3) Other same-origin shell assets → cache-first.
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // 4) Cross-origin images → stale-while-revalidate (cache viewed hero photos).
  if (request.destination === 'image' || url.hostname === 'upload.wikimedia.org') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // 5) Cross-origin Google Fonts → stale-while-revalidate.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // 6) Everything else (maps.google.com, etc.) → not intercepted.
});

// ---------------------------------------------------------------------------
// Strategy handlers — each falls back to fetch(request) on any error so a SW
// bug never blocks the page.
// ---------------------------------------------------------------------------

/** Network-first; on offline/error fall back to cached index.html. */
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    // Refresh the cached shell entry opportunistically.
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('index.html', response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached =
      (await caches.match('index.html')) || (await caches.match('.'));
    if (cached) return cached;
    return fetch(request); // last-ditch (will likely fail offline, but never throws here)
  }
}

/** Network-first; update cache on success, fall back to cache when offline. */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return fetch(request);
  }
}

/** Cache-first; fall back to network and populate the cache on miss. */
async function cacheFirst(request, cacheName) {
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return fetch(request);
  }
}

/**
 * Trim a cache to at most `max` entries, evicting oldest-first (FIFO). The
 * Cache API returns keys() in insertion order, so the leading entries are the
 * oldest — no timestamps needed.
 */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) {
    await cache.delete(keys[i]);
  }
}

/**
 * Stale-while-revalidate: serve cache immediately if present, refresh in the
 * background. Handles opaque (no-cors) responses — they have status 0 / type
 * 'opaque', so we cache any response we receive rather than gating on .ok.
 */
async function staleWhileRevalidate(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const network = fetch(request)
      .then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          cache.put(request, response.clone()).catch(() => {});
          trimCache(cacheName, RUNTIME_MAX_ENTRIES).catch(() => {});
        }
        return response;
      })
      .catch(() => undefined);
    return cached || (await network) || fetch(request);
  } catch {
    return fetch(request);
  }
}
