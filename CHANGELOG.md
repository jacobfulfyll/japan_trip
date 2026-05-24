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

### Changed
- Rebuilt the site from a hardcoded tabbed page into a data-driven no-build scaffold: `data/days.js` → `app.js` → slim `index.html` shell rendering into `<main id="app-root">`.

### Removed
- The old aux planning tabs (Transport, Costs, Flights, Culture/Prep, Priority Research) — dropped as stale pre-booking content. Evergreen bits (flight times, transport-pass notes, etiquette prep) now live in per-day `prep[]` / `plan[]` data.
