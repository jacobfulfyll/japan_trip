# Japan Trip Companion

Data-driven static site for an 18-day Japan trip — a daily companion for 4 travelers (2 couples). Deployed via GitHub Pages. No build step.

## Trip Status

**Flights booked: June 16 - July 3, 2026 (in/out of Tokyo).**

The site renders from `data/days.js`. **All 18 days are authored (Jun 16 – Jul 3), contiguous, no gap.** The trip content is complete end-to-end: Tokyo (Jun 16–21), Hakone (Jun 22–23), Kyoto and the return leg (Jun 24 – Jul 3). `dayNumber` is derived from `TRIP.start` (Jun 16 = Day 1), so the days run Day 1 (Jun 16) → Day 18 (Jul 3). The scaffold still degrades gracefully if a day is ever removed (absent days return `null`, no crash).

## Tech Stack

- Static site, **no build step**: plain HTML/CSS + ES modules served as files.
- Content lives in a single data module (`data/days.js`); `app.js` validates and renders it.
- Tests via Node's built-in runner (`node:test`) — **no npm, no dependencies**.
- Fonts: Manrope + Playfair Display (Google Fonts). Theme: ukiyo-e / washi / Great Wave.
- **PWA**: installable + works offline via a hand-written service worker (`sw.js`) + `manifest.json` — no PWA tooling/build.
- GitHub Pages deployment.

## Key Files

| File | Purpose |
|------|---------|
| `data/days.js` | **Single source of trip content** — ES module exporting `TRIP` + `DAYS`. Editing the trip = editing this file. |
| `app.js` | Render pipeline: imports `data/days.js`, validates (warn-and-skip), deep-freezes, derives `dayNumber`, exposes the day API + `renderDay` + the pre-trip home (`renderOverview`: countdown + tappable 18-day index) + the date/time-aware `mountApp` (clock-driven landing, prev/next nav, evening "Prep for tomorrow"). |
| `index.html` | Slim shell — ukiyo-e theme CSS + `<main id="app-root">` + `<script type="module" src="app.js">` + PWA wiring (manifest link, iOS meta, SW registration). |
| `sw.js` | Hand-written service worker (no build step) — precaches the app shell into `app-shell-v<CACHE_VERSION>` (currently `v23`), runtime-caches photos/fonts into `runtime-v<CACHE_VERSION>` (FIFO-capped at `RUNTIME_MAX_ENTRIES`, currently 60). Bump `CACHE_VERSION` when shell files change. `test.html` is intentionally NOT precached (dev tool, network-only). |
| `manifest.json` | Web app manifest (install-to-home-screen). Relative `start_url`/`scope` for the `/japan_trip/` Pages subpath. Icons live in `img/`. |
| `app.test.js` | `node:test` cases for the data, render, date/time-nav, time-travel, pre-trip-home, collapsible day-parts, structured-transit, rec transit-alternative pill, and reminisce-gallery/lightbox layers (**312 total with `sw.test.js`**). Run with `node --test`. |
| `sw.test.js` | `node:test` cases for the service worker (vm-sandboxed) + manifest/index.html PWA wiring. |
| `test.html` | Standalone on-theme dev page for the time-travel test mode — datetime picker, 4 trip-scenario presets, "Launch app in this moment" (opens `index.html?now=…`), "Clear override". Served over HTTP (`http://localhost:8000/test.html`); NOT precached (dev tool only). |
| `README.md` | How to edit the trip (schema + example), the `app.js` API, how to preview, deploy. |
| `CHANGELOG.md` | Keep-a-Changelog history. |
| `deploy-pages.yml` | GitHub Actions workflow for Pages deployment. |

## Commands

```bash
node --test                 # run the test suite (no npm needed)
python3 -m http.server 8000 # preview locally, then open http://localhost:8000
```

ES modules require an HTTP origin — opening `index.html` via `file://` will NOT load the modules.

## Deployment

Pushes to `main` trigger automatic GitHub Pages deployment via `deploy-pages.yml`.
Repo: https://github.com/jacobfulfyll/japan_trip

