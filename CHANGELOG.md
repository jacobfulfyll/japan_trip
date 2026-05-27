# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Collapsible Morning / Afternoon / Evening sections in the day view** — the flat plan list is now split into three labelled day-part sections, each collapsed by default. Clicking a header expands or collapses that bucket. Bucket boundaries: Morning (hour < 12), Afternoon (12–16), Evening (hour ≥ 17). Plan items with a missing or unparseable `time` fall into Morning with a console warning. Walking-distance "from previous stop" still threads correctly across bucket boundaries via an `indexInPlan` counter.
  - New optional `dayParts: { morning?, afternoon?, evening? }` field in each day object — a one-line authored summary shown in the collapsed header for each non-empty bucket. Validator accepts the field and warn-strips malformed shapes (non-object, or values that are not non-empty strings).
  - New public export `bucketPlanByDayPart(plan)` — pure helper that partitions a plan array into `{ morning, afternoon, evening }` bucket arrays. Exported for testing.
  - New CSS in `index.html`: `.day-part`, `.day-part-header`, `.day-part-name`, `.day-part-summary`, `.day-part-chev` (rotates with `.is-open`), `.day-part-body[hidden] { display: none }`.
  - All 10 authored days (Jun 24 – Jul 3) have hand-authored `dayParts` summaries in `data/days.js`.
  - 21 new tests added; suite is now **235 total** (235 passing).
  - `CACHE_VERSION` bumped to `v7` in `sw.js`.

### Added
- **Home button in the day navigation bar** — every day view now shows a 🏠 button (leading position, aria-label "Trip overview") that returns to the 18-day index overview. Before this you could only get back by reloading. The overview re-mount uses the same code path as the initial pre-trip overview (now factored into a `mountOverview()` closure in `mountApp`); mid-trip it renders the in-trip kicker ("IN JAPAN NOW" / "THE ADVENTURE IS UNDERWAY.") without a numeric countdown. `mountApp`'s controller gained a `toOverview()` method alongside `go`/`toIso`/`destroy` for programmatic navigation. 44pt minimum tap target (HIG). `CACHE_VERSION` bumped to `v6`.

### Changed
- **Map button reduced to a muted icon** — the chunky "Open in Google Maps" / "Map" text+icon chip on each plan item, recommendation card, and lodging card is now a small, low-opacity pin glyph anchored to the card's bottom-right. The text is gone from the rendered DOM; the link still announces as "Open in Google Maps" to screen readers via `aria-label`. Hit target stays at 44×44 (HIG). For plan items with expandable recommendations, the icon anchors to a new `.plan-content` wrapper so it sits with the plan's own title/note rather than overlaying an expanded rec panel. `CACHE_VERSION` bumped to `v5`.

### Fixed
- **Recommendation panel collapse toggle** — the "N options — tap to compare" toggle now actually hides/shows the options panel. The panel's `display: grid` rule was overriding the UA `[hidden]` rule; added `.rec-panel[hidden] { display: none; }` to restore the expected behavior. `CACHE_VERSION` bumped to `v4`.

### Added
- **Pre-trip home screen** — the countdown overview is now a real home screen, replacing the interim placeholder.
  - **Live countdown** with three graceful states: before the trip ("N days until the trip"), during ("The adventure is underway."), after ("The adventure is complete.").
  - **Tappable 18-day index** listing every trip day (Jun 16 – Jul 3). Each row shows Day #, date ("Wed · Jun 24"), city/region, and a status pill — "Planned" for authored days (Jun 24–Jul 3), "TBD" (dimmed) for the unauthored Jun 16–23 leg. Today's row is highlighted. Tapping any row navigates directly into that day's view.
  - `renderOverview` is now a **named export** from `app.js` (was internal), making it directly testable.
  - Added `.day-index*` CSS to `index.html`; removed dead `.overview-enter` CSS.
  - `CACHE_VERSION` bumped to `v3` in `sw.js` (shell files changed). `sw.test.js` now derives cache-name literals from the constant rather than hardcoding them.
  - Added tests covering the home screen render, countdown states, day-index rows, today-highlighting, and the `renderOverview` export.
