// sw.test.js — tests for the PWA layer (service worker + manifest + index.html).
//
// Run with:  node --test
//
// Scope:
//   1) sw.js behavior — install / activate / fetch router and the four caching
//      strategies. sw.js is written against Service Worker globals (self, caches,
//      fetch, Request, URL). We exercise it WITHOUT a browser by loading the
//      source into a node:vm sandbox with mocked globals (a captured-listener
//      `self`, an in-memory Cache API, a programmable `fetch`, a minimal
//      `Request`, and the real URL). No network, no DOM, no dependencies.
//   2) manifest.json — structural validity + on-disk icon checks.
//   3) index.html — the PWA head tags and the SW registration script.
//
// Determinism: every test builds a fresh sandbox (fresh caches + fresh fetch),
// so there is no shared mutable state and no ordering dependence between tests.
// NO new dependencies, NO build step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const SW_SRC = readFileSync(join(HERE, 'sw.js'), 'utf8');

// ---------------------------------------------------------------------------
// Test doubles for the Service Worker environment.
// ---------------------------------------------------------------------------

/** Minimal Request: stores the bits sw.js inspects (url/method/mode/destination). */
class FakeRequest {
  constructor(input, init = {}) {
    this.url = typeof input === 'string' ? input : input.url;
    this.method = init.method || (input && input.method) || 'GET';
    this.mode = init.mode || (input && input.mode) || 'same-origin';
    this.destination = init.destination || (input && input.destination) || '';
    this.cache = init.cache;
  }
}

/** A Response-like object good enough for clone()/ok/status/type assertions. */
function fakeResponse({ body = 'ok', ok = true, status = 200, type = 'basic' } = {}) {
  const res = { body, ok, status, type, clone() { return fakeResponse({ body, ok, status, type }); } };
  return res;
}

/** An opaque (no-cors) cross-origin response: ok=false, status=0, type 'opaque'. */
function opaqueResponse(body = 'opaque-bytes') {
  return fakeResponse({ body, ok: false, status: 0, type: 'opaque' });
}

/** In-memory Cache API backed by Map(cacheName -> Map(urlKey -> Response)). */
function makeCaches() {
  const store = new Map(); // cacheName -> Map(key -> response)

  const keyOf = (req) => (typeof req === 'string' ? req : req.url);

  function openCache(name) {
    if (!store.has(name)) store.set(name, new Map());
    const map = store.get(name);
    return {
      async match(req) { return map.get(keyOf(req)); },
      async put(req, res) { map.set(keyOf(req), res); },
      async add(req) {
        // mimic the browser: cache.add fetches then stores the response.
        const res = await sandboxFetch(req);
        if (!res || !res.ok) throw new Error('add: bad response for ' + keyOf(req));
        map.set(keyOf(req), res);
      },
      async keys() { return [...map.keys()].map((u) => new FakeRequest(u)); },
      // Real Cache.delete returns Promise<boolean>; mirror that so trimCache's
      // eviction (cache.delete(keys[i])) actually removes entries here.
      async delete(req) { return map.delete(keyOf(req)); },
    };
  }

  // sandboxFetch is injected after construction so cache.add can use the
  // per-test programmable fetch.
  let sandboxFetch = async () => { throw new Error('fetch not set'); };

  const api = {
    async open(name) { return openCache(name); },
    async match(req) {
      for (const map of store.values()) {
        const hit = map.get(keyOf(req));
        if (hit) return hit;
      }
      return undefined;
    },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
    // test helpers (not part of the Cache API):
    _store: store,
    _seed(name, key, res) {
      if (!store.has(name)) store.set(name, new Map());
      store.get(name).set(key, res);
    },
    _setFetch(fn) { sandboxFetch = fn; },
    _has(name, key) { return store.has(name) && store.get(name).has(key); },
    _get(name, key) { return store.has(name) ? store.get(name).get(key) : undefined; },
  };
  return api;
}

/**
 * Build a fresh sandbox, run sw.js in it, and return the captured handlers plus
 * the mocks so tests can program fetch and inspect caches.
 *
 * @param {Function} fetchImpl  programmable fetch(request) -> Promise<Response>
 * @param {string}   origin     value for self.location.origin (same-origin tests)
 */
