# Newly Weds in Japan!

A private daily-companion site for our June–July 2026 Japan trip (4 travelers).
It's a static site — no build step, no framework, no npm. All the trip content
lives in one data file; the page renders itself from that data and deploys to
GitHub Pages on every push to `main`.

## How it's put together

```
data/days.js   ← the trip content (TRIP + DAYS). Edit this.
app.js         ← imports the data, validates it, exposes a small API, renders.
index.html     ← slim shell: theme CSS + <main id="app-root"> + the module script.
app.test.js    ← 205 tests for the data/API/nav layer (node --test; 235 with sw.test.js).
```

`data/days.js` is the single source of truth. Everything you see on the page
comes from it.

## Editing the trip (the main thing you'll do)

Open `data/days.js`. It exports two things:

```js
export const TRIP = { ... };  // trip-wide metadata
export const DAYS = [ ... ];  // one object per day, authored in any order
```

To change a day, find its object in `DAYS` and edit the fields. To add a day,
copy an existing object and change the values. Save the file and reload the page —
no build, no commands.

### `TRIP` fields

| Field          | Type     | Notes                                                        |
|----------------|----------|-------------------------------------------------------------|
| `title`        | string   | Shown at the top of the page.                               |
| `start`        | ISO date | Trip start, `"YYYY-MM-DD"`. Day 1 is counted from here.     |
| `end`          | ISO date | Trip end.                                                   |
| `travelers`    | string[] | Names.                                                      |
| `eveningWindow`| object   | `{ startHour, endHour }` (24h). The "show tomorrow / prep" window — currently 21→4 (9pm–4am). |

### `DAYS[]` fields

Each day looks like this (only `date` is strictly required; the rest can be
omitted or empty on a sparse day):

| Field      | Type            | Notes                                                                 |
|------------|-----------------|-----------------------------------------------------------------------|
| `date`     | ISO date        | `"YYYY-MM-DD"`. **Required.** Invalid/missing → the day is skipped.    |
| `base`     | string          | Where you're based that day (e.g. `"Kyoto"`).                          |
| `title`    | string          | Day headline.                                                         |
| `intro`    | string          | A sentence or two setting up the day.                                 |
| `spend`    | string          | Optional free-text spend note.                                        |
| `photos`   | array           | Hype slideshow. Each: `{ url, alt, credit? }`. `credit` is required for CC-licensed images. `[]` = none yet. |
| `lodging`  | object \| null  | `{ name, address, mapUrl, coords?, breakfast? }`, or `null` if not staying anywhere (e.g. travel-home day). |
| `prep`     | string[]        | Free-text to-dos; powers the evening "Prep for tomorrow".             |
| `plan`     | array           | The timeline — see below. `[]` = a day with nothing scheduled yet.    |
| `dayParts` | object          | Optional. One-line summaries for the collapsible day-part headers: `{ morning?, afternoon?, evening? }`. Only include keys for non-empty buckets. Omitting the field is fine — headers render without a summary line. |

> **Don't author `dayNumber`** — it's derived automatically from `TRIP.start`
> (start = Day 1). Just set `date` correctly.

### `plan[]` items

Each plan entry is one moment in the day:

| Field             | Type     | Notes                                                              |
|-------------------|----------|-------------------------------------------------------------------|
| `time`            | string   | Optional `"HH:MM"` (24h).                                          |
| `tag`             | string   | Kind of item, e.g. `meal`, `transit`, `sight`, `checkin`, `rest`, `bar`, `spa`, `reservation`. |
| `title`           | string   | Short label.                                                      |
| `note`            | string   | Optional detail.                                                  |
| `mapUrl`          | string   | Optional Google Maps link.                                        |
| `coords`          | object   | Optional `{ lat, lng }`.                                          |
| `reserved`        | boolean  | `true` marks a booked reservation (a reservation is just a plan item with `reserved: true`). |
| `recommendations` | array    | Optional dining/activity options. **At most 4.** Each: `{ name, pros: [..], con, mapUrl?, coords?, address? }`. |

### Annotated example day

