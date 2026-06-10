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
app.test.js    ← tests for the data/API/nav layer (node --test; 587 total with sw.test.js).
```

`data/days.js` is the single source of truth. Everything you see on the page
comes from it.

## Access — shared Firebase password

The live site is protected by a single shared Firebase password. Visitors see a
login form before any trip content loads. Enter the shared password to sign in;
Firebase's default session persistence keeps you signed in across reloads on the
same device.

**The password is the only secret.** The Firebase web config (`firebase-config.js`)
is committed to the repo — those values (API key, project ID, etc.) identify the
Firebase project but carry no privileges on their own. The real access control is
enforced server-side by Firebase Auth and Storage/Firestore security rules
(`request.auth != null`). If you need to rotate the password, change it in the
Firebase console under Authentication → Users for the shared account. The shared
account email is the `SHARED_EMAIL` constant at the top of `app.js`.

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
| `tag`             | string   | Kind of item: `meal`, `transit`, `sight`, `checkin`, `checkout`, `rest`, `bar`, `spa`, `reservation`. |
| `title`           | string   | Short label.                                                      |
| `note`            | string   | Optional detail.                                                  |
| `mapUrl`          | string   | Optional Google Maps link.                                        |
| `coords`          | object   | Optional `{ lat, lng }`.                                          |
| `reserved`        | boolean  | `true` marks a booked reservation (a reservation is just a plan item with `reserved: true`). |
| `transit`         | object   | Optional. On `tag:'transit'` items: a `TransitLeg` (see below) `& { minutes?, transfer? }`. Renders a small structured block below the title and makes the tag pill mode-aware ("Bus" / "Train" / "Subway"). |
| `recommendations` | array    | Optional dining/activity options. **At most 4.** Each: `{ name, pros: [..], con, mapUrl?, coords?, address?, transit? }`. The optional `transit` reuses the shared `TransitLeg` shape (see below) extended with `{ minutes, transfer? }` — populated for any rec whose computed walk from its anchor exceeds **1.5 km**, so the card shows a transit-alternative pill alongside the walk. |

#### Transit items — the `transit` field

When a plan item is a trip from one stop to another, populate `transit` with the
shared **`TransitLeg`** shape:

```js
// TransitLeg
{
  mode: 'bus' | 'train' | 'subway',  // drives the pill label + emoji
  line?: string,                      // e.g. "Hakone Tozan Bus", "Tokaido Shinkansen (Hikari)"
  from: string,                       // boarding stop
  to: string,                         // alighting stop
}
```

On plan items, `transit` extends `TransitLeg` with two optionals:

| Field      | Type              | Notes |
|------------|-------------------|-------|
| `minutes`  | number            | Single source of truth for duration. **Don't duplicate in the `note` prose.** |
| `transfer` | `TransitLeg`      | One mid-trip transfer (multi-leg journey). 3+ legs are out of scope — split the plan item if needed. The transfer's `minutes` is summed into the rendered total. |

The renderer draws a compact `.plan-transit` block under the title showing the
line(s), `from → to` (chained `→ transfer.to` for multi-leg), and total
minutes. Hand-authored prose stays in `note` for context (luggage tips,
"sit on the right for Mt Fuji", etc.).

The same `TransitLeg` shape is reused on the **recommendation** surface. Author
a `transit` field on any rec whose `nearestPrecedingCoords`-computed walk
exceeds 1.5 km, using `TransitLeg & { minutes, transfer? }`. On recs `minutes`
is **required** (the inline pill needs a single door-to-door number); on plan
items it's optional. The rec card renders the pill inline within its
`.rec-walk` paragraph:

```
🚶 <walk-min> min from <anchor> · <mode-emoji[+transfer-emoji]> <total-min> min (<from> → <to>[ → <transfer.to>])
```

Multi-leg recs concatenate the mode emojis (no `+` separator) and sum the
minutes across primary + transfer. Edit the schema header in `data/days.js`
if you change the shape.

#### Tag `checkout`

Use `tag: 'checkout'` for hotel/ryokan checkouts (not `transit`). Renders a
muted slate pill — visually distinct from the trip-segment transits.

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

### All 18 days are authored

The trip runs **Jun 16 – Jul 3** and all 18 days are now authored end-to-end —
Tokyo (Jun 16–21), Hakone (Jun 22–23), Kyoto and the return leg (Jun 24 – Jul 3).
If you ever need to add or replace a day, just add or edit the object in `DAYS`.
Missing days aren't an error: `app.js` renders whatever is present and lookups for
an absent date return `null`.

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
| `renderDay(day, framing?)` | Returns `{ node, start, stop }`. `node` is the day-view DOM element (hero + plan + lodging + recommendations). `framing` is `'anticipation'`, `'plan'` (default), or `'reminisce'`. Call `start()` after mounting `node` to begin the hero slideshow (and, on `'reminisce'`, the live photo subscription); call `stop()` before discarding to avoid orphaned intervals/listeners. Null/absent `day` renders a graceful placeholder. The `'reminisce'` framing drops the hero and shows a photo gallery — see "The reminisce gallery" below. |
| `renderInto(rootEl, day?, framing?)` | Mounts a day view into `rootEl` (defaults to Jun 24, `'plan'` framing). Stops any prior view's slideshow before mounting. No-ops (warns) if `rootEl` is falsy. Backward compatible: `renderInto(root)` still works. Retained for standalone/testing use — `mountApp` is now what the bootstrap calls. |
| `renderOverview(daysUntil, onEnter)` | Returns `{ node, start, stop }` for the pre-trip home screen. `daysUntil` is a number (days before departure), `0` (trip underway), or `null` (trip over). `node` is the home screen element — a live countdown header + tappable 18-day index where each row navigates to that day via `onEnter(iso)`. Call `start()` after mounting; call `stop()` before discarding. `mountApp` calls this automatically for the `{view:'overview'}` landing; you can also call it directly. |
| `buildValidatedDays(days?, trip?)` | The validation core, exported for tests. Returns a frozen, sorted, validated array. You won't normally call this. |
| `haversineMeters(a, b)` | Returns the great-circle distance in meters between two `{ lat, lng }` points. Exported for tests. |
| `safeUrl(url)`          | Returns the URL if its scheme is in the allow-list (`https`, `http`, `maps`), otherwise `null`. Strips tab/LF/CR before checking. Exported for tests. |
| `nearestPrecedingCoords(plan, index, lodging)` | Returns the `{ lat, lng }` of the nearest preceding plan item with coords, falling back to `lodging.coords`, or `null`. Used to compute walking distances to recommendations. Exported for tests. |
| `bucketPlanByDayPart(plan)` | Partitions a `plan` array into `{ morning, afternoon, evening }` bucket arrays by `time` field. Morning: hour < 12; Afternoon: 12–16; Evening: hour ≥ 17. Items with missing/unparseable `time` fall into Morning. Each bucket item carries an `indexInPlan` property (its original index in the flat array) so walking-distance logic threads correctly across bucket boundaries. Exported for tests. |

**Date/time-aware navigation** — the following exports power the smart landing, lifecycle framing, and nav bar:

| Function                | Returns / effect                                              |
|-------------------------|--------------------------------------------------------------|
| `mountApp(rootEl, opts = {})` | **Primary mount entry point** (what the bootstrap calls). Boots the date/time-aware controller: picks a landing view, renders it, and wires a day-nav bar — a **☰ hamburger menu** (left) carrying **Home** and **Add photos** rows, a centered position label, and **prev/next circular chevrons** (right) — that pages across the full 18-day trip window (Jun 16 – Jul 3). `opts.onAddPhotos(iso)` is the handler for the Add-photos menu row (receives the viewed day's ISO); when absent (or before the trip starts) the row is disabled. The bootstrap now wires a real handler (the photo-upload flow — see below). Returns `{ go(index), toIso(iso), toOverview(), destroy() }`. `toOverview()` re-mounts the 18-day overview from any day view (reachable via ☰ → Home). |
| `pickLandingView(now?)` | Decides what to show on open. Before the trip: `{ view: 'overview', day: null, daysUntil }`. During: `{ view: 'day', day, framing }` for today's day in its lifecycle framing. After: `{ view: 'day', day, framing: 'reminisce' }` for the last day (overview fallback if no days authored). Defaults `now` to `getNow()`. |
| `frameForDay(day, now?)` | Returns `'anticipation'` (future day), `'plan'` (today), or `'reminisce'` (past day), comparing calendar dates in local time. Accepts a day object or an ISO string. Bad input returns `'plan'`. Defaults `now` to `getNow()`. |
| `isEveningWindow(now, window?)` | Returns `true` during the evening window defined by `TRIP.eveningWindow` (default 9 pm – 4 am, midnight-wrapping). Defaults `window` to `getTrip().eveningWindow`. |
| `tripWindowDates(trip?)` | Returns an ordered ISO array of every date in the trip window (18 dates for Jun 16 – Jul 3). Returns `[]` if the window is inverted or unparseable. Defaults `trip` to `getTrip()`. |
| `getNow()`              | Returns the current `Date` from the active clock provider. Degrades to `new Date()` if the provider throws or returns a non-Date. |
| `setNow(fn\|null)`      | Overrides the clock: pass a zero-argument function that returns a `Date` to substitute a fixed or simulated time. Pass `null` to restore the wall clock. Used by the time-travel test mode and pinned in tests — do not call in production paths. |

**Reminisce gallery (live)** — the `'reminisce'` framing's photo gallery shows travelers' uploaded photos:

| Function                | Returns / effect                                              |
|-------------------------|--------------------------------------------------------------|
| `mergeGalleryPhotos(authored, uploaded)` | Pure merge of an authored photo list with uploaded Firestore `photos` docs. The authored list comes first (in order), then uploaded photos sorted by `takenAt` ascending. Deduped by URL, bounded by `REMINISCE_GALLERY_MAX` (1000 — a sanity ceiling; in practice the gallery shows every uploaded photo), each normalized to `{ url, alt, width?, height? }` (uploaded photos get `alt: "Photo by <uploader>"`; `width`/`height` pass through when both are finite). Every URL is validated through `safeUrl` — anything rejected is dropped. Uploaded docs are additionally origin-gated to `https://firebasestorage.googleapis.com` (defense-in-depth). Exported for tests + the bootstrap. The reminisce render path calls it with an empty authored array (`mergeGalleryPhotos([], docs)`) so the gallery shows uploaded photos only. |
| `setSubscribePhotos(fn)` | Wires (or clears) the live-photo subscription seam. `fn` is `(iso, cb) => unsubscribe` — `cb` receives the array of uploaded photo docs for that ISO date and is called on every change. The bootstrap wires this to the Firestore `onSnapshot` listener; pass `null` to detach. **When the seam is null** (every test, and any non-Firebase host), `renderDay`'s reminisce branch renders the **empty-state** — the gallery is uploads-only and there is no authored-photo fallback. |
| `tileSpanClass(width, height)` | Pure mosaic span classifier. Returns `'gallery-tile-tall'` (portrait, h/w ≥ 1.2 → 2 rows), `'gallery-tile-wide'` (landscape, w/h ≥ 1.2 → 2 cols), or `''` (square / missing / non-finite). Used by the reminisce gallery to assign grid spans from each photo's orientation-corrected dims before any image loads. Exported for tests. |