Note: `deploy-pages.yml` lives at repo root (not `.github/workflows/`). The entire repo root is uploaded as the Pages artifact — **all files are publicly served** (keep secrets out of the repo).

## Architecture

Data-driven, single render pipeline:

```
data/days.js   ← TRIP + DAYS (content; the only file you edit to change the trip)
     │ import
     ▼
app.js         ← validate → deep-freeze → derive dayNumber → public API + mountApp() (clock-driven landing + nav)
     │ <script type="module">
     ▼
index.html     ← slim shell: theme CSS + <main id="app-root"> (render target)
```

### Data schema (`data/days.js`)

```js
export const TRIP = { title, start, end, travelers: [..], eveningWindow: { startHour, endHour } };
export const DAYS = [{
  date,                       // ISO "YYYY-MM-DD"; dayNumber is DERIVED (do NOT author it)
  base, title, intro,
  spend,                      // optional
  photos: [{ url, alt, credit }],          // [] = none
  lodging: { name, address, mapUrl, coords?, breakfast? } | null,
  prep: [".."],               // free-text; powers the evening "Prep for tomorrow"
  dayParts: { morning?, afternoon?, evening? },  // optional; one-line summaries for collapsible section headers (only non-empty buckets)
  plan: [{
    time?, tag, title, note?, mapUrl?, coords?, reserved?,   // reservations = reserved:true
    transit?: TransitLeg & { minutes?, transfer?: TransitLeg },  // optional; only for tag:'transit' items — renders a structured line / stops / minutes block
    recommendations: [{ name, pros: [".."], con, mapUrl?, coords?, address?,
                        transit?: TransitLeg & { minutes, transfer?: TransitLeg } }], // MAX 4; transit? for recs whose walk from anchor exceeds 1.5km
                        // GOTCHA: for a NON-walkable transfer rec (airport→city, long-haul), OMIT `coords`.
                        // With coords, the walk-distance origin falls back to lodging and prints a misleading
                        // "N min from <hotel>" line on a leg that travels TO the hotel. Without coords the
                        // transit pill renders standalone (the correct display for transfers).
                        // SAME GOTCHA on a TRANSITION/CHECKOUT DAY: `day.lodging` is the NIGHT's lodging, so a
                        // first-of-day meal/coffee rec (no preceding plan item with coords → falls back to lodging)
                        // anchors to a lodging that may be far away (e.g. Jun 22 breakfast in Akasaka but that
                        // night's lodging is Senkyoro in Hakone → "999 min from Senkyoro"). OMIT `coords` on those
                        // recs so the card renders standalone; keep `mapUrl`. Recs with a real preceding anchor
                        // (e.g. Jun 23 lunch after the Open-Air Museum) keep coords and show a correct distance.
  }],
}];
// TransitLeg = { mode: 'bus'|'train'|'subway', line?, from, to }
// Tags: meal | transit | sight | checkin | reservation | rest | bar | spa | checkout
// MULTI-LEG GOTCHA: for a `transfer`, the PRIMARY leg's `to` must be the
// INTERCHANGE station (= transfer.from), NOT the final destination — the renderer
// draws stops as `from → to → transfer.to`, so authoring the destination on the
// primary `to` prints a duplicated terminal stop (e.g. "Akasaka → Tsukiji → Tsukiji").
// Author per-leg `minutes` on BOTH legs (they sum). See the Universal→Nishikujo→Osaka-Namba
// leg for the canonical shape; an invariant test in app.test.js guards every multi-leg item.
```

Conventions baked into the data: reservations are plan items with `reserved:true` (no separate field); there is **no `status` field** — a sparse day = empty `plan`/`photos`. See `README.md` for an annotated example and field-by-field docs.

### `app.js` public API (downstream screen tasks build on this)