```js
{
  date: "2026-06-27",              // Day 12 (derived from TRIP.start, Jun 16)
  base: "Kyoto",
  title: "Nara — the Great Buddha & the Deer",
  intro: "A day trip south to Nara: the colossal bronze Buddha…",
  photos: [
    { url: "https://…/Todai-ji.jpg",
      alt: "The Daibutsuden of Todai-ji",
      credit: "Wiiii / Wikimedia Commons · CC BY-SA 3.0" },
  ],
  lodging: {
    name: "Cross Hotel Kyoto",
    address: "Kawaramachi, Nakagyo-ku, Kyoto",
    mapUrl: "https://maps.google.com/?q=Cross+Hotel+Kyoto",
    breakfast: "Available from 7am.",
  },
  prep: [
    "Buy 'shika senbei' deer crackers in the park.",
  ],
  plan: [
    { time: "08:15", tag: "transit", title: "Kyoto Station → Kintetsu-Nara",
      note: "Kintetsu line, ~40 min." },
    { time: "12:00", tag: "meal", title: "Lunch in Nara",
      recommendations: [                       // ≤ 4 options
        { name: "Azekuraya — chagayu",
          pros: ["On the Todai-ji route", "Genuine Nara dish"],
          con: "Touristy; a light lunch.",
          mapUrl: "https://maps.google.com/?q=Azekuraya+Nara" },
      ] },
  ],
}
```

### A sparse day

A day you haven't filled in yet is just a day with an empty `plan` and `photos`.
There's no status flag — emptiness *is* the "not planned yet" state:

```js
{ date: "2026-06-20", base: "Tokyo", title: "TBD", intro: "", photos: [], lodging: null, prep: [], plan: [] }
```

### Days that don't exist yet

The trip runs **Jun 16 – Jul 3**, but only **Jun 24 – Jul 3** are authored so
far. Jun 16–23 are deliberately absent — that content is owed later. Missing days
aren't an error: `app.js` simply renders the days that exist, and lookups for an
absent date return `null`. Add those days to `DAYS` when you're ready.

## The `app.js` API

`app.js` validates the data once on load (it **warns and skips** bad entries —
it never throws, so the page always renders whatever is valid), derives
`dayNumber`, deep-freezes everything, and exposes these named exports. Downstream
screens import them.

| Function                | Returns / effect                                              |
|-------------------------|--------------------------------------------------------------|
| `getTrip()`             | The trip metadata object (deeply frozen).                    |
| `getDays()`             | A **fresh array** of all valid days, sorted by date ascending, each with `dayNumber`. Day objects are deeply frozen. |
| `getDay(iso)`           | The day matching ISO date `iso`, or `null` if absent. Frozen. |
| `getDayByNumber(n)`     | The day whose derived `dayNumber === n`, or `null` if absent (also `null` for non-finite `n`). Frozen. |
| `renderDay(day, framing?)` | Returns `{ node, start, stop }`. `node` is the day-view DOM element (hero + plan + lodging + recommendations). `framing` is `'anticipation'`, `'plan'` (default), or `'reminisce'`. Call `start()` after mounting `node` to begin the hero slideshow; call `stop()` before discarding to avoid orphaned intervals. Null/absent `day` renders a graceful placeholder. |
| `renderInto(rootEl, day?, framing?)` | Mounts a day view into `rootEl` (defaults to Jun 24, `'plan'` framing). Stops any prior view's slideshow before mounting. No-ops (warns) if `rootEl` is falsy. Backward compatible: `renderInto(root)` still works. Retained for standalone/testing use — `mountApp` is now what the bootstrap calls. |
| `renderOverview(daysUntil, onEnter)` | Returns `{ node, start, stop }` for the pre-trip home screen. `daysUntil` is a number (days before departure), `0` (trip underway), or `null` (trip over). `node` is the home screen element — a live countdown header + tappable 18-day index where each row navigates to that day via `onEnter(iso)`. Call `start()` after mounting; call `stop()` before discarding. `mountApp` calls this automatically for the `{view:'overview'}` landing; you can also call it directly. |
| `buildValidatedDays(days?, trip?)` | The validation core, exported for tests. Returns a frozen, sorted, validated array. You won't normally call this. |
| `haversineMeters(a, b)` | Returns the great-circle distance in meters between two `{ lat, lng }` points. Exported for tests. |
| `formatWalk(meters)`    | Returns a human-readable walking estimate string (e.g. `"~3 min walk"`). Exported for tests. |
| `safeUrl(url)`          | Returns the URL if its scheme is in the allow-list (`https`, `http`, `maps`), otherwise `null`. Strips tab/LF/CR before checking. Exported for tests. |
| `nearestPrecedingCoords(plan, index, lodging)` | Returns the `{ lat, lng }` of the nearest preceding plan item with coords, falling back to `lodging.coords`, or `null`. Used to compute walking distances to recommendations. Exported for tests. |
| `bucketPlanByDayPart(plan)` | Partitions a `plan` array into `{ morning, afternoon, evening }` bucket arrays by `time` field. Morning: hour < 12; Afternoon: 12–16; Evening: hour ≥ 17. Items with missing/unparseable `time` fall into Morning. Each bucket item carries an `indexInPlan` property (its original index in the flat array) so walking-distance logic threads correctly across bucket boundaries. Exported for tests. |