### The reminisce gallery

On a **past** day (the `'reminisce'` framing), `renderDay` drops the hero slideshow
and shows a photo gallery instead. The gallery is **uploads-only, live, and
scrollable**: it shows every uploaded photo for that date in a **~66vh
internally-scrollable 2-column mosaic**, so the rest of the day page stays
reachable regardless of photo count. The hand-authored stock `day.photos` are
excluded — they continue to drive the hero on anticipation/plan days. Uploads are
sorted by capture time. Tapping a thumbnail opens a full-screen swipeable lightbox.
A past day with no uploads shows an empty-state note.

**Mosaic layout.** Each tile's span is determined by its orientation-corrected
dimensions (stored in the Firestore doc at upload time, so no layout shift while
scrolling): portrait (h/w ≥ 1.2) → 2-row tall tile; landscape (w/h ≥ 1.2) → 2-col
wide tile; otherwise 1×1. Photos without stored dims (bail-path originals) render
as 1×1.

**Lightbox.** Slides are lazy-loaded — opening the lightbox does not eager-load the
whole set. Each index change preloads the immediate neighbors (i±1). The counter
reads "n / N" against the true total.

`start()` opens the live Firestore subscription and `stop()` closes it. While the
first snapshot is pending, the seam reads `"Loading…"`. A snapshot that arrives
while the lightbox is open is deferred and applied on close (the open viewer is
never disrupted). Scrolling position is preserved across live-snapshot rebuilds.
The gallery is offline-readable from the local cache after the first load. Live
photos depend on the `firebase-photo-rules` deployment; with no Firebase the
gallery shows the empty-state.

