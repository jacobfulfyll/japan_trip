# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
- Test suite expanded from 44 to **97** cases — new coverage for day-view rendering, hero slideshow, plan/lodging/recommendation rendering, haversine math, and framing variants; uses a hand-rolled DOM stub (no jsdom, still zero dependencies).

### Changed
- Rebuilt the site from a hardcoded tabbed page into a data-driven no-build scaffold: `data/days.js` → `app.js` → slim `index.html` shell rendering into `<main id="app-root">`.
- `renderInto(rootEl, day?, framing?)` now renders the real day view via `renderDay` (was the minimal proof-of-pipeline scaffold). Manages slideshow timer lifecycle — stops any prior view before mounting a new one. Backward compatible: `renderInto(root)` still works.
- `index.html` scaffold styles replaced with the day-view stylesheet; dead tabbed-app CSS (`.timeline-*`, `.tab-*`, `.slide-*`, etc.) removed. The ukiyo-e theme foundation (`:root` tokens, resets, `.wave-art`/`.wave-layer`, reduced-motion block) is intact.

### Security
- `safeUrl(url)` allow-list validates URL schemes before they reach `href`/`src` attributes, strips tab/LF/CR characters to block `javascript:` smuggling via whitespace, and rejects `data:` and other non-http(s)/maps schemes. Applied to all `mapUrl` and `photos[].url` values rendered into the DOM.

### Removed
- The old aux planning tabs (Transport, Costs, Flights, Culture/Prep, Priority Research) — dropped as stale pre-booking content. Evergreen bits (flight times, transport-pass notes, etiquette prep) now live in per-day `prep[]` / `plan[]` data.