**Date/time-aware navigation** — the following exports power the smart landing, lifecycle framing, and nav bar:

| Function                | Returns / effect                                              |
|-------------------------|--------------------------------------------------------------|
| `mountApp(rootEl)`      | **Primary mount entry point** (what the bootstrap calls). Boots the date/time-aware controller: picks a landing view, renders it, and wires a day-nav bar (Home / prev / position / next) that pages across the full 18-day trip window (Jun 16 – Jul 3). Absent days (the Jun 16–23 gap) render placeholder screens, not crashes. Returns `{ go(index), toIso(iso), toOverview(), destroy() }`. `toOverview()` re-mounts the 18-day overview from any day view (the Home button calls this). |
| `pickLandingView(now?)` | Decides what to show on open. Before the trip: `{ view: 'overview', day: null, daysUntil }`. During: `{ view: 'day', day, framing }` for today's day in its lifecycle framing. After: `{ view: 'day', day, framing: 'reminisce' }` for the last day (overview fallback if no days authored). Defaults `now` to `getNow()`. |
| `frameForDay(day, now?)` | Returns `'anticipation'` (future day), `'plan'` (today), or `'reminisce'` (past day), comparing calendar dates in local time. Accepts a day object or an ISO string. Bad input returns `'plan'`. Defaults `now` to `getNow()`. |
| `isEveningWindow(now, window?)` | Returns `true` during the evening window defined by `TRIP.eveningWindow` (default 9 pm – 4 am, midnight-wrapping). Defaults `window` to `getTrip().eveningWindow`. |
| `tripWindowDates(trip?)` | Returns an ordered ISO array of every date in the trip window (18 dates for Jun 16 – Jul 3). Returns `[]` if the window is inverted or unparseable. Defaults `trip` to `getTrip()`. |
| `getNow()`              | Returns the current `Date` from the active clock provider. Degrades to `new Date()` if the provider throws or returns a non-Date. |
| `setNow(fn\|null)`      | Overrides the clock: pass a zero-argument function that returns a `Date` to substitute a fixed or simulated time. Pass `null` to restore the wall clock. Used by the time-travel test mode and pinned in tests — do not call in production paths. |

**Immutability / copy-safety:** everything the API hands back is deeply frozen,
so callers can't accidentally corrupt the shared data. `getDays()` additionally
returns a new array each call, so you can sort/filter the result freely.

### How the smart landing works

When the page loads, `mountApp` calls `pickLandingView` to choose the opening screen:

- **Before Jun 16** (pre-trip): the pre-trip home screen — a live countdown showing days until departure and a tappable index of all 18 trip days. Rows with authored content are marked "Planned"; the Jun 16–23 leg shows "TBD" (dimmed). Tapping any row navigates to that day's view. Today's row is highlighted when the trip is active.
- **Jun 16 – Jul 3** (during the trip): today's day view in its lifecycle framing — `'anticipation'` in the morning, `'plan'` through the day, `'reminisce'` once the day has passed.
- **After Jul 3** (post-trip): the last authored day in `'reminisce'` framing.

The nav bar's prev/next arrows page through all 18 dates regardless of which days are authored. Absent days (Jun 16–23 as of now) show a placeholder rather than crashing.

#### Evening "Prep for tomorrow" button

While viewing today's day during the evening window (9 pm – 4 am, configured in `TRIP.eveningWindow`), a "Prep for tomorrow →" button appears. Tapping it navigates to tomorrow's day and surfaces the `prep[]` checklist. The button is hidden when viewing any other day, on the last day of the trip, and outside the evening window.

#### Previewing time-dependent behavior locally

Today's real date is before the trip, so `mountApp` lands on the countdown overview. To preview in-trip behavior, use the time-travel test mode described below.

## Time-travel test mode