**Photo upload** — the ☰ menu's **Add photos** row is wired to a real upload flow
(see "Adding photos" below). These exports are the testable pure cores + the
injected-seam orchestrator behind it; downstream screens (the live gallery) import
the same data shape:

| Function                | Returns / effect                                              |
|-------------------------|--------------------------------------------------------------|
| `readCaptureDate(buffer)` | Reads a JPEG's EXIF `DateTimeOriginal` from an `ArrayBuffer` and returns a `YYYY-MM-DD` bucket-date string, or `null` if absent/unreadable. Exported for tests. |
| `readExifDateTimeOriginal(buffer)` | Lower-level: walks the JPEG APP1/Exif sub-IFD and returns the raw EXIF datetime string (`"2026:06:25 23:30:00"`), or `null`. Exported for tests. |
| `exifDateTimeString(raw)` | Normalizes a raw EXIF datetime into a sortable `"YYYY-MM-DD HH:MM:SS"` string (the `takenAt` field), or `null`. Exported for tests. |
| `bucketDateFromExif(normalized)` | Extracts the `YYYY-MM-DD` day from a normalized EXIF datetime string. Exported for tests. |
| `compositeKey(uploader, exifDateTime, originalFileSize)` | Builds the best-effort dedup key (`uploader + EXIF datetime + original file size`) — computable with no image decode, so re-adds skip before any upload. Exported for tests. |
| `decideFile({ uploader, exifDateTime, date, size, dedupSet, windowSet })` | Pure per-file decision: keep / skip-out-of-window / skip-dedup. Exported for tests. |
| `summarizeRun({ added, dupes, skipped, errors, days })` | Tallies a run into the end-summary string ("Added N across D days · M already in journal"). Exported for tests. |
| `sanitizePathSegment(s)` | Defensively sanitizes a string for use in a Storage path segment (the uploader name). Exported for tests. |
| `getUploader()` / `setUploader(name)` | Read/write the per-device uploader identity (`localStorage['jt:uploader']`), `localStorage`-throw-safe. Exported for tests. |
| `sniffImageType(buffer)` | Pure magic-byte sniffer over a file's first 16 bytes (`file.slice(0, 16)`) → `{ ext, contentType }` for JPEG/PNG/GIF/WebP/HEIC-family/TIFF/BMP, or `null` if unidentifiable. Used by the upload bail path to label original bytes honestly when both downscale decoders fail (never stamp a HEIC as `.jpg`). SVG is deliberately not recognized. Accepts an `ArrayBuffer` or `Uint8Array`. Exported for tests. |
| `wirePhotoSync(deps)` | The injected-seam orchestrator → `{ run(currentIso) }`. `deps` supplies the picker, EXIF reader, downscaler, upload/write/dedup functions (à la `wireAuthGate`), so the upload loop is unit-testable with stubs and no Firebase. The browser bootstrap wires the real Firebase-backed `deps`. The `uploadBlob` dep signature is `uploadBlob(path, blob, contentType = 'image/jpeg')` — the success path uses the JPEG default; when both downscale decoders fail, the loop uploads the original bytes with the sniffed contentType (and a matching path extension) instead. Also accepts an optional `runMarker` dep (`{ start, beat, clear }`, no-op default, throw-safe) — written when files are prepared, restamped per file, cleared on finish. |
| `buildProgressSheet({ setTimer, clearTimer })` | Builds the upload progress UI: a state machine (expanded modal ⇄ minimized floating pill ⇄ success-fade) behind a `{ setProgress(done, total), finish(summaryText, meta?), destroy() }` contract. A "–" header button or a backdrop tap minimizes it to a body-mounted `.photo-progress-pill` (`⬆ N of M`, or `⬆ Adding photos…` before totals are known, or `✓ N added` on finish-while-minimized which auto-fades ~5s); tap the pill to re-expand. Modal and pill never coexist. `finish`'s optional 2nd arg `{ added }` supplies the honest pill count. Exported for tests. |
| `readRunMarker()` / `writeRunMarker(m)` / `clearRunMarker()` | Throw-safe read/write/clear of the interrupted-run marker — `localStorage['jt:upload-run']`, JSON `{ startedAt, total, done, beatAt }` (epoch ms via `getNow()`). `readRunMarker` returns a freshly-built object copying only the 4 validated numeric fields (malformed JSON → cleared + absent). Exported for tests. |
| `createRunMarker({ now, heartbeatMs, setTimer, clearTimer })` | Builds the `{ start, beat, clear }` `runMarker` for `wirePhotoSync` — writes on `start(total)`, restamps `beatAt` on each `beat(done)` and on a heartbeat interval, clears on `clear()`. Exported for tests. |
| `checkInterruptedRun({ read, clear, now, notify, staleMs })` | The boot-only stale-marker check → `{ action: 'none' \| 'live' \| 'cleared' \| 'notified' }`. A fresh heartbeat (age < `staleMs`, default `RUN_MARKER_STALE_MS` = 60s) is `'live'` (no notice); a stale marker with `done < total` clears-then-notifies exactly once. Exported for tests. |
| `buildModalSheet(opts)` | Internal modal helper; gained an opt-in `onBackdrop` option that fires only when the click target is the overlay/backdrop (not the card). |

