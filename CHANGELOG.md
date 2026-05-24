# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `data/days.js` as the single source of truth for trip content (`TRIP` + `DAYS`), with 10 days authored (Jun 24 – Jul 3).
- `app.js` render pipeline: validates the data on load (warn-and-skip, never throws), derives a 1-based `dayNumber`, and deep-freezes everything it exposes.
- Public day API: `getTrip()`, `getDays()`, `getDay(iso)`, `getDayByNumber(n)`, `renderInto(rootEl)` (plus `buildValidatedDays` for tests). Lookups return `null` for absent days.
- `app.test.js`: 44 tests via `node --test` (no npm/dependencies).

### Changed
- Rebuilt the site from a hardcoded tabbed page into a data-driven no-build scaffold: `data/days.js` → `app.js` → slim `index.html` shell rendering into `<main id="app-root">`.

### Removed
- The old aux planning tabs (Transport, Costs, Flights, Culture/Prep, Priority Research) — dropped as stale pre-booking content. Evergreen bits (flight times, transport-pass notes, etiquette prep) now live in per-day `prep[]` / `plan[]` data.