The app ships a lightweight override layer so you can fake the current date and time to verify time-of-day behavior on demand. **Inert by default** — with no override set the app uses the real device clock, so it is safe to ship.

### Using `test.html`

Open the test page in your local preview server:

```
http://localhost:8000/test.html
```

Pick a moment from the datetime picker or tap one of the quick presets (Pre-trip countdown · Kyoto morning · Kyoto evening · Post-trip reminisce), then click **Launch app in this moment**. The app opens at `index.html?now=<value>` simulating that exact date and time.

The resulting URL is bookmarkable and shareable — you can send it to another phone to preview a specific day and framing.

### URL param

Append `?now=<datetime-local>` to any app URL:

```
http://localhost:8000/?now=2026-06-25T22:00
```

The value is parsed as **local time** (the traveler's wall clock). The override is mirrored into `localStorage` (key `jt:now`) so it survives the app's own internal prev/next navigation.

### `localStorage` key

Set `localStorage.setItem('jt:now', '2026-06-25T22:00')` in the console to apply a sticky override that persists across reloads without a URL param.

### Precedence

URL param `?now` wins over `jt:now` in localStorage, which wins over the real clock.

### Clearing the override

Navigate to `?now=clear` (or `?now=off` / `?now=real` / `?now=reset` / `?now=` with an empty value) to wipe the stored override and restore the real clock. The "Clear override" button on `test.html` does the same thing.

### Active-override indicator

When an override is active, `index.html` shows an unobtrusive banner with the simulated moment and a **Use real clock** link, so you can never accidentally forget the app is faking time.

## PWA — install to your phone and use offline

The site ships a service worker and web app manifest, so it works as a
Progressive Web App.

### Install to your home screen

- **iOS Safari:** tap the Share button → "Add to Home Screen".
- **Android Chrome:** tap the browser menu (⋮) → "Add to Home screen", or accept
  the install prompt if Chrome offers one automatically.

Once installed it opens full-screen (no browser chrome) and launches instantly
from the icon.

### What works offline

The app shell — `index.html`, `app.js`, `data/days.js`, and icons — is precached
on first visit, so the full itinerary loads with no network. Fonts and hero photos
are cached the first time you load them (stale-while-revalidate), so
previously-viewed photos (and the fonts) also load offline afterward. Google Maps
links still require a network connection.

### Maintainer: bump `CACHE_VERSION` when you ship changes

There is no build step, so there is no automatic cache-busting. When you change
**any** precached shell file — `index.html`, `app.js`, `data/days.js`,
`manifest.json`, or any icon in `img/` — you must manually bump `CACHE_VERSION`
at the top of `sw.js`:

```js
// sw.js
const CACHE_VERSION = 'v7';  // increment whenever shell files change
```

On the next visit the old caches are deleted and the fresh files install. Skip
this step and users on the old cache will not see your changes until the browser
evicts the cache on its own.

### Service workers require HTTPS (or localhost)

Service workers only register on a secure origin. They work on the live GitHub
Pages site (`https://`) and on `localhost` (`http://localhost:8000`). They will
**not** register over `file://` — consistent with the ES-module constraint
described in "Preview locally" below.

## Preview locally

ES modules won't load over `file://` — you need an HTTP origin. Any static server
works:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Run the tests

No npm, no dependencies — just Node's built-in test runner:

```sh
node --test
```

The `app.test.js` suite (205 cases; 235 total alongside `sw.test.js`) covers the data validation, `dayNumber` derivation, the null-on-absent
lookups, the immutability guarantees, the day-view render layer (haversine
math, `safeUrl` scheme gating, framing variants, recommendation expansion,
sparse/absent-day placeholders — via a dependency-free hand-rolled DOM stub),
the date/time-aware navigation layer (`frameForDay`, `pickLandingView`,
`isEveningWindow`, `tripWindowDates`, `mountApp`, and the `getNow`/`setNow` clock seam),
the pre-trip home screen (`renderOverview` countdown states, day-index rows, today-highlighting),
the time-travel override layer (`parseNowOverride`, `resolveNowOverride`, precedence, clear tokens),
and collapsible day-parts (`bucketPlanByDayPart` bucketing, `dayParts` validation, day-part section rendering).

## Deploy

Push to `main` and GitHub Pages deploys automatically via `deploy-pages.yml`.

Note: the **entire repo root is uploaded as the Pages artifact and served
publicly** — don't commit anything to the root you wouldn't want on the public
internet.