**Immutability / copy-safety:** everything the API hands back is deeply frozen,
so callers can't accidentally corrupt the shared data. `getDays()` additionally
returns a new array each call, so you can sort/filter the result freely.

### How the smart landing works

When the page loads, `mountApp` calls `pickLandingView` to choose the opening screen:

- **Before Jun 16** (pre-trip): the pre-trip home screen — a live countdown showing days until departure and a tappable index of all 18 trip days. All rows are marked "Planned" (the trip is fully authored). Tapping any row navigates to that day's view. Today's row is highlighted when the trip is active.
- **Jun 16 – Jul 3** (during the trip): today's day view in its lifecycle framing — `'anticipation'` in the morning, `'plan'` through the day, `'reminisce'` once the day has passed.
- **After Jul 3** (post-trip): the last authored day in `'reminisce'` framing.

The nav bar's prev/next chevrons page through all 18 dates. All days are now authored; if a day is ever removed, the app renders a placeholder rather than crashing. The trip overview is reachable at any time via ☰ → Home in the nav bar.

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

## Adding photos

During the trip, the day-nav **☰** menu has an **Add photos** row. Tap it to
contribute photos to the shared journal:

1. The first time on a device, the app asks **"Who's uploading?"** (one of the
   four travelers) and remembers your choice on that device.
