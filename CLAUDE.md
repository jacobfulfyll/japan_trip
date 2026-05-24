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
| `app.js` | Render pipeline: imports `data/days.js`, validates (warn-and-skip), deep-freezes, derives `dayNumber`, exposes the day API + `renderInto`. |
| `index.html` | Slim shell — ukiyo-e theme CSS + `<main id="app-root">` + `<script type="module" src="app.js">` + PWA wiring (manifest link, iOS meta, SW registration). |
| `sw.js` | Hand-written service worker (no build step) — precaches the app shell into `app-shell-v1`, runtime-caches photos/fonts into `runtime-v1`. Bump `CACHE_VERSION` when shell files change. |
| `manifest.json` | Web app manifest (install-to-home-screen). Relative `start_url`/`scope` for the `/japan_trip/` Pages subpath. Icons live in `img/`. |
| `app.test.js` | 44 `node:test` cases for the data layer. Run with `node --test`. |
| `sw.test.js` | `node:test` cases for the service worker (vm-sandboxed) + manifest/index.html PWA wiring. |
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
app.js         ← validate → deep-freeze → derive dayNumber → public API + renderInto()
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
- `renderInto(rootEl)` → proof-of-pipeline render (day-view-screen will replace this).
- `buildValidatedDays(days, trip)` / `deriveDayNumber(iso, startIso)` → exported for tests.

Returns are **deeply frozen and copy-safe** — callers cannot corrupt shared module state.

## Conventions

- **No build step, no dependencies.** Keep it plain HTML/CSS/ES modules.
- **Bump `CACHE_VERSION` in `sw.js` whenever you change a precached shell file** (index.html, app.js, data/days.js, manifest, icons). With no build step this is the only cache-busting mechanism — skip it and installed users get stale files until the old cache happens to evict.
- All trip data lives in `data/days.js`; editing a day should stay a localized data edit.
- Render is **XSS-safe by construction**: data reaches the DOM via `textContent` / `createElement` only — never `innerHTML` with interpolated data. Preserve this in downstream screens.
- When wiring data URLs (`photos[].url`, `mapUrl`) into `href`/`src` in screen tasks (and especially once v2 adds user-uploaded photos), validate the scheme (reject `javascript:`/`data:`) and add `rel="noopener noreferrer"` on external links.
- Validation is non-fatal: malformed/absent days warn-and-skip; the site must always render whatever is valid (partial-trip safe).
- CSS classes use kebab-case; the ukiyo-e theme tokens live in `:root` in `index.html`.
- Tests are dependency-free (`node:test` + `node:assert/strict`); the DOM `renderInto` is verified via a manual/headless check, not jsdom.

## Known Issues

- The **Jun 16–23 days** are not yet authored in `data/days.js` (content owed) — rendered as an absent range by design.
- `deploy-pages.yml` uses `@v1` for `upload-pages-artifact` and `deploy-pages` (current is `@v3`).