- **Time-travel test mode** — fake the current date+time to verify time-of-day behavior on demand. **Inert by default**: with no override set, the app uses the real device clock.
  - Override resolution wires into the existing `getNow`/`setNow` clock seam at module load. Precedence: URL param `?now=<datetime-local>` (e.g. `?now=2026-06-25T22:00`) wins, then localStorage key `jt:now`. A `datetime-local` value is parsed as LOCAL time (the traveler's wall clock). Invalid input is ignored (never throws at load); a URL override is mirrored into localStorage so it survives the app's own internal day-to-day navigation.
  - Clearing: `?now=clear` (also `off`/`real`/`reset`/empty) wipes the stored override and restores the real clock.
  - `test.html` — a standalone, on-theme dev page: a `datetime-local` picker, quick presets derived from the trip window (Pre-trip countdown · Kyoto morning Jun 25 9am · Kyoto evening Jun 25 10pm · Post-trip reminisce), a "Launch app in this moment" action (opens `index.html?now=…`, bookmarkable/shareable to a phone), a "Clear override" action, and a live indicator of the active override.
  - `index.html` shows an unobtrusive "Time-travel mode" banner (with the simulated moment + a "Use real clock" link) whenever an override is active, so you never forget the app is faking time.
  - New public exports for the override layer: `resolveNowOverride()`, `parseNowOverride(value)`.
- **Date/time-aware navigation** — the app now knows what time it is and behaves accordingly.
  - **Lifecycle framing**: each day is framed by when you're viewing it — `anticipation` before the day, `plan` on the day itself, `reminisce` afterward. `renderDay` already accepted a framing; now the app picks the right one automatically.
  - **Smart landing**: on open, the app decides what to show. Before the trip: a countdown overview displaying days until departure. During the trip: today's day in its lifecycle framing. After the trip: the last day in `reminisce`.
  - **Pre-trip countdown overview**: a self-contained interim screen shown when the trip hasn't started. The `trip-overview-home` backlog task will replace/enhance it later.
  - **Day-to-day navigation**: a prev/next nav bar pages across all 18 trip dates (Jun 16 – Jul 3). Absent days (the Jun 16–23 gap) render placeholder screens, not crashes. Navigation re-applies the lifecycle framing on each page.
  - **Evening "Prep for tomorrow" button**: during the evening window (9 pm – 4 am, from `TRIP.eveningWindow`) while viewing today's day, a button appears that navigates to tomorrow and surfaces the prep checklist. Hidden when viewing other days, on the last day, and outside the evening window.
  - **Clock seam** (`getNow` / `setNow`): `getNow()` is the single source of "now" throughout the app. `setNow(fn)` overrides it with a zero-arg function returning a `Date`; `setNow(null)` restores the wall clock. Degrades gracefully if the provider throws or returns a non-Date. Used by the time-travel test mode and pinned in tests.
- New public exports: `mountApp(rootEl)`, `pickLandingView(now?)`, `frameForDay(day, now?)`, `isEveningWindow(now, window?)`, `tripWindowDates(trip?)`, `getNow()`, `setNow(fn|null)`.
- `CACHE_VERSION` bumped to `v3` in `sw.js` (shell files changed — installed users pick up the update on next visit). `test.html` is intentionally left out of the precache (dev tool, network-only) but is reachable.

### Changed
- `mountApp(rootEl)` is now the primary mount entry point called by the bootstrap. `renderInto(rootEl, day?, framing?)` is retained unchanged for backward compatibility and standalone/test use.

### Added
- PWA support: the site now installs to your phone's home screen and loads with no network.
  - `manifest.json` — web app manifest (name "Newly Weds in Japan!", standalone display, ukiyo-e theme/background colors, torii-gate icons at 192 px, 512 px, and maskable-512 px).
  - `sw.js` — hand-written service worker (no build step). Precaches the app shell (`index.html`, `app.js`, `data/days.js`, manifest, icons) into a versioned `app-shell-v1` cache. Fetch routing: network-first for navigations and `data/days.js` (offline falls back to cached shell); cache-first for other shell assets; stale-while-revalidate for cross-origin hero photos and Google Fonts into a separate `runtime-v1` cache. `skipWaiting` + `clients.claim` so updates take effect promptly.
  - `img/` — four PNG app icons (torii-gate motif): `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`.
  - `index.html` updated with manifest link, `theme-color` + iOS PWA meta tags, `apple-touch-icon`, favicon, and feature-guarded service-worker registration.
- `data/days.js` as the single source of truth for trip content (`TRIP` + `DAYS`), with 10 days authored (Jun 24 – Jul 3).
- `app.js` render pipeline: validates the data on load (warn-and-skip, never throws), derives a 1-based `dayNumber`, and deep-freezes everything it exposes.
- Public day API: `getTrip()`, `getDays()`, `getDay(iso)`, `getDayByNumber(n)`, `renderInto(rootEl)` (plus `buildValidatedDays` for tests). Lookups return `null` for absent days.
- `app.test.js`: 44 tests via `node --test` (no npm/dependencies).
- **Day-view screen**: `renderDay(day, framing)` renders a single day as a mobile-first ukiyo-e screen — full-width auto-crossfading hero photo slideshow, ordered plan list (times, highlighted reservations, per-stop Maps links, lodging card with breakfast note), and tap-to-expand recommendations showing name, pros/con, map link, and haversine walking distance from the nearest preceding stop.
- Three lifecycle framings for `renderDay`: `anticipation` (pre-day hype), `plan` (default, day-of guide), `reminisce` (post-day, includes a soft placeholder seam for the future photo gallery).
- Sparse/absent days render a graceful "Details coming" placeholder rather than erroring.
- New exported pure helpers: `haversineMeters(a, b)`, `formatWalk(meters)`, `safeUrl(url)`, `nearestPrecedingCoords(plan, index, lodging)` — all exported for testing.
- Test suite expanded from 44 to **97** cases — new coverage for day-view rendering, hero slideshow, plan/lodging/recommendation rendering, haversine math, and framing variants; uses a hand-rolled DOM stub (no jsdom, still zero dependencies). (`app.test.js` is now 138 cases with the date/time-aware navigation additions — 168 total alongside `sw.test.js` — see the entry above.)

### Changed
- Rebuilt the site from a hardcoded tabbed page into a data-driven no-build scaffold: `data/days.js` → `app.js` → slim `index.html` shell rendering into `<main id="app-root">`.
- `renderInto(rootEl, day?, framing?)` now renders the real day view via `renderDay` (was the minimal proof-of-pipeline scaffold). Manages slideshow timer lifecycle — stops any prior view before mounting a new one. Backward compatible: `renderInto(root)` still works.
- `index.html` scaffold styles replaced with the day-view stylesheet; dead tabbed-app CSS (`.timeline-*`, `.tab-*`, `.slide-*`, etc.) removed. The ukiyo-e theme foundation (`:root` tokens, resets, `.wave-art`/`.wave-layer`, reduced-motion block) is intact.

### Security
- `safeUrl(url)` allow-list validates URL schemes before they reach `href`/`src` attributes, strips tab/LF/CR characters to block `javascript:` smuggling via whitespace, and rejects `data:` and other non-http(s)/maps schemes. Applied to all `mapUrl` and `photos[].url` values rendered into the DOM.

### Removed
- The old aux planning tabs (Transport, Costs, Flights, Culture/Prep, Priority Research) — dropped as stale pre-booking content. Evergreen bits (flight times, transport-pass notes, etiquette prep) now live in per-day `prep[]` / `plan[]` data.