2. The native photo picker opens — select your recent shots (over-select freely)
   and tap Add.
3. Each photo is filed under the **day it was taken** (read from its EXIF capture
   date), shrunk for a fast upload, and added to the shared journal. A progress
   sheet and an end summary show what landed.

A few deliberate behaviours:

- **Minimize and keep browsing.** The progress sheet has a **"–" button** (and a
  tap on the dimmed backdrop) that shrinks it to a small **floating pill** — `⬆ 12
  of 30` with a live count — so you can keep planning the day while the upload
  runs. Tap the pill to expand the full sheet again. If a run finishes while
  minimized, the pill shows `✓ N added` and fades away after a few seconds. (The
  pill makes "still uploading" visible — uploads pause if you lock the phone or
  background the app, an OS limitation, so don't lock thinking it's done.)
- **Interrupted uploads are caught on relaunch.** If the app is killed mid-upload
  (the OS reclaims a frozen tab, a quit, a crash, a restart), the **next launch**
  shows a one-time notice — "Your last upload was interrupted: 14 of 30 made it" —
  and you simply re-select the photos; the dedup skips the ones that already
  landed, so it tops up only the missing ones. A normal background-and-return
  (where the page just resumes) shows **no** notice.

- **Nothing overwrites.** Every photo uploads to a unique path, so a photo can
  never replace another — duplicates are possible, photo loss is not.