- `getTrip()` → frozen `TRIP`.
- `getDays()` → fresh array of validated, date-sorted, deeply-frozen days (each with derived `dayNumber`).
- `getDay(iso)` → the day for an ISO date, or `null` if absent (e.g. a date outside the trip window). The trip is now fully authored, so every in-window date resolves to a day.
- `getDayByNumber(n)` → day by derived `dayNumber`, or `null` (non-finite input → `null`).
- `renderDay(day, framingName = 'plan')` → returns `{ node, start, stop }`. Mount `node`, call `start()` to begin the hero slideshow, call `stop()` before discarding. Framings: `'anticipation'`, `'plan'`, `'reminisce'`. Null/absent day renders a placeholder. The plan list is split into three collapsible `<section class="day-part">` blocks (Morning / Afternoon / Evening) — all collapsed by default; click a header to expand. Non-empty buckets only; `day.dayParts` summaries appear in the collapsed header.
  - **Reminisce framing ("Engawa Scroll")** is distinct: it **drops the hero slideshow**, wraps the header in a blue "memory frame" (`.reminisce-frame`, no sepia/amber tint), and flows into a capped masonry **photo gallery** (`buildReminisceGallery`, ≤ `REMINISCE_GALLERY_MAX = 12` thumbnails as `<button>`s). Tapping a thumbnail opens a swipeable full-screen **lightbox** (`buildLightbox`: CSS scroll-snap track + live counter + Esc/arrow keys + focus trap) that **mounts on `document.body`** when opened — NOT inside the day view — to escape `.day-view`'s `backdrop-filter`/`overflow:hidden` containing block; `stop()` tears it down. The gallery's photo source (`reminisceGalleryPhotos`) is the day's authored `day.photos` (the same set that feeds the hero on non-reminisce framings) — this is the seam the Firebase v2 `reminisce-photo-gallery` task extends with travelers' uploaded photos. Days with no photos show a graceful empty-state note.
- `mountApp(rootEl)` → **the bootstrap mount entry point.** Picks the landing view from the clock (`pickLandingView`), mounts it, and wires the day-nav bar (Home / prev / position / next) + evening "Prep for tomorrow" button. Returns a controller `{ go(index), toIso(iso), toOverview(), destroy() }`. `go`/`toIso` are clamped to the trip window; `toOverview()` re-mounts the 18-day overview from any day view (same code path as the initial pre-trip overview, fresh `daysUntil` per call); `destroy()` stops the active slideshow and clears the root. This is what `index.html` boots — `renderInto` is no longer the bootstrap path.
- `renderInto(rootEl, day?, framing?)` → mounts a *single* day view (defaults to Jun 24, `'plan'`). Stops any prior view's slideshow before mounting. **Retained for backward compatibility / standalone use**, but `mountApp` is the live entry point.
- Date/time-aware navigation (date-time-aware-navigation task):
  - `frameForDay(day, now = getNow())` → `'anticipation'` (future) / `'plan'` (today) / `'reminisce'` (past), by **local calendar day** (accepts a day object or ISO string; bad input → `'plan'`).
  - `pickLandingView(now = getNow())` → `{ view:'overview', day:null, daysUntil }` before the trip, `{ view:'day', day, framing }` during/after.
  - `isEveningWindow(now, window = getTrip().eveningWindow)` → boolean; the window **wraps midnight** (`hour >= startHour || hour < endHour`; default 21→4).
  - `tripWindowDates(trip = getTrip())` → ordered ISO array of every trip day (18 days Jun 16–Jul 3); `[]` on an inverted/unparseable window.
  - `getNow()` / `setNow(fn|null)` → the clock seam. **All "now" reads go through `getNow()`** so the clock is overridable (the time-travel test mode and tests pin it). `getNow()` degrades to the wall clock if the provider throws or returns a non-Date. `setNow(null)` restores.
- Time-travel test mode (time-travel-test-mode task):
  - `parseNowOverride(value)` → parses a datetime-local string (or any `new Date()`-parseable string) into a valid `Date`, or `null` if unparseable. Local-time parse is intentional.
  - `resolveNowOverride()` → reads the override from URL param `?now` (wins) then `localStorage` key `jt:now`, pins the clock via `setNow()` when one is valid, and returns the active override `Date` or `null`. **Inert by default** — no override means the real device clock is used. Clear tokens (`?now=clear`, `off`, `real`, `reset`, empty) wipe the stored override and restore the real clock. Node-safe (guarded on `typeof window`). Called once at module load; `buildTimeTravelBanner()` (internal) renders the active-override indicator in `index.html`.
