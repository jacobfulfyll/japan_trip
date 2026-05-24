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
app.test.js    ← 44 tests for the data/API layer (node --test).
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

| Function                | Returns                                              |
|-------------------------|------------------------------------------------------|
| `getTrip()`             | The trip metadata object (deeply frozen).            |
| `getDays()`             | A **fresh array** of all valid days, sorted by date ascending, each with `dayNumber`. Day objects are deeply frozen. |
| `getDay(iso)`           | The day matching ISO date `iso`, or `null` if absent. Frozen. |
| `getDayByNumber(n)`     | The day whose derived `dayNumber === n`, or `null` if absent (also `null` for non-finite `n`). Frozen. |
| `renderInto(rootEl)`    | Renders the current proof-of-pipeline view into `rootEl`. No-ops (warns) if `rootEl` is falsy. |
| `buildValidatedDays(days?, trip?)` | The validation core, exported for tests. Returns a frozen, sorted, validated array. You won't normally call this. |

**Immutability / copy-safety:** everything the API hands back is deeply frozen,
so callers can't accidentally corrupt the shared data. `getDays()` additionally
returns a new array each call, so you can sort/filter the result freely.

**`renderInto` is temporary.** It currently draws a minimal card-per-day view
that just proves the data pipeline works end-to-end. The `day-view-screen` task
will replace it with the real UI; the data API above stays put.

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
const CACHE_VERSION = 'v2';  // was 'v1' — increment whenever shell files change
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

44 tests cover the data validation, `dayNumber` derivation, the null-on-absent
lookups, and the immutability guarantees.

## Deploy

Push to `main` and GitHub Pages deploys automatically via `deploy-pages.yml`.

Note: the **entire repo root is uploaded as the Pages artifact and served
publicly** — don't commit anything to the root you wouldn't want on the public
internet.