- **Re-adding is safe.** Re-selecting photos you already uploaded is skipped
  (best-effort dedup), so you can tap Add again without making copies.
- **Correct day, no silent guesses.** When a photo has no readable EXIF capture
  date, the app falls back to the file's last-modified day. Only when even that
  hint is missing does it ask you to confirm a single date for that batch,
  instead of filing it on the wrong day. Photos taken outside the trip window are
  skipped.
- **Add photos is only enabled once the trip has started.** Before Jun 16 the row
  is disabled.
- **A photo that won't shrink still gets in, correctly labeled.** Downscaling runs
  in a Web Worker; if it fails on a file, the app retries once on a different
  (main-thread) decoder, and only if *that* fails too does it upload the original
  full-size bytes. Those originals are stored with their true format sniffed from
  the file's first bytes (`.heic` stays `.heic`, never a false `.jpg`), so the
  archive never holds a mislabeled file. This happens silently — you just see a
  normal upload.

Your **full-resolution originals stay in your camera roll** — the journal stores
a downscaled copy for viewing, not a backup. Adding photos requires connectivity
(there's no offline upload queue); an offline tap shows a clear error.

> The viewing side is live: uploaded photos appear in each past day's reminisce
> gallery (see "The reminisce gallery" above), updated in real time. The gallery
> is uploads-only — the stock authored photos are excluded. This flow gets photos *in*.

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
previously-viewed photos (and the fonts) also load offline afterward. This
runtime cache is capped at 450 entries (oldest evicted first), so it can't grow
without bound over a long trip — sized to keep a full day's photo set warm offline.
Google Maps links still require a network connection.

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

The test suite (**587 total** — `app.test.js` + `sw.test.js`) covers the data validation, `dayNumber` derivation, the null-on-absent
lookups, the immutability guarantees, the day-view render layer (haversine
math, `safeUrl` scheme gating, framing variants, recommendation expansion,
sparse/absent-day placeholders — via a dependency-free hand-rolled DOM stub),
the date/time-aware navigation layer (`frameForDay`, `pickLandingView`,
`isEveningWindow`, `tripWindowDates`, `mountApp`, and the `getNow`/`setNow` clock seam),
the pre-trip home screen (`renderOverview` countdown states, day-index rows, today-highlighting),
the time-travel override layer (`parseNowOverride`, `resolveNowOverride`, precedence, clear tokens),
collapsible day-parts (`bucketPlanByDayPart` bucketing, `dayParts` validation, day-part section rendering),
Hakone content contracts (Romancecar terminus/reserved, transit minutes, veg coverage, lodging consistency, contiguous 18-day span),
the auth gate (login form present + native-submit guard),
the ☰ nav menu (inline-SVG hamburger icon, hamburger popover, iconified Home/Add-photos rows, the `role="separator"` divider and its focus-trap exclusion, `opts.onAddPhotos` seam),
the photo-upload flow (EXIF capture-date parsing against synthetic JPEG fixtures, trip-window filtering, composite-key dedup, run summaries, the `wirePhotoSync` orchestrator via injected seams, and the downscale bail path — `sniffImageType` magic-byte detection and the retry-then-honest-label upload),
the live reminisce gallery (`mergeGalleryPhotos` ordering/dedup/cap, the `setSubscribePhotos` seam, snapshot re-render + seam count, deferred rebuild while the lightbox is open, uploads-only gallery, the seam-absent empty-state, and the uploaded-URL origin allowlist — `isAllowedUploadOrigin` host-confusion vectors plus authored-kept-vs-uploaded-dropped branch isolation),
and the scrollable photo mosaic (`tileSpanClass` boundary units for portrait/landscape/square/degenerate inputs, `mergeGalleryPhotos` dims passthrough, dispatcher dims threading, render mosaic span-class assignment, crossorigin attributes, lightbox lazy-load + neighbor preload, scrollTop preservation across snapshot rebuilds, and `wirePhotoSync`→`writeDoc` dims-persistence).

## Deploy

Push to `main` and GitHub Pages deploys automatically via `deploy-pages.yml`.

Note: the **entire repo root is uploaded as the Pages artifact and served
publicly** — don't commit anything to the root you wouldn't want on the public
internet.