- Pre-trip home (trip-overview-home task):
  - `renderOverview(daysUntil, onEnter)` → builds the pre-trip **home screen** and returns `{ node, start, stop }` (start/stop are no-ops — no slideshow). The `{view:'overview'}` landing descriptor maps here. It renders a **live countdown** with three states off `getNow()` (before: "N days until the trip"; during: "The adventure is underway."; after: "The adventure is complete.") plus a **tappable index of all 18 trip days** — each row shows Day#, date, city/region, and a "Planned"/"TBD" status pill; tapping a row calls `onEnter(iso)` (wired to `mountApp`'s `toIso`) to navigate into that day. With the trip now fully authored, every row resolves from `day.base` and shows "Planned". Exported for tests.
- `buildValidatedDays(days, trip)` → exported for tests. (`deriveDayNumber` is internal — not exported.)
- Pure helpers exported for testing: `haversineMeters(a, b)`, `safeUrl(url)`, `nearestPrecedingCoords(plan, index, lodging)`, `bucketPlanByDayPart(plan)` (partitions a plan array into `{ morning, afternoon, evening }` buckets; each item carries `indexInPlan` for cross-bucket walking-distance threading).

Returns are **deeply frozen and copy-safe** — callers cannot corrupt shared module state.

## Conventions

- **No build step, no dependencies.** Keep it plain HTML/CSS/ES modules.
- **Bump `CACHE_VERSION` in `sw.js` whenever you change a precached shell file** (index.html, app.js, data/days.js, manifest, icons). With no build step this is the only cache-busting mechanism — skip it and installed users get stale files until the old cache happens to evict. `sw.test.js` derives the cache version from `sw.js`'s `CACHE_VERSION` literal at test time, so a bump in `sw.js` alone is sufficient — no lockstep edit needed.
  - **Parallel-branch collision:** `CACHE_VERSION` is a single global, so two tasks that branch from the same `main` will both bump it to the *same* next value (e.g. both v18→v19). The second one merged must re-reconcile to the *next free* version (v19→v20) — otherwise its shell change deploys under a `CACHE_VERSION` that already shipped, and users who cached the first deploy never re-precache it (stale assets). When running tasks in parallel, check `main`'s current `CACHE_VERSION` at merge time, not at branch time.
- All trip data lives in `data/days.js`; editing a day should stay a localized data edit.
- Render is **XSS-safe by construction**: data reaches the DOM via `textContent` / `createElement` only — never `innerHTML` with interpolated data. Preserve this in downstream screens.
- When wiring data URLs (`photos[].url`, `mapUrl`) into `href`/`src` in screen tasks (and especially once v2 adds user-uploaded photos), validate the scheme through `safeUrl()` (rejects `javascript:`/`data:`/etc., allows http(s) + relative) and add `rel="noopener noreferrer"` on external links. **Gotcha:** `safeUrl` strips ASCII tab/LF/CR *before* the scheme check — the WHATWG URL parser strips those characters, so `java\tscript:` would otherwise re-form into a live `javascript:` href. Keep that stripping if you touch `safeUrl`.
- Validation is non-fatal: malformed/absent days warn-and-skip; the site must always render whatever is valid (partial-trip safe).
- **Read "now" only through `getNow()`** — never call `new Date()` directly in navigation/landing/time-of-day logic. The clock seam (`getNow`/`setNow`) is the single override point time-travel-test-mode and unit tests depend on; a stray `new Date()` silently bypasses pinned/overridden time. Compare days by **local calendar day** (via `localISODate`/`dayDelta`), not raw timestamps.
- CSS classes use kebab-case; the ukiyo-e theme tokens live in `:root` in `index.html`.
- Tests are dependency-free (`node:test` + `node:assert/strict`). Pure logic (e.g. `haversineMeters`, `safeUrl`) is unit-tested directly. Render functions (`renderDay`) are tested with a small hand-rolled DOM stub in `app.test.js` (no jsdom) — reuse that stub for downstream screens; real-browser behavior (crossfade, layout) is covered by the VERIFY-APP stage, not unit tests.

## Known Issues

_None._