function loadSW(fetchImpl, origin = 'https://example.com') {
  const handlers = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const caches = makeCaches();
  const fetch = (req) => fetchImpl(req);
  caches._setFetch(fetch);

  const self = {
    location: { origin },
    addEventListener(type, handler) { handlers[type] = handler; },
    async skipWaiting() { calls.skipWaiting += 1; },
    clients: { async claim() { calls.claim += 1; } },
  };

  const sandbox = {
    self,
    caches,
    fetch,
    Request: FakeRequest,
    URL: globalThis.URL,
    console: { warn() {}, log() {}, error() {} }, // silence sw.js logging
  };

  vm.runInNewContext(SW_SRC, sandbox);
  return { handlers, calls, caches, self };
}

/** Synthesize an InstallEvent/ActivateEvent with a capturable waitUntil. */
function makeLifecycleEvent() {
  return {
    _wait: undefined,
    waitUntil(p) { this._wait = p; },
  };
}

/** Synthesize a FetchEvent with a capturable respondWith. */
function makeFetchEvent(request) {
  return {
    request,
    _res: undefined,
    _responded: false,
    respondWith(p) { this._responded = true; this._res = p; },
  };
}

// Derive the cache version from sw.js's CACHE_VERSION literal rather than
// hardcoding it, so a future CACHE_VERSION bump (the no-build cache-bust
// mechanism) never silently breaks this suite. Falls back to 'v?' if the
// literal can't be found, which would make the dependent assertions fail loudly.
const CACHE_VERSION = (SW_SRC.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [, 'v?'])[1];

// Shell URLs precached on install (relative paths resolve to these keys).
const SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  '.',
  'index.html',
  'app.js',
  'photo-worker.js',
  'firebase-config.js',
  'data/days.js',
  'manifest.json',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/apple-touch-icon.png',
];

// ===========================================================================
// INSTALL
// ===========================================================================

test('install precaches every shell URL into the shell cache', async () => {
  const { handlers, caches } = loadSW(async (req) => fakeResponse({ body: req.url }));
  const event = makeLifecycleEvent();

  handlers.install(event);
  await event._wait;

  for (const url of PRECACHE_URLS) {
    assert.ok(caches._has(SHELL_CACHE, url), `expected ${url} to be precached`);
  }
});

test('install calls skipWaiting so the new worker activates immediately', async () => {
  const { handlers, calls } = loadSW(async (req) => fakeResponse({ body: req.url }));
  const event = makeLifecycleEvent();

  handlers.install(event);
  await event._wait;

  assert.equal(calls.skipWaiting, 1);
});

test('install does not abort when one URL fails to precache (others still cached)', async () => {
  const failingUrl = 'app.js';
  const { handlers, caches } = loadSW(async (req) => {
    const key = typeof req === 'string' ? req : req.url;
    if (key === failingUrl) throw new Error('simulated network/forbidden');
    return fakeResponse({ body: key });
  });
  const event = makeLifecycleEvent();

  handlers.install(event);
  await event._wait; // must not reject

  assert.ok(!caches._has(SHELL_CACHE, failingUrl), 'failing URL should be absent');
  for (const url of PRECACHE_URLS.filter((u) => u !== failingUrl)) {
    assert.ok(caches._has(SHELL_CACHE, url), `expected ${url} to still be precached`);
  }
});

// ===========================================================================
// ACTIVATE
// ===========================================================================

test('activate deletes stale caches but keeps the current-version caches', async () => {
  const { handlers, caches } = loadSW(async () => fakeResponse());
  // Seed an old-version cache plus the two current ones.
  caches._seed('app-shell-OLD', 'index.html', fakeResponse());
  caches._seed(SHELL_CACHE, 'index.html', fakeResponse());
  caches._seed(RUNTIME_CACHE, 'x', fakeResponse());

  const event = makeLifecycleEvent();
  handlers.activate(event);
  await event._wait;

  const names = await caches.keys();
  assert.ok(!names.includes('app-shell-OLD'), 'stale cache should be deleted');
  assert.ok(names.includes(SHELL_CACHE), 'current shell cache should remain');
  assert.ok(names.includes(RUNTIME_CACHE), 'current runtime cache should remain');
});

test('activate calls clients.claim to take control of open pages', async () => {
  const { handlers, calls } = loadSW(async () => fakeResponse());
  const event = makeLifecycleEvent();

  handlers.activate(event);
  await event._wait;

  assert.equal(calls.claim, 1);
});

// ===========================================================================
// FETCH ROUTER — interception decisions
// ===========================================================================

