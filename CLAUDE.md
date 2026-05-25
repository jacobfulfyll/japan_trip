# Japan Trip Companion

Data-driven static site for a 16-day Japan trip — a daily companion for 4 travelers (2 couples). Deployed via GitHub Pages. No build step.

## Trip Status

**Flights booked: June 16 - July 3, 2026 (in/out of Tokyo).**

The site renders from `data/days.js`. **10 days are authored (Jun 24 – Jul 3).** The **Jun 16–23** leg (travel Jun 16–17, Tokyo Jun 17–22, Hakone Jun 22–24) is not in the data yet — it's owed by a friend and gets added later. The scaffold renders the partial set gracefully (absent days return `null`, no crash). `dayNumber` is derived from `TRIP.start` (Jun 16 = Day 1), so authored days are Day 9 → Day 18.

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
| `sw.js` | Hand-written service worker (no build step) — precaches the app shell into `app-shell-v<CACHE_VERSION>` (currently `v3`), runtime-caches photos/fonts into `runtime-v<CACHE_VERSION>`. Bump `CACHE_VERSION` when shell files change. `test.html` is intentionally NOT precached (dev tool, network-only). |
| `manifest.json` | Web app manifest (install-to-home-screen). Relative `start_url`/`scope` for the `/japan_trip/` Pages subpath. Icons live in `img/`. |
| `app.test.js` | 174 `node:test` cases for the data, render, date/time-nav, time-travel, and pre-trip-home layers (204 total with `sw.test.js`). Run with `node --test`. |
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
  plan: [{
    time?, tag, title, note?, mapUrl?, coords?, reserved?,   // reservations = reserved:true
    recommendations: [{ name, pros: [".."], con, mapUrl?, coords?, address? }],  // MAX 4 per item
  }],
}];
```

Conventions baked into the data: reservations are plan items with `reserved:true` (no separate field); there is **no `status` field** — a sparse day = empty `plan`/`photos`. See `README.md` for an annotated example and field-by-field docs.

### `app.js` public API (downstream screen tasks build on this)

- `getTrip()` → frozen `TRIP`.
- `getDays()` → fresh array of validated, date-sorted, deeply-frozen days (each with derived `dayNumber`).
- `getDay(iso)` → the day for an ISO date, or `null` if absent (e.g. the Jun 16–23 gap).
- `getDayByNumber(n)` → day by derived `dayNumber`, or `null` (non-finite input → `null`).
- `renderDay(day, framingName = 'plan')` → returns `{ node, start, stop }`. Mount `node`, call `start()` to begin the hero slideshow, call `stop()` before discarding. Framings: `'anticipation'`, `'plan'`, `'reminisce'`. Null/absent day renders a placeholder.
- `mountApp(rootEl)` → **the bootstrap mount entry point.** Picks the landing view from the clock (`pickLandingView`), mounts it, and wires the prev/next nav bar + evening "Prep for tomorrow" button. Returns a controller `{ go(index), toIso(iso), destroy() }`. `go`/`toIso` are clamped to the trip window; `destroy()` stops the active slideshow and clears the root. This is what `index.html` boots — `renderInto` is no longer the bootstrap path.
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
  - `renderOverview(daysUntil, onEnter)` → builds the pre-trip **home screen** and returns `{ node, start, stop }` (start/stop are no-ops — no slideshow). The `{view:'overview'}` landing descriptor maps here. It renders a **live countdown** with three states off `getNow()` (before: "N days until the trip"; during: "The adventure is underway."; after: "The adventure is complete.") plus a **tappable index of all 18 trip days** — each row shows Day#, date, city/region, and a "Planned"/"TBD" status pill; tapping a row calls `onEnter(iso)` (wired to `mountApp`'s `toIso`) to navigate into that day. The unauthored Jun 16–23 leg reads region hints from an in-app `UNAUTHORED_REGIONS` map (data/days.js is the authoritative source; once those days are authored, `day.base` wins and the map entries become dead — drop them then). Exported for tests.
- `buildValidatedDays(days, trip)` → exported for tests. (`deriveDayNumber` is internal — not exported.)
- Pure helpers exported for testing: `haversineMeters(a, b)`, `formatWalk(meters)`, `safeUrl(url)`, `nearestPrecedingCoords(plan, index, lodging)`.

Returns are **deeply frozen and copy-safe** — callers cannot corrupt shared module state.

## Conventions

- **No build step, no dependencies.** Keep it plain HTML/CSS/ES modules.
- **Bump `CACHE_VERSION` in `sw.js` whenever you change a precached shell file** (index.html, app.js, data/days.js, manifest, icons). With no build step this is the only cache-busting mechanism — skip it and installed users get stale files until the old cache happens to evict. **Gotcha:** `sw.test.js` currently hardcodes the expected cache-name literals (`app-shell-v<N>`/`runtime-v<N>`), so a `CACHE_VERSION` bump also requires updating those literals in lockstep or ~9 SW tests fail (see backlog `sw-test-cache-version-coupling`).
- All trip data lives in `data/days.js`; editing a day should stay a localized data edit.
- Render is **XSS-safe by construction**: data reaches the DOM via `textContent` / `createElement` only — never `innerHTML` with interpolated data. Preserve this in downstream screens.
- When wiring data URLs (`photos[].url`, `mapUrl`) into `href`/`src` in screen tasks (and especially once v2 adds user-uploaded photos), validate the scheme through `safeUrl()` (rejects `javascript:`/`data:`/etc., allows http(s) + relative) and add `rel="noopener noreferrer"` on external links. **Gotcha:** `safeUrl` strips ASCII tab/LF/CR *before* the scheme check — the WHATWG URL parser strips those characters, so `java\tscript:` would otherwise re-form into a live `javascript:` href. Keep that stripping if you touch `safeUrl`.
- Validation is non-fatal: malformed/absent days warn-and-skip; the site must always render whatever is valid (partial-trip safe).
- **Read "now" only through `getNow()`** — never call `new Date()` directly in navigation/landing/time-of-day logic. The clock seam (`getNow`/`setNow`) is the single override point time-travel-test-mode and unit tests depend on; a stray `new Date()` silently bypasses pinned/overridden time. Compare days by **local calendar day** (via `localISODate`/`dayDelta`), not raw timestamps.
- CSS classes use kebab-case; the ukiyo-e theme tokens live in `:root` in `index.html`.
- Tests are dependency-free (`node:test` + `node:assert/strict`). Pure logic (e.g. `haversineMeters`, `safeUrl`) is unit-tested directly. Render functions (`renderDay`) are tested with a small hand-rolled DOM stub in `app.test.js` (no jsdom) — reuse that stub for downstream screens; real-browser behavior (crossfade, layout) is covered by the VERIFY-APP stage, not unit tests.

## Known Issues

- The **Jun 16–23 days** are not yet authored in `data/days.js` (content owed) — rendered as an absent range by design.
- `deploy-pages.yml` uses `@v1` for `upload-pages-artifact` and `deploy-pages` (current is `@v3`).