test('non-GET requests are not intercepted (no respondWith)', () => {
  const { handlers } = loadSW(async () => fakeResponse());
  const req = new FakeRequest('https://example.com/data/days.js', { method: 'POST' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);

  assert.equal(event._responded, false);
});

test('cross-origin maps/other requests are not intercepted (no respondWith)', () => {
  const { handlers } = loadSW(async () => fakeResponse());
  const req = new FakeRequest('https://maps.google.com/maps?q=tokyo', { mode: 'cors' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);

  assert.equal(event._responded, false);
});

// ===========================================================================
// FETCH ROUTER — same-origin navigations (network-first, index.html fallback)
// ===========================================================================

test('navigation request returns the network response when online', async () => {
  const network = fakeResponse({ body: 'fresh-page' });
  const { handlers } = loadSW(async () => network);
  const req = new FakeRequest('https://example.com/', { mode: 'navigate' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  assert.equal(event._responded, true);
  assert.equal(res.body, 'fresh-page');
});

test('navigation write-back refreshes the cached index.html with the online response', async () => {
  const network = fakeResponse({ body: 'fresh-page' });
  const { handlers, caches } = loadSW(async () => network);
  // Seed a stale shell entry so we can prove it gets overwritten, not just set.
  caches._seed(SHELL_CACHE, 'index.html', fakeResponse({ body: 'stale-shell' }));
  const req = new FakeRequest('https://example.com/', { mode: 'navigate' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  // The visitor still gets the fresh network response...
  assert.equal(res.body, 'fresh-page');
  // ...and the offline-fallback entry ('index.html') is refreshed with a clone
  // of it (sw.js writes under the literal 'index.html' key, not request.url).
  const cached = caches._get(SHELL_CACHE, 'index.html');
  assert.ok(cached, 'shell index.html entry should exist after an online navigation');
  assert.equal(cached.body, 'fresh-page', 'cached shell should be refreshed with the network body');
  assert.notEqual(cached, network, 'cached entry must be a clone, not the live response');
});

test('navigation does NOT write back a non-ok network response', async () => {
  // A 5xx/redirect-to-error page should not poison the offline fallback.
  const errorPage = fakeResponse({ body: 'error-page', ok: false, status: 503 });
  const { handlers, caches } = loadSW(async () => errorPage);
  caches._seed(SHELL_CACHE, 'index.html', fakeResponse({ body: 'good-shell' }));
  const req = new FakeRequest('https://example.com/', { mode: 'navigate' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  // The bad response is still returned to the visitor (network-first)...
  assert.equal(res.body, 'error-page');
  // ...but the good cached shell must be left intact for the offline fallback.
  assert.equal(caches._get(SHELL_CACHE, 'index.html').body, 'good-shell');
});

test('navigation request falls back to cached index.html when offline', async () => {
  const { handlers, caches } = loadSW(async () => { throw new Error('offline'); });
  caches._seed(SHELL_CACHE, 'index.html', fakeResponse({ body: 'cached-shell' }));
  const req = new FakeRequest('https://example.com/', { mode: 'navigate' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  assert.equal(res.body, 'cached-shell');
});

// ===========================================================================
// FETCH ROUTER — data/days.js (network-first for content freshness)
// ===========================================================================

test('data/days.js returns the network response and updates the cache when online', async () => {
  const network = fakeResponse({ body: 'days-v2' });
  const { handlers, caches } = loadSW(async () => network);
  const req = new FakeRequest('https://example.com/data/days.js');
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  assert.equal(res.body, 'days-v2');
  // network-first writes the fresh copy back to the shell cache.
  const cached = caches._get(SHELL_CACHE, 'https://example.com/data/days.js');
  assert.ok(cached, 'fresh days.js should be written to the shell cache');
  assert.equal(cached.body, 'days-v2');
});

test('data/days.js falls back to the cached copy when offline', async () => {
  const { handlers, caches } = loadSW(async () => { throw new Error('offline'); });
  caches._seed(SHELL_CACHE, 'https://example.com/data/days.js', fakeResponse({ body: 'days-cached' }));
  const req = new FakeRequest('https://example.com/data/days.js');
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  assert.equal(res.body, 'days-cached');
});

// ===========================================================================
// FETCH ROUTER — same-origin shell asset (cache-first)
// ===========================================================================

test('shell asset is served from cache without hitting the network when present', async () => {
  let networkHits = 0;
  const { handlers, caches } = loadSW(async () => { networkHits += 1; return fakeResponse({ body: 'from-net' }); });
  caches._seed(SHELL_CACHE, 'https://example.com/app.js', fakeResponse({ body: 'app-cached' }));
  const req = new FakeRequest('https://example.com/app.js');
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  assert.equal(res.body, 'app-cached');
  assert.equal(networkHits, 0, 'cache-first must not hit the network on a cache hit');
});

test('shell asset falls back to the network on a cache miss and populates the cache', async () => {
  const { handlers, caches } = loadSW(async () => fakeResponse({ body: 'net-app' }));
  const req = new FakeRequest('https://example.com/app.js');
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  assert.equal(res.body, 'net-app');
  const cached = caches._get(SHELL_CACHE, 'https://example.com/app.js');
  assert.ok(cached, 'cache-first should populate cache on a miss');
  assert.equal(cached.body, 'net-app');
});

// ===========================================================================
// FETCH ROUTER — cross-origin images (stale-while-revalidate, opaque-aware)
// ===========================================================================

test('cross-origin image returns the cached copy immediately when present', async () => {
  let networkHits = 0;
  const { handlers, caches } = loadSW(async () => { networkHits += 1; return opaqueResponse('new-img'); });
  const url = 'https://upload.wikimedia.org/wave.jpg';
  caches._seed(RUNTIME_CACHE, url, fakeResponse({ body: 'cached-img' }));
  const req = new FakeRequest(url, { mode: 'no-cors', destination: 'image' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  assert.equal(res.body, 'cached-img');
});

test('cross-origin image caches an OPAQUE network response despite ok===false', async () => {
  const { handlers, caches } = loadSW(async () => opaqueResponse('opaque-img'));
  const url = 'https://upload.wikimedia.org/wave.jpg';
  const req = new FakeRequest(url, { mode: 'no-cors', destination: 'image' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  // On a cold cache SWR resolves to the network response...
  assert.equal(res.type, 'opaque');
  // ...and the opaque response must be stored even though ok===false.
  const cached = caches._get(RUNTIME_CACHE, url);
  assert.ok(cached, 'opaque response should be cached');
  assert.equal(cached.type, 'opaque');
});

test('image detected by destination (not just wikimedia host) is intercepted', async () => {
  const { handlers } = loadSW(async () => opaqueResponse());
  const req = new FakeRequest('https://cdn.example.org/photo.jpg', { destination: 'image' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);

  assert.equal(event._responded, true);
});

// ===========================================================================
// RUNTIME CACHE CAP — stale-while-revalidate trims the runtime cache (FIFO)
// ===========================================================================

// The cap lives in sw.js as RUNTIME_MAX_ENTRIES; derive it from the source so a
// future change to the literal doesn't silently desync this suite.
const RUNTIME_MAX = Number(
  (SW_SRC.match(/RUNTIME_MAX_ENTRIES\s*=\s*(\d+)/) || [, '60'])[1],
);

/** Drain pending microtasks so the non-blocking trimCache chain settles. */
async function flushMicrotasks() {
  // staleWhileRevalidate fires `trimCache(...).catch(...)` without awaiting it,
  // so the eviction happens on a detached promise chain. A macrotask turn after
  // the awaited response guarantees that chain (and the awaited cache.delete
  // calls inside trimCache) has fully run before we read keys().
  await new Promise((r) => setTimeout(r, 0));
}

/** Drive one cross-origin image request through the fetch handler and settle it. */
async function driveImage(handlers, url) {
  const req = new FakeRequest(url, { mode: 'no-cors', destination: 'image' });
  const event = makeFetchEvent(req);
  handlers.fetch(event);
  await event._res; // resolves to the (cold-cache) network response
}

/**
 * Drive each URL through the fetch handler in order, letting each put+trim
 * settle deterministically, then return the runtime cache's keys (as URLs).
 */
async function driveImagesAndReadKeys(handlers, caches, urls) {
  for (const url of urls) {
    await driveImage(handlers, url);
    await flushMicrotasks();
  }
  const keys = await (await caches.open(RUNTIME_CACHE)).keys();
  return keys.map((k) => k.url);
}

test('runtime cache evicts oldest entries once it exceeds the cap (FIFO)', async () => {
  // Each request gets a distinct opaque response so distinct URLs => distinct keys.
  const { handlers, caches } = loadSW(async (req) => opaqueResponse('img:' + req.url));
  const N = RUNTIME_MAX + 5; // five over the cap
  const urls = Array.from({ length: N }, (_, i) => `https://cdn.example.org/photo-${i}.jpg`);

  const keys = await driveImagesAndReadKeys(handlers, caches, urls);

  // Capped at exactly RUNTIME_MAX entries.
  assert.equal(keys.length, RUNTIME_MAX, `runtime cache should be capped at ${RUNTIME_MAX}`);
  // The five earliest-inserted URLs were evicted...
  for (const evicted of urls.slice(0, 5)) {
    assert.ok(!keys.includes(evicted), `oldest entry ${evicted} should have been evicted`);
  }
  // ...and the most-recent RUNTIME_MAX remain, in insertion order (FIFO).
  assert.deepEqual(keys, urls.slice(5), 'the newest RUNTIME_MAX entries should remain in order');
});

test('runtime cache exactly at the cap evicts nothing (oldest entry retained)', async () => {
  const { handlers, caches } = loadSW(async (req) => opaqueResponse('img:' + req.url));
  const urls = Array.from({ length: RUNTIME_MAX }, (_, i) => `https://cdn.example.org/exact-${i}.jpg`);

  const keys = await driveImagesAndReadKeys(handlers, caches, urls);

  assert.equal(keys.length, RUNTIME_MAX, 'at exactly the cap, all entries are kept');
  assert.ok(keys.includes(urls[0]), 'the oldest entry must NOT be evicted at exactly the cap');
  assert.deepEqual(keys, urls, 'no reordering or eviction at exactly the cap');
});

test('one-over-cap evicts exactly the single oldest entry (keys[0])', async () => {
  const { handlers, caches } = loadSW(async (req) => opaqueResponse('img:' + req.url));
  const urls = Array.from({ length: RUNTIME_MAX + 1 }, (_, i) => `https://cdn.example.org/one-over-${i}.jpg`);

  const keys = await driveImagesAndReadKeys(handlers, caches, urls);

  assert.equal(keys.length, RUNTIME_MAX, `one over the cap trims back to ${RUNTIME_MAX}`);
  assert.ok(!keys.includes(urls[0]), 'the single oldest entry (keys[0]) must be evicted');
  assert.ok(keys.includes(urls[1]), 'the second-oldest entry must be retained');
  assert.deepEqual(keys, urls.slice(1), 'exactly one entry (the oldest) is dropped');
});

test('a cache.delete rejection during trim does not break the SWR response path', async () => {
  // sw.js fires `trimCache(...).catch(() => {})` so an eviction failure (e.g. a
  // storage error on cache.delete) must never reject the response. Force the
  // runtime cache's delete to reject and confirm the response still resolves.
  const { handlers, caches } = loadSW(async (req) => opaqueResponse('img:' + req.url));
  const realOpen = caches.open.bind(caches);
  caches.open = async (name) => {
    const cache = await realOpen(name);
    if (name === RUNTIME_CACHE) {
      cache.delete = async () => { throw new Error('storage failure'); };
    }
    return cache;
  };

  // Push past the cap so trimCache actually attempts a delete on each call.
  const N = RUNTIME_MAX + 3;
  const urls = Array.from({ length: N }, (_, i) => `https://cdn.example.org/reject-${i}.jpg`);
  for (const url of urls) {
    const req = new FakeRequest(url, { mode: 'no-cors', destination: 'image' });
    const event = makeFetchEvent(req);
    handlers.fetch(event);
    // The key assertion: the response resolves normally despite delete rejecting.
    const res = await assert.doesNotReject(event._res).then(() => event._res);
    assert.equal(res.body, 'img:' + url, 'SWR still returns the network response');
    await flushMicrotasks();
  }

  // Trim could not evict (delete rejects), so every entry is retained — proving
  // the failure was swallowed rather than aborting the put/response.
  const keys = (await (await caches.open(RUNTIME_CACHE)).keys()).map((k) => k.url);
  assert.equal(keys.length, N, 'no eviction occurred because delete rejected');
});

// ===========================================================================
// FETCH ROUTER — cross-origin Google Fonts (stale-while-revalidate)
// ===========================================================================

test('cross-origin Google Fonts request is intercepted (stale-while-revalidate)', async () => {
  const { handlers, caches } = loadSW(async () => fakeResponse({ body: 'font-bytes' }));
  const url = 'https://fonts.gstatic.com/s/manrope.woff2';
  const req = new FakeRequest(url, { mode: 'cors', destination: 'font' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  assert.equal(event._responded, true);
  assert.equal(res.body, 'font-bytes');
  assert.ok(caches._get(RUNTIME_CACHE, url), 'font response should be cached');
});

// ===========================================================================
// FETCH ROUTER — Firebase modular SDK (gstatic CDN, stale-while-revalidate)
//
// The auth gate loads the Firebase SDK from www.gstatic.com/firebasejs/<v>/...
// via a dynamic import(). sw.js runtime-caches it so the gate boots offline
// after the first online load. Note: fonts use a DIFFERENT host
// (fonts.gstatic.com) — only the /firebasejs/ path on www.gstatic.com routes
// here, so we also assert a non-matching gstatic path is NOT intercepted.
// ===========================================================================

test('Firebase SDK request (www.gstatic.com/firebasejs/) is runtime-cached (stale-while-revalidate)', async () => {
  const { handlers, caches } = loadSW(async () => fakeResponse({ body: 'firebase-sdk-bytes' }));
  const url = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
  const req = new FakeRequest(url, { mode: 'cors', destination: 'script' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  const res = await event._res;

  assert.equal(event._responded, true, 'SDK request should be intercepted');
  assert.equal(res.body, 'firebase-sdk-bytes');
  assert.ok(caches._get(RUNTIME_CACHE, url), 'Firebase SDK response should be runtime-cached for offline boot');
});

test('a non-/firebasejs/ path on www.gstatic.com is NOT intercepted by the Firebase route', () => {
  const { handlers } = loadSW(async () => fakeResponse());
  // Same host, different path → falls through to "everything else" (not handled).
  const req = new FakeRequest('https://www.gstatic.com/other/thing.js', { mode: 'cors', destination: 'script' });
  const event = makeFetchEvent(req);

  handlers.fetch(event);
  assert.equal(event._responded, false, 'only the /firebasejs/ path should route to the SDK cache');
});

test('CACHE_VERSION is v45 (exported downscale-router seam — app.js shell change)', () => {
  // sw.test.js derives CACHE_VERSION from the sw.js literal; this pins the
  // expected value so an accidental revert of the bump fails loudly.
  // app.js gained the exported buildDownscaleRouter factory (a precached shell
  // file changed), so CACHE_VERSION must bump. This task authored v43, then
  // reconciled to v44, then to v45 — each prior value consumed by a sibling
  // (harden-exif v43, fix-modal-stack-overlaps v44) merging mid-flight in the
  // parallel v2.2 chain. Next free version re-derived from main at merge time.
  assert.equal(CACHE_VERSION, 'v45');
});

// ===========================================================================
// MANIFEST — structural validity + on-disk icons
// ===========================================================================

const MANIFEST_SRC = readFileSync(join(HERE, 'manifest.json'), 'utf8');

test('manifest.json is valid JSON', () => {
  assert.doesNotThrow(() => JSON.parse(MANIFEST_SRC));
});

test('manifest has all required install fields', () => {
  const m = JSON.parse(MANIFEST_SRC);
  for (const field of ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color']) {
    assert.ok(m[field], `manifest missing required field: ${field}`);
  }
});

test('manifest start_url and scope are relative (no leading slash) for the Pages subpath', () => {
  const m = JSON.parse(MANIFEST_SRC);
  // The site is served from https://<user>.github.io/japan_trip/ — an absolute
  // "/" would point at the domain root and break install/scope. Both must be ".".
  assert.ok(!m.start_url.startsWith('/'), `start_url must be relative, got "${m.start_url}"`);
  assert.ok(!m.scope.startsWith('/'), `scope must be relative, got "${m.scope}"`);
  assert.equal(m.start_url, '.', 'start_url should be "." (document root, subpath-safe)');
  assert.equal(m.scope, '.', 'scope should be "." (subpath-safe)');
});

test('manifest has a non-empty icons array', () => {
  const m = JSON.parse(MANIFEST_SRC);
  assert.ok(Array.isArray(m.icons));
  assert.ok(m.icons.length > 0, 'icons must be non-empty');
});

test('every manifest icon file exists on disk, is the declared type, and is a real PNG', () => {
  const m = JSON.parse(MANIFEST_SRC);
  for (const icon of m.icons) {
    assert.equal(icon.type, 'image/png', `icon ${icon.src} declares non-PNG type`);
    let bytes;
    assert.doesNotThrow(() => { bytes = readFileSync(join(HERE, icon.src)); }, `icon file missing: ${icon.src}`);
    // PNG magic bytes: 89 50 4E 47 (\x89 P N G).
    assert.equal(bytes[0], 0x89, `${icon.src} missing PNG magic byte 0`);
    assert.equal(bytes[1], 0x50, `${icon.src} missing PNG magic byte P`);
    assert.equal(bytes[2], 0x4e, `${icon.src} missing PNG magic byte N`);
    assert.equal(bytes[3], 0x47, `${icon.src} missing PNG magic byte G`);
  }
});

test('manifest declares at least one maskable icon', () => {
  const m = JSON.parse(MANIFEST_SRC);
  const hasMaskable = m.icons.some((i) => typeof i.purpose === 'string' && i.purpose.includes('maskable'));
  assert.ok(hasMaskable, 'expected an icon with purpose containing "maskable"');
});

// ===========================================================================
// INDEX.HTML — PWA head tags + SW registration
// ===========================================================================

const INDEX_SRC = readFileSync(join(HERE, 'index.html'), 'utf8');

test('index.html links the web app manifest', () => {
  assert.match(INDEX_SRC, /<link\s+rel="manifest"\s+href="manifest\.json"/);
});

// Cross-file invariant (redesign-gallery-mosaic): app.js's assignTileSpans credit
// math (CREST_COST/PANO_COST/GALLERY_COLS=3) is derived from a THREE-column grid.
// If the CSS column count silently changed, the hole-freeness proof would rot.
// Pin the coupling: the .reminisce-gallery rule must declare repeat(3, 1fr).
test('index.html .reminisce-gallery grid is 3 columns (matches app.js GALLERY_COLS)', () => {
  const rule = INDEX_SRC.match(/\.reminisce-gallery\s*\{[^}]*\}/);
  assert.ok(rule, 'could not find the .reminisce-gallery CSS rule');
  assert.match(rule[0], /grid-template-columns:\s*repeat\(3,\s*1fr\)/,
    '.reminisce-gallery must be a 3-column grid (repeat(3, 1fr))');
});

test('index.html theme-color meta matches the manifest theme_color', () => {
  const m = JSON.parse(MANIFEST_SRC);
  const match = INDEX_SRC.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/);
  assert.ok(match, 'index.html missing <meta name="theme-color">');
  assert.equal(match[1], m.theme_color, 'theme-color must match manifest theme_color');
});

test('index.html declares an apple-touch-icon pointing at an existing PNG', () => {
  const match = INDEX_SRC.match(/<link\s+rel="apple-touch-icon"\s+href="([^"]+)"/);
  assert.ok(match, 'index.html missing apple-touch-icon link');
  const iconPath = match[1];
  let bytes;
  assert.doesNotThrow(() => { bytes = readFileSync(join(HERE, iconPath)); }, `apple-touch-icon missing: ${iconPath}`);
  assert.equal(bytes[0], 0x89, 'apple-touch-icon is not a PNG');
});

test('index.html registers a service worker behind a feature check', () => {
  assert.match(INDEX_SRC, /'serviceWorker'\s+in\s+navigator/);
  assert.match(INDEX_SRC, /navigator\.serviceWorker\.register\(/);
});

test('service worker registration path is relative (works under the Pages subpath)', () => {
  const match = INDEX_SRC.match(/navigator\.serviceWorker\.register\(\s*'([^']+)'/);
  assert.ok(match, 'could not find the register() call');
  const path = match[1];
  assert.ok(!path.startsWith('/'), `registration path must be relative, got "${path}"`);
});

// The login form has no `action`, so a native submit (Enter) before app.js's JS
// guard installs would GET index.html?password=<typed>, leaking the one shared
// secret into the URL/history/referrer/SW navigation fetch. The static
// onsubmit="return false" neutralizes that the instant the HTML parses — pin it
// so a future markup edit can't silently drop the guard. (Belt; the JS-side
// installSubmitGuard is the suspenders, covered behaviorally in app.test.js.)
test('login form carries the synchronous onsubmit="return false" native-submit guard', () => {
  const formTag = INDEX_SRC.match(/<form[^>]*id="login-form"[^>]*>/);
  assert.ok(formTag, 'could not find the #login-form opening tag');
  assert.match(
    formTag[0],
    /onsubmit="return false"/,
    'the #login-form must hard-block native submission (no password leak into the URL)',
  );
});
