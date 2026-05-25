// app.js — render pipeline + public helper API for the Japan trip companion.
//
// Single source of truth is data/days.js. This module:
//   1. imports TRIP + DAYS,
//   2. validates them on load (non-fatal: warns, never throws),
//   3. attaches a derived 1-based `dayNumber` to each day,
//   4. exposes named helpers (getTrip / getDays / getDay / getDayByNumber)
//      that downstream screen tasks build on, and
//   5. renders a minimal proof-of-pipeline into #app-root on DOMContentLoaded.
//
// Downstream tasks (day-view-screen, date-time-aware-navigation,
// trip-overview-home) import the helpers below; renderInto() is the seam they
// will replace with the real screens.
//
// SECURITY: all data-derived strings reach the DOM via textContent / createElement
// only — never innerHTML with interpolated data — so untrusted content in
// data/days.js cannot inject markup (XSS-safe).

import { TRIP, DAYS } from './data/days.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Parse an ISO "YYYY-MM-DD" string to a Date at UTC midnight.
 * Using UTC avoids local-timezone drift when subtracting dates for dayNumber.
 * Returns null for anything that is not a valid YYYY-MM-DD date.
 * @param {unknown} iso
 * @returns {Date | null}
 */
function parseISODate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Round-trip check catches impossible dates like 2026-02-30.
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/**
 * 1-based day number relative to a trip-start ISO date. Start day => Day 1.
 * @param {string} iso the day to number
 * @param {string} startIso the trip's start date (defaults to TRIP.start)
 * @returns {number | null}
 */
function deriveDayNumber(iso, startIso = TRIP.start) {
  const start = parseISODate(startIso);
  const day = parseISODate(iso);
  if (!start || !day) return null;
  return Math.round((day.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

/** Assemble a zero-padded ISO "YYYY-MM-DD" string from calendar components. */
function padDate(year, month, day) {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/**
 * Format a Date as a local-calendar ISO "YYYY-MM-DD" string. Uses the LOCAL
 * Y/M/D (not UTC) because "today" for a traveler is their local calendar day —
 * comparing against the trip's local ISO dates this way is timezone-correct.
 * @param {Date} date
 * @returns {string | null}
 */
function localISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return padDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Whole-calendar-day difference (b − a) between two ISO "YYYY-MM-DD" strings.
 * Positive when b is after a. Returns null if either is unparseable. Uses the
 * UTC-midnight parse so DST never skews the day count.
 * @param {string} aIso
 * @param {string} bIso
 * @returns {number | null}
 */
function dayDelta(aIso, bIso) {
  const a = parseISODate(aIso);
  const b = parseISODate(bIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Clock seam — ALL "current time" reads go through getNow() so the clock can be
// overridden (the time-travel-test-mode task swaps it; unit tests pin it). Never
// call `new Date()` directly in the navigation/landing logic below.
// ---------------------------------------------------------------------------

let nowProvider = () => new Date();

/**
 * The single source of "now" for the whole app. Returns a Date. Defaults to the
 * real wall clock; override via setNow() (e.g. time-travel mode, tests).
 * @returns {Date}
 */
export function getNow() {
  let d;
  try {
    d = nowProvider();
  } catch {
    d = null; // a throwing provider degrades to the wall clock, same as a bad return
  }
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
}

/**
 * Override the clock. Pass a function returning a Date to pin/scrub "now"; pass
 * null/undefined to restore the real wall clock. Returns the active provider.
 * @param {(() => Date) | null | undefined} fn
 * @returns {() => Date}
 */
export function setNow(fn) {
  nowProvider = typeof fn === 'function' ? fn : () => new Date();
  return nowProvider;
}

// ---------------------------------------------------------------------------
// Time-travel test mode — INERT BY DEFAULT.
//
// On module load (browser only) we look for a "now" override from two sources,
// in this PRECEDENCE order:
//   1. the URL query param `?now=...`  (wins — lets you bookmark/share a moment)
//   2. localStorage key `jt:now`        (a sticky override set by the test page)
//
// A `datetime-local` value like "2026-06-25T22:00" is parsed by new Date() as
// LOCAL time — exactly what we want (the traveler's local wall clock). When an
// override resolves, we pin the clock via setNow(() => new Date(<override>)) so
// every getNow() read across the app sees the simulated moment.
//
// CLEARING: `?now=clear` (or an empty `?now=`) removes the stored override and
// restores the real clock. The test page also clears localStorage directly.
//
// PERSISTENCE CHOICE: a URL `?now=...` is mirrored into localStorage so the
// override survives the app's OWN internal navigation. mountApp()/the nav
// controller re-read getNow() but never re-append `?now` to internal link
// state, so without persistence the override would silently evaporate the
// instant you paged to the next day. Mirroring keeps "I'm in 10pm Kyoto" sticky
// across taps. The tradeoff: the override outlives the tab until explicitly
// cleared — which is why the active-override indicator (below + in index.html)
// exists, and why `?now=clear` is a first-class, easy escape hatch.
//
// NEVER throws at load: bad input is ignored and the real clock is used.
// ---------------------------------------------------------------------------

const NOW_OVERRIDE_KEY = 'jt:now';
const NOW_CLEAR_TOKENS = new Set(['', 'clear', 'off', 'real', 'reset']);

/**
 * Parse a time-travel "now" string (a datetime-local value, or any string
 * new Date() accepts) into a valid Date, or null if unparseable. LOCAL-time
 * parse is intentional — the override means the traveler's local wall clock.
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseNowOverride(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const d = new Date(trimmed);
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
}

/** Safe localStorage read — returns null if storage is unavailable/blocked. */
function readStoredOverride() {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(NOW_OVERRIDE_KEY)
      : null;
  } catch {
    return null; // private mode / disabled storage → no override
  }
}

/** Safe localStorage write of the override (no-op if storage is unavailable). */
function writeStoredOverride(value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NOW_OVERRIDE_KEY, value);
    }
  } catch {
    /* storage unavailable — URL override still pins the clock for this load */
  }
}

/** Safe localStorage clear of the override (no-op if storage is unavailable). */
function clearStoredOverride() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(NOW_OVERRIDE_KEY);
    }
  } catch {
    /* nothing to do */
  }
}

/**
 * Resolve and apply the time-travel override at module load. Reads the `?now`
 * URL param first, then the stored override, and pins the clock via setNow()
 * when one is valid. Returns the active override Date (so index.html can show
 * the indicator), or null when none is active (real clock). Side-effecting but
 * idempotent: touches location/localStorage/setNow, browser-only. Never throws.
 * @returns {Date | null}
 */
export function resolveNowOverride() {
  if (typeof window === 'undefined') return null;

  let urlParam = null;
  try {
    urlParam = new URL(window.location.href).searchParams.get('now');
  } catch {
    urlParam = null; // unparseable location → ignore the URL source
  }

  // 1) URL param present (even empty) takes precedence and is authoritative.
  if (urlParam !== null) {
    if (NOW_CLEAR_TOKENS.has(urlParam.trim().toLowerCase())) {
      clearStoredOverride();
      return null; // real clock
    }
    const parsed = parseNowOverride(urlParam);
    if (parsed) {
      writeStoredOverride(urlParam.trim()); // mirror so it survives internal nav
      setNow(() => new Date(parsed.getTime()));
      return parsed;
    }
    // Bad ?now value → ignore it and fall through to any stored override.
  }

  // 2) Stored override (set by the test page / a prior URL load).
  const stored = readStoredOverride();
  const parsedStored = parseNowOverride(stored);
  if (parsedStored) {
    setNow(() => new Date(parsedStored.getTime()));
    return parsedStored;
  }

  return null; // no override → real wall clock (inert default)
}

// Apply any override as the module loads, before the bootstrap mount below
// reads getNow(). Inert when no ?now / stored override is present.
const ACTIVE_NOW_OVERRIDE = typeof window !== 'undefined' ? resolveNowOverride() : null;

// ---------------------------------------------------------------------------
// Validation (runs once on import; non-fatal)
// ---------------------------------------------------------------------------

/**
 * Recursively Object.freeze a value and everything reachable from it, so the
 * public helpers can hand out objects callers cannot mutate. Cheap here: the
 * dataset is ~10 days of small plain objects/arrays, frozen once at build time.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/**
 * Validate a days array against a trip, attach derived dayNumber, and return a
 * date-sorted, deeply-frozen copy of the valid entries. Malformed entries are
 * warned about and skipped — the site must still render whatever is valid. Days
 * absent from the array (e.g. Jun 16–23, content owed later) are simply not
 * present; lookups for them return null.
 *
 * Each returned day (and its nested objects) is frozen so downstream callers
 * cannot corrupt the shared internal state behind the accessors. The returned
 * array itself is frozen too; getDays() additionally hands out a fresh copy.
 *
 * Pure over its arguments (no dependence on module-level DAYS/TRIP) so the
 * skip/degrade-gracefully path can be unit-tested with synthetic malformed
 * input. The module-level VALIDATED_DAYS below calls it with the real data.
 *
 * @param {unknown} days candidate days array (defaults to the real DAYS)
 * @param {object} trip trip metadata supplying the start date (defaults to TRIP)
 * @returns {ReadonlyArray<object>}
 */
export function buildValidatedDays(days = DAYS, trip = TRIP) {
  if (!Array.isArray(days)) {
    console.warn('[app] DAYS is not an array; rendering nothing.');
    return Object.freeze([]);
  }
  const startIso = trip?.start;
  if (!parseISODate(startIso)) {
    console.warn(`[app] TRIP.start "${startIso}" is not a valid ISO date; dayNumber will be null.`);
  }

  const valid = [];
  days.forEach((day, i) => {
    if (!day || typeof day !== 'object') {
      console.warn(`[app] DAYS[${i}] is not an object; skipping.`);
      return;
    }
    const parsed = parseISODate(day.date);
    if (!parsed) {
      console.warn(`[app] DAYS[${i}] has invalid date "${day.date}"; skipping.`);
      return;
    }
    // Shape sanity checks — warn but keep the day (partial content is allowed).
    if (!Array.isArray(day.plan)) {
      console.warn(`[app] ${day.date}: "plan" is not an array; treating as empty.`);
    }
    if (!Array.isArray(day.photos)) {
      console.warn(`[app] ${day.date}: "photos" is not an array; treating as empty.`);
    }

    valid.push({
      sortKey: parsed.getTime(), // cached for sorting; dropped before freezing
      day: { ...day, dayNumber: deriveDayNumber(day.date, startIso) },
    });
  });

  valid.sort((a, b) => a.sortKey - b.sortKey); // ascending by date
  return Object.freeze(valid.map((entry) => deepFreeze(entry.day)));
}

const VALIDATED_DAYS = buildValidatedDays();

// Deeply-frozen trip so getTrip() callers can't corrupt shared module state —
// consistent with the day accessors, which already hand out frozen data.
const FROZEN_TRIP = deepFreeze({
  ...TRIP,
  travelers: [...TRIP.travelers],
  eveningWindow: { ...TRIP.eveningWindow },
});

// ---------------------------------------------------------------------------
// Public helper API (named exports — downstream screens depend on these)
// ---------------------------------------------------------------------------

/** @returns {Readonly<typeof TRIP>} the deeply-frozen trip metadata object. */
export function getTrip() {
  return FROZEN_TRIP;
}

/**
 * Validated, date-sorted days (each has dayNumber). Returns a fresh array each
 * call so callers cannot mutate the shared internal list; the day objects within
 * are deeply frozen, so they cannot be mutated either.
 * @returns {Array<Readonly<object>>}
 */
export function getDays() {
  return VALIDATED_DAYS.slice();
}

/**
 * Look up a day by ISO date. Returns null for any absent date (e.g. the
 * not-yet-authored Jun 16–23 range) so callers degrade gracefully. The returned
 * day is deeply frozen and cannot be mutated.
 * @param {string} iso "YYYY-MM-DD"
 * @returns {Readonly<object> | null}
 */
export function getDay(iso) {
  return VALIDATED_DAYS.find((d) => d.date === iso) ?? null;
}

/**
 * Look up a day by its derived 1-based dayNumber, or null if absent. The
 * returned day is deeply frozen and cannot be mutated.
 * @param {number} n
 * @returns {Readonly<object> | null}
 */
export function getDayByNumber(n) {
  // Guard non-finite input: in a degraded build (unparseable TRIP.start) every
  // dayNumber is null, so getDayByNumber(null)/(undefined) would false-match the
  // first day. Reject anything that isn't a real number up front.
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return VALIDATED_DAYS.find((d) => d.dayNumber === n) ?? null;
}

// ---------------------------------------------------------------------------
// Lifecycle + landing logic (pure, exported for unit tests)
//
// All of these take an explicit `now` (a Date) so they're deterministic and
// testable; production callers pass getNow(). They compare by LOCAL CALENDAR
// DAY (via localISODate) so "today" means the traveler's current day, not a raw
// timestamp.
// ---------------------------------------------------------------------------

/**
 * Pick the lifecycle framing for a day relative to `now`:
 *   future calendar day  → 'anticipation'
 *   same calendar day    → 'plan'
 *   past calendar day    → 'reminisce'
 * Compares calendar days (local), not timestamps. Accepts either a day object
 * (reads `day.date`) or an ISO "YYYY-MM-DD" string. Defaults to 'plan' when the
 * day/date is missing or unparseable (safe fallback for absent days).
 * @param {object|string|null} day a day object, an ISO date string, or null
 * @param {Date} [now=getNow()]
 * @returns {'anticipation'|'plan'|'reminisce'}
 */
export function frameForDay(day, now = getNow()) {
  const iso = typeof day === 'string' ? day : day?.date;
  const todayIso = localISODate(now);
  const delta = dayDelta(todayIso, iso);
  if (delta == null) return 'plan';
  if (delta > 0) return 'anticipation';
  if (delta < 0) return 'reminisce';
  return 'plan';
}

/**
 * Is `now` inside the evening "prep for tomorrow" window? The window wraps
 * midnight (e.g. 21:00–04:00), so membership is `hour >= startHour ||
 * hour < endHour`. Reuses TRIP.eveningWindow by default — never hardcode the
 * hours. A non-wrapping window (start < end) is also handled.
 * @param {Date} now
 * @param {{startHour:number,endHour:number}} [window=getTrip().eveningWindow]
 * @returns {boolean}
 */
export function isEveningWindow(now, window = getTrip().eveningWindow) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false;
  const start = window?.startHour;
  const end = window?.endHour;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const hour = now.getHours();
  if (start === end) return false;          // empty/degenerate window
  if (start < end) return hour >= start && hour < end; // same-day window
  return hour >= start || hour < end;        // wraps midnight
}

/**
 * Decide what to show when the app opens, given `now`. Pure: reads TRIP via
 * getTrip() and days via getDay/getDays; returns a descriptor the mount logic
 * consumes (it never touches the DOM).
 *
 * Rules:
 *   before the trip (today < TRIP.start) → { view:'overview', day:null, daysUntil }
 *   during the trip (start ≤ today ≤ end) → { view:'day', day, framing:'plan' }
 *        (day may be null for the unauthored Jun 16–23 leg — renderDay handles it)
 *   after the trip (today > TRIP.end)    → { view:'day', day:lastDay, framing:'reminisce' }
 *        falling back to { view:'overview' } only if there are no days at all.
 *
 * @param {Date} [now=getNow()]
 * @returns {{view:'overview', day:null, daysUntil:number|null}
 *         | {view:'day', day:object|null, framing:'anticipation'|'plan'|'reminisce'}}
 */
export function pickLandingView(now = getNow()) {
  const trip = getTrip();
  const todayIso = localISODate(now);
  const toStart = dayDelta(todayIso, trip.start); // >0 ⇒ trip is in the future
  const afterEnd = dayDelta(trip.end, todayIso);  // >0 ⇒ today is past the trip

  // Before the trip → overview + countdown (how many days until Day 1).
  if (toStart != null && toStart > 0) {
    return { view: 'overview', day: null, daysUntil: toStart };
  }

  // After the trip → land on the last day in reminisce (fallback: overview).
  if (afterEnd != null && afterEnd > 0) {
    const days = getDays();
    const last = days.length ? days[days.length - 1] : null;
    if (last) return { view: 'day', day: last, framing: 'reminisce' };
    return { view: 'overview', day: null, daysUntil: null };
  }

  // During the trip (today within [start, end], inclusive) → today's day view.
  // getDay returns null for the unauthored leg; renderDay renders a placeholder.
  const today = todayIso ? getDay(todayIso) : null;
  return { view: 'day', day: today, framing: frameForDay(todayIso, now) };
}

// ---------------------------------------------------------------------------
// Geo helper (pure, exported for unit tests)
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000; // mean Earth radius in metres

/**
 * Great-circle (haversine) distance in METRES between two {lat,lng} points.
 * Pure and side-effect-free; exported so the distance math is unit-testable
 * without a DOM. Returns null if either coordinate is missing or non-finite,
 * so callers can omit the distance gracefully (no geolocation / GPS involved —
 * this works purely off coords stored in data/days.js).
 * @param {{lat:number,lng:number}|null|undefined} a
 * @param {{lat:number,lng:number}|null|undefined} b
 * @returns {number | null} distance in metres, or null when uncomputable
 */
export function haversineMeters(a, b) {
  if (!a || !b) return null;
  const { lat: lat1, lng: lng1 } = a;
  const { lat: lat2, lng: lng2 } = b;
  if (
    typeof lat1 !== 'number' || typeof lng1 !== 'number' ||
    typeof lat2 !== 'number' || typeof lng2 !== 'number' ||
    !Number.isFinite(lat1) || !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lng2)
  ) {
    return null;
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Format a metre distance as a short human label, plus a rough walking time at
 * ~80 m/min (a relaxed sightseeing pace). Returns null for null/non-finite
 * input so callers can omit it.
 * @param {number|null} meters
 * @returns {string | null}
 */
export function formatWalk(meters) {
  if (meters == null || !Number.isFinite(meters)) return null;
  const mins = Math.max(1, Math.round(meters / 80));
  const dist = meters < 950
    ? `${Math.round(meters / 10) * 10} m`
    : `${(meters / 1000).toFixed(1)} km`;
  return `~${dist} · ${mins} min walk`;
}

// ---------------------------------------------------------------------------
// Rendering (day-view-screen) — builds one day's DOM from a day object.
//
// SECURITY: every data-derived string reaches the DOM via textContent /
// createElement only (the el() helper). Data URLs are scheme-checked by
// safeUrl() before they touch href/src; external links get rel + target.
// ---------------------------------------------------------------------------

/** Small helper: create an element with a text child, all via safe DOM APIs. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

/**
 * Return a URL only if it uses an http(s) scheme; otherwise null. Blocks
 * javascript:/data:/etc. so a malicious URL in the data can never become an
 * executable href/src. Relative/root-relative URLs are allowed (no scheme).
 *
 * The WHATWG URL parser strips ASCII tab/newline/CR from a URL before parsing,
 * so `java\tscript:` would re-form into a live `javascript:` href. We strip the
 * same characters BEFORE the scheme check to close that bypass.
 * @param {unknown} url
 * @returns {string | null}
 */
export function safeUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.replace(/[\t\n\r]/g, '').trim();
  if (trimmed === '') return null;
  // No scheme (relative path) → safe to use as-is.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return /^https?:/i.test(trimmed) ? trimmed : null;
}

/** Build a safe external link (map link), or null if the URL is unusable. */
function mapLink(url, label) {
  const safe = safeUrl(url);
  if (!safe) return null;
  const a = el('a', 'map-link', label ?? 'Open in Google Maps');
  a.href = safe;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

const TAG_LABELS = {
  meal: 'Meal',
  transit: 'Transit',
  sight: 'Sight',
  checkin: 'Check-in',
  reservation: 'Reservation',
  rest: 'Rest',
  bar: 'Drinks',
  spa: 'Spa',
};

const FRAMINGS = {
  anticipation: {
    className: 'framing-anticipation',
    kicker: 'Coming up',
    leadPrefix: "What's ahead:",
    planHeading: 'The plan',
  },
  plan: {
    className: 'framing-plan',
    kicker: 'Today',
    leadPrefix: '',
    planHeading: 'The plan',
  },
  reminisce: {
    className: 'framing-reminisce',
    kicker: 'Looking back',
    leadPrefix: 'Remember:',
    planHeading: 'How the day went',
  },
};

/**
 * Pick the coords to measure a recommendation walk FROM: the nearest preceding
 * plan item (scanning backwards) that has coords, falling back to the day's
 * lodging coords. Returns null when nothing usable precedes it.
 * @param {Array<object>} plan
 * @param {number} index the index of the current (recommendation) plan item
 * @param {object|null} lodging
 * @returns {{from:{lat:number,lng:number}, label:string} | null}
 */
export function nearestPrecedingCoords(plan, index, lodging) {
  for (let i = index - 1; i >= 0; i--) {
    const c = plan[i]?.coords;
    if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
      return { from: c, label: plan[i].title ?? 'the previous stop' };
    }
  }
  const lc = lodging?.coords;
  if (lc && typeof lc.lat === 'number' && typeof lc.lng === 'number') {
    return { from: lc, label: lodging.name ?? 'your lodging' };
  }
  return null;
}

/** Build the auto-crossfading hero slideshow (or a single static image under
 * reduced-motion / a lone photo). Returns { node, start, stop } so the caller
 * controls the timer lifecycle. */
function buildHero(photos, framing) {
  const valid = (Array.isArray(photos) ? photos : [])
    .map((p) => ({ ...p, safe: safeUrl(p?.url) }))
    .filter((p) => p.safe);

  const hero = el('div', 'day-hero');
  hero.classList.add(framing.className + '-hero');

  if (valid.length === 0) {
    hero.classList.add('day-hero-empty');
    hero.setAttribute('role', 'img');
    hero.setAttribute('aria-label', 'No photos yet for this day');
    return { node: hero, start() {}, stop() {} };
  }

  // Detect reduced-motion at build time; if matched, render one static image.
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const slidesToShow = reduceMotion ? valid.slice(0, 1) : valid;
  const slideEls = [];

  slidesToShow.forEach((p, i) => {
    const slide = el('div', 'hero-slide');
    if (i === 0) slide.classList.add('is-active');
    const img = el('img');
    img.src = p.safe;
    img.alt = p.alt ? String(p.alt) : '';
    img.loading = i === 0 ? 'eager' : 'lazy';
    img.decoding = 'async';
    slide.appendChild(img);
    hero.appendChild(slide);
    slideEls.push(slide);
  });

  // Gradient scrim + kicker overlay (purely decorative scrim is aria-hidden).
  const scrim = el('div', 'hero-scrim');
  scrim.setAttribute('aria-hidden', 'true');
  hero.appendChild(scrim);

  let timer = null;
  let idx = 0;
  const canCycle = !reduceMotion && slideEls.length > 1;

  return {
    node: hero,
    start() {
      if (!canCycle || timer) return;
      timer = setInterval(() => {
        slideEls[idx].classList.remove('is-active');
        idx = (idx + 1) % slideEls.length;
        slideEls[idx].classList.add('is-active');
      }, 4500);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

// Monotonic id source for rec-panel aria wiring — deterministic and
// collision-free even if multiple day-views are ever mounted at once.
let recPanelSeq = 0;

/** Build one plan item (timeline row), wiring recommendation expansion. */
function buildPlanItem(item, index, plan, lodging) {
  const isReserved = item.reserved === true;
  const li = el('li', 'plan-item' + (isReserved ? ' plan-item-reserved' : ''));

  const rail = el('div', 'plan-rail');
  rail.appendChild(el('span', 'plan-dot', ''));
  li.appendChild(rail);

  const body = el('div', 'plan-body');

  const head = el('div', 'plan-head');
  if (item.time) head.appendChild(el('span', 'plan-time', item.time));
  const tagLabel = TAG_LABELS[item.tag] ?? item.tag;
  if (tagLabel) head.appendChild(el('span', 'plan-tag tag-' + (item.tag ?? 'other'), tagLabel));
  if (isReserved) head.appendChild(el('span', 'plan-reserved-badge', 'Reserved'));
  body.appendChild(head);

  body.appendChild(el('h3', 'plan-title', item.title ?? ''));
  if (item.note) body.appendChild(el('p', 'plan-note', item.note));

  const link = mapLink(item.mapUrl, 'Open in Google Maps');
  if (link) body.appendChild(link);

  const recs = Array.isArray(item.recommendations) ? item.recommendations : [];
  if (recs.length > 0) {
    const origin = nearestPrecedingCoords(plan, index, lodging);

    const toggle = el('button', 'rec-toggle');
    toggle.type = 'button';
    const panelId = `recs-${index}-${recPanelSeq++}`;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panelId);
    toggle.appendChild(el('span', 'rec-toggle-label', `${recs.length} option${recs.length > 1 ? 's' : ''} — tap to compare`));
    toggle.appendChild(el('span', 'rec-toggle-chev', '▾'));

    const panel = el('div', 'rec-panel');
    panel.id = panelId;
    panel.hidden = true;

    recs.forEach((rec) => {
      const card = el('div', 'rec-card');
      card.appendChild(el('h4', 'rec-name', rec?.name ?? ''));

      if (origin) {
        const dist = formatWalk(haversineMeters(origin.from, rec?.coords));
        if (dist) {
          const walk = el('p', 'rec-walk', dist);
          walk.appendChild(el('span', 'rec-walk-from', ` from ${origin.label}`));
          card.appendChild(walk);
        }
      }

      const pros = Array.isArray(rec?.pros) ? rec.pros : [];
      if (pros.length) {
        const ul = el('ul', 'rec-pros');
        pros.forEach((pro) => {
          const proLi = el('li', 'rec-pro');
          proLi.appendChild(el('span', 'rec-mark rec-mark-pro', '+'));
          proLi.appendChild(el('span', null, pro));
          ul.appendChild(proLi);
        });
        card.appendChild(ul);
      }

      if (rec?.con) {
        const con = el('p', 'rec-con');
        con.appendChild(el('span', 'rec-mark rec-mark-con', '–'));
        con.appendChild(el('span', null, rec.con));
        card.appendChild(con);
      }

      const recLink = mapLink(rec?.mapUrl, 'Map');
      if (recLink) card.appendChild(recLink);

      panel.appendChild(card);
    });

    toggle.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.classList.toggle('is-open', open);
    });

    body.appendChild(toggle);
    body.appendChild(panel);
  }

  li.appendChild(body);
  return li;
}

/** Build the lodging card (with optional breakfast note + map link). */
function buildLodging(lodging) {
  if (!lodging) return null;
  const card = el('section', 'lodging-card');
  card.appendChild(el('p', 'lodging-kicker', 'Where you sleep'));
  card.appendChild(el('h3', 'lodging-name', lodging.name ?? ''));
  if (lodging.address) card.appendChild(el('p', 'lodging-address', lodging.address));
  if (lodging.breakfast) {
    const bf = el('p', 'lodging-breakfast');
    bf.appendChild(el('span', 'lodging-breakfast-label', 'Breakfast: '));
    bf.appendChild(el('span', null, lodging.breakfast));
    card.appendChild(bf);
  }
  const link = mapLink(lodging.mapUrl, 'Open in Google Maps');
  if (link) card.appendChild(link);
  return card;
}

/**
 * Build the full day-view DOM for a single day object in one of three framings
 * (anticipation / plan / reminisce). Pure DOM construction — XSS-safe by
 * construction. Returns { node, start, stop }; the caller mounts node and calls
 * start() (begin the slideshow timer) / stop() (cleanup before re-render).
 *
 * @param {object|null} day a day object from getDay()/getDays(), or null
 * @param {'anticipation'|'plan'|'reminisce'} [framingName='plan']
 * @returns {{ node: HTMLElement, start: () => void, stop: () => void }}
 */
export function renderDay(day, framingName = 'plan') {
  const framing = FRAMINGS[framingName] ?? FRAMINGS.plan;

  const view = el('article', 'day-view ' + framing.className);

  // Absent day (e.g. the unauthored Jun 16–23 gap) — graceful empty state.
  if (!day || typeof day !== 'object') {
    view.classList.add('day-view-empty');
    const ph = el('div', 'day-placeholder');
    ph.appendChild(el('p', 'placeholder-kicker', framing.kicker));
    ph.appendChild(el('h2', 'placeholder-title', 'Details coming'));
    ph.appendChild(el('p', 'placeholder-note', "This day isn't planned out yet — check back soon."));
    view.appendChild(ph);
    return { node: view, start() {}, stop() {} };
  }

  const plan = Array.isArray(day.plan) ? day.plan : [];
  const photos = Array.isArray(day.photos) ? day.photos : [];
  const isSparse = plan.length === 0 && photos.length === 0;

  // Hero slideshow on top.
  const hero = buildHero(photos, framing);
  view.appendChild(hero.node);

  // Title block (kicker varies by framing).
  const headerBlock = el('header', 'day-header');
  const kickerRow = el('div', 'day-kicker-row');
  kickerRow.appendChild(el('span', 'day-kicker', framing.kicker));
  if (day.dayNumber != null) kickerRow.appendChild(el('span', 'day-number', `Day ${day.dayNumber}`));
  if (day.base) kickerRow.appendChild(el('span', 'day-base', day.base));
  headerBlock.appendChild(kickerRow);
  headerBlock.appendChild(el('h1', 'day-title', day.title ?? '(untitled day)'));
  if (day.intro) {
    const intro = el('p', 'day-intro');
    if (framing.leadPrefix) intro.appendChild(el('span', 'day-intro-prefix', framing.leadPrefix + ' '));
    intro.appendChild(el('span', null, day.intro));
    headerBlock.appendChild(intro);
  }
  view.appendChild(headerBlock);

  // Sparse day: "details coming" placeholder, then stop (no plan/lodging).
  if (isSparse) {
    const ph = el('div', 'day-placeholder');
    ph.appendChild(el('h2', 'placeholder-title', 'Details coming'));
    ph.appendChild(el('p', 'placeholder-note', "The plan for this day isn't filled in yet."));
    view.appendChild(ph);
    return { node: view, start: hero.start, stop: hero.stop };
  }

  // Reminisce framing: a soft seam for the future photo gallery (NOT built here).
  if (framingName === 'reminisce') {
    const seam = el('section', 'reminisce-seam');
    seam.setAttribute('aria-label', 'Your photos from this day will appear here');
    seam.appendChild(el('p', 'seam-kicker', 'Your photos'));
    seam.appendChild(el('p', 'seam-note', 'Your trip photos from this day will live here. For now, here’s how the day was planned.'));
    view.appendChild(seam);
  }

  // The plan list.
  if (plan.length) {
    const planSection = el('section', 'plan-section');
    planSection.appendChild(el('h2', 'section-heading', framing.planHeading));
    const list = el('ol', 'plan-list');
    plan.forEach((item, i) => {
      list.appendChild(buildPlanItem(item, i, plan, day.lodging ?? null));
    });
    planSection.appendChild(list);
    view.appendChild(planSection);
  }

  // Lodging card.
  const lodging = buildLodging(day.lodging ?? null);
  if (lodging) view.appendChild(lodging);

  return { node: view, start: hero.start, stop: hero.stop };
}

// ---------------------------------------------------------------------------
// Trip-window enumeration (pure) — the ordered list of EVERY calendar day in
// the trip, including the unauthored Jun 16–23 leg. Forward/back nav walks this
// list so users can page across the whole window; absent days render as
// renderDay's placeholder (its documented contract).
// ---------------------------------------------------------------------------

/**
 * Every ISO "YYYY-MM-DD" date in [trip.start, trip.end] inclusive, ascending.
 * Returns [] if the window is unparseable or inverted.
 * @param {object} [trip=getTrip()]
 * @returns {string[]}
 */
export function tripWindowDates(trip = getTrip()) {
  const start = parseISODate(trip?.start);
  const end = parseISODate(trip?.end);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const out = [];
  // parseISODate yields UTC midnight, so each step lands on a clean UTC day;
  // format from the UTC components to avoid any local-timezone drift.
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    const d = new Date(t);
    out.push(padDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pre-trip home (trip-overview-home). The {view:'overview'} landing descriptor
// maps here: a live countdown to Day 1 (with graceful during/after-trip states)
// plus a scannable, tappable index of every trip day. Pure DOM construction
// (XSS-safe via el()), no external deps.
// ---------------------------------------------------------------------------

// Region hint for the unauthored Jun 16–23 leg (not in data/days.js, which is
// read-only here). Locked from project memory (trip-skeleton). Authored days
// (Jun 24–Jul 3) read their region from the day object's `base` instead — that
// branch always wins, so once the Jun 16–23 days land in data/days.js the
// matching entries here become dead. TODO: drop this map once that leg is authored.
const UNAUTHORED_REGIONS = {
  '2026-06-16': 'Travel — NY → Tokyo',
  '2026-06-17': 'Tokyo (arrive)',
  '2026-06-18': 'Tokyo',
  '2026-06-19': 'Tokyo',
  '2026-06-20': 'Tokyo',
  '2026-06-21': 'Tokyo',
  '2026-06-22': 'Hakone',
  '2026-06-23': 'Hakone',
};

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Human-readable "Wed · Jun 24" label for an ISO date. Reads the UTC components
 * of parseISODate's UTC-midnight Date so the label never drifts by a timezone.
 * @param {string} iso
 * @returns {string} the formatted label, or the raw iso if unparseable
 */
function formatIndexDate(iso) {
  const d = parseISODate(iso);
  if (!d) return iso;
  return `${WEEKDAY_NAMES[d.getUTCDay()]} · ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Build one tappable row in the all-days index.
 * @param {string} iso
 * @param {Date} now current time (for the "today" highlight)
 * @param {(iso:string)=>void} onTap
 */
function buildDayIndexRow(iso, now, onTap) {
  const day = getDay(iso); // null for the unauthored Jun 16–23 leg
  const authored = day != null;
  const num = day?.dayNumber ?? deriveDayNumber(iso);
  const region = authored
    ? (day.base ?? 'TBD')
    : (UNAUTHORED_REGIONS[iso] ?? 'TBD');
  const isToday = iso === localISODate(now);

  const row = el('button', 'day-index-row');
  row.type = 'button';
  if (!authored) row.classList.add('day-index-row-tbd');
  if (isToday) row.classList.add('day-index-row-today');
  row.setAttribute(
    'aria-label',
    `Day ${num ?? '?'}, ${formatIndexDate(iso)}, ${region}` +
      (authored ? '' : ' — to be planned'),
  );

  const left = el('div', 'day-index-left');
  left.appendChild(el('span', 'day-index-num', num != null ? `Day ${num}` : '—'));
  left.appendChild(el('span', 'day-index-date', formatIndexDate(iso)));
  row.appendChild(left);

  const mid = el('div', 'day-index-mid');
  mid.appendChild(el('span', 'day-index-region', region));
  row.appendChild(mid);

  const status = el('span',
    `day-index-status ${authored ? 'is-locked' : 'is-tbd'}`,
    authored ? 'Planned' : 'TBD');
  row.appendChild(status);

  row.addEventListener('click', () => {
    if (typeof onTap === 'function') onTap(iso);
  });
  return row;
}

/**
 * Build the pre-trip home: a countdown header (graceful before/during/after the
 * trip) plus a tappable index of every trip day. Tapping a row calls `onEnter`
 * with that day's ISO date, which the mount controller routes into a day view.
 * @param {number|null} daysUntil whole days until TRIP.start (null = during/after/unknown)
 * @param {(iso:string)=>void} onEnter
 * @returns {{node: HTMLElement, start: () => void, stop: () => void}}
 *
 * Exported for tests: the during-trip countdown branch is unreachable through
 * mountApp (pickLandingView never returns the overview descriptor mid-trip), so
 * direct unit tests are the only way to cover all three countdown states. This
 * matches the existing "export internals for testing" pattern (buildValidatedDays,
 * haversineMeters, safeUrl, nearestPrecedingCoords).
 */
export function renderOverview(daysUntil, onEnter) {
  const trip = getTrip();
  const now = getNow();
  const dates = tripWindowDates(trip);
  const view = el('article', 'overview-view framing-anticipation');

  // --- Countdown header (before / during / after the trip) -----------------
  const head = el('header', 'overview-header');
  const todayIso = localISODate(now);
  const afterEnd = dayDelta(trip.end, todayIso); // >0 ⇒ trip is over
  const beforeTrip = Number.isFinite(daysUntil) && daysUntil > 0;
  const tripOver = afterEnd != null && afterEnd > 0;

  head.appendChild(el('p', 'overview-kicker',
    beforeTrip ? 'Counting down' : tripOver ? 'Looking back' : 'In Japan now'));
  head.appendChild(el('h1', 'overview-title', trip.title ?? 'Our trip'));

  const count = el('div', 'overview-count');
  if (beforeTrip) {
    count.appendChild(el('span', 'overview-count-num', String(daysUntil)));
    count.appendChild(el('span', 'overview-count-label',
      daysUntil === 1 ? 'day until the trip' : 'days until the trip'));
  } else if (tripOver) {
    count.appendChild(el('span', 'overview-count-label', 'The adventure is complete.'));
  } else {
    count.appendChild(el('span', 'overview-count-label', 'The adventure is underway.'));
  }
  head.appendChild(count);

  if (trip.start) {
    head.appendChild(el('p', 'overview-dates', `${trip.start} — ${trip.end}`));
  }
  view.appendChild(head);

  // --- All-days index ------------------------------------------------------
  if (dates.length) {
    const index = el('section', 'day-index');
    index.setAttribute('aria-label', 'All trip days');
    index.appendChild(el('h2', 'day-index-heading', 'The whole trip'));

    const list = el('div', 'day-index-list');
    list.setAttribute('role', 'list');
    dates.forEach((iso) => {
      const row = buildDayIndexRow(iso, now, onEnter);
      row.setAttribute('role', 'listitem');
      list.appendChild(row);
    });
    index.appendChild(list);
    view.appendChild(index);
  }

  return { node: view, start() {}, stop() {} };
}

// ---------------------------------------------------------------------------
// Mount seam + navigation controller.
//
// renderInto() stays the public mount point (API contract). It now boots the
// date-time-aware navigation controller, which:
//   - picks the landing view from the clock (pickLandingView/getNow),
//   - renders prev/next controls that page across the whole trip window,
//   - re-applies the lifecycle framing (frameForDay) on every navigation,
//   - shows the evening "Prep for tomorrow →" button inside TRIP.eveningWindow,
//   - stops the prior slideshow before each re-render (no orphaned intervals).
// ---------------------------------------------------------------------------

// Tracks the live day-view controller so a re-render can stop its slideshow
// timer before mounting a new one (no orphaned intervals).
let activeDayView = null;

/** Stop + forget the active day-view (its slideshow timer). */
function stopActiveDayView() {
  if (activeDayView) {
    activeDayView.stop();
    activeDayView = null;
  }
}

/**
 * Build the prev/next navigation bar for the day at `index` in `dates`.
 * Buttons are clamped to the window ends. `onGo(index)` navigates.
 */
function buildNavBar(dates, index, onGo) {
  const nav = el('nav', 'day-nav');
  nav.setAttribute('aria-label', 'Day navigation');

  const prev = el('button', 'day-nav-btn day-nav-prev', '← Prev');
  prev.type = 'button';
  prev.disabled = index <= 0;
  prev.setAttribute('aria-label', 'Previous day');
  prev.addEventListener('click', () => onGo(index - 1));

  const next = el('button', 'day-nav-btn day-nav-next', 'Next →');
  next.type = 'button';
  next.disabled = index >= dates.length - 1;
  next.setAttribute('aria-label', 'Next day');
  next.addEventListener('click', () => onGo(index + 1));

  // Position label (e.g. "Day 9 · Jun 24") — derived, never authored.
  const iso = dates[index];
  const dayObj = getDay(iso);
  const num = dayObj?.dayNumber ?? deriveDayNumber(iso);
  const label = el('span', 'day-nav-pos',
    num != null ? `Day ${num}` : iso);

  nav.appendChild(prev);
  nav.appendChild(label);
  nav.appendChild(next);
  return nav;
}

/**
 * Build the evening "Prep for tomorrow →" button for the day AFTER `index`,
 * or null if there is no tomorrow in-window or tomorrow has no prep notes.
 * Surfaces tomorrow's prep list when expanded; tapping the title navigates.
 */
function buildEveningPrep(dates, index, onGo) {
  const tomorrowIdx = index + 1;
  if (tomorrowIdx >= dates.length) return null;
  const tIso = dates[tomorrowIdx];
  const tomorrow = getDay(tIso);
  const prep = Array.isArray(tomorrow?.prep) ? tomorrow.prep : [];

  const box = el('section', 'evening-prep');
  box.setAttribute('aria-label', 'Prep for tomorrow');

  const go = el('button', 'evening-prep-cta', 'Prep for tomorrow →');
  go.type = 'button';
  go.addEventListener('click', () => onGo(tomorrowIdx));
  box.appendChild(go);

  if (tomorrow?.title) {
    box.appendChild(el('p', 'evening-prep-day', tomorrow.title));
  }

  if (prep.length) {
    const ul = el('ul', 'evening-prep-list');
    prep.forEach((p) => ul.appendChild(el('li', 'evening-prep-item', p)));
    box.appendChild(ul);
  } else {
    box.appendChild(el('p', 'evening-prep-empty',
      'Nothing to prep yet — tap through to tomorrow.'));
  }
  return box;
}

/**
 * Mount the day-and-nav UI for `index` within `dates` into `rootEl`. Clears the
 * previous render + stops its slideshow first. Framing is derived from the
 * clock via frameForDay so manual nav re-applies the lifecycle framing. Shows
 * the evening prep button only inside TRIP.eveningWindow AND only while viewing
 * today's day — "tomorrow" is meaningful only relative to the actual current
 * day, so paging to a past/future day (or previewing pre-trip) hides it.
 */
function mountDayAt(rootEl, dates, index, navigate) {
  stopActiveDayView();
  rootEl.textContent = ''; // clear without innerHTML

  const iso = dates[index];
  const day = getDay(iso); // null for the unauthored leg → placeholder
  const now = getNow();
  const framing = frameForDay(iso, now);

  const shell = el('div', 'day-screen');

  shell.appendChild(buildNavBar(dates, index, navigate));

  const view = renderDay(day, framing);
  shell.appendChild(view.node);

  if (isEveningWindow(now) && iso === localISODate(now)) {
    const prep = buildEveningPrep(dates, index, navigate);
    if (prep) shell.appendChild(prep);
  }

  rootEl.appendChild(shell);
  view.start();
  activeDayView = view;
}

/**
 * Boot the navigation controller into a root element, choosing the landing view
 * from the clock. Returns a small controller ({ go, toIso, destroy }) so the
 * UI is testable and a future caller can drive it.
 * @param {HTMLElement} rootEl
 * @returns {{go:(i:number)=>void, toIso:(iso:string)=>void, destroy:()=>void} | undefined}
 */
export function mountApp(rootEl) {
  if (!rootEl) {
    console.warn('[app] mountApp called without a root element.');
    return undefined;
  }

  const dates = tripWindowDates();

  const clampIndex = (i) => Math.max(0, Math.min(dates.length - 1, i));
  const navigate = (i) => mountDayAt(rootEl, dates, clampIndex(i), navigate);
  const toIso = (iso) => {
    const i = dates.indexOf(iso);
    if (i >= 0) navigate(i);
  };

  const landing = pickLandingView(getNow());

  if (landing.view === 'overview') {
    stopActiveDayView();
    rootEl.textContent = '';
    const overview = renderOverview(landing.daysUntil, toIso);
    rootEl.appendChild(overview.node);
    overview.start();
  } else {
    // Find the index of the landing day; fall back to the first window day.
    const landingIso = landing.day?.date ?? localISODate(getNow());
    const idx = dates.indexOf(landingIso);
    navigate(idx >= 0 ? idx : 0);
  }

  return {
    go: navigate,
    toIso,
    destroy: () => {
      stopActiveDayView();
      rootEl.textContent = '';
    },
  };
}

/**
 * Mount a single day-view into a root element (legacy/standalone entry point).
 * PRESERVED for backward compatibility + the existing test suite: it renders
 * exactly one day in the given framing, no nav chrome. The full date/time-aware
 * experience is mountApp(); the bootstrap below uses that.
 * @param {HTMLElement} rootEl
 * @param {object|null} [day] day object (defaults to getDay("2026-06-24"))
 * @param {'anticipation'|'plan'|'reminisce'} [framing='plan']
 */
export function renderInto(rootEl, day = getDay('2026-06-24'), framing = 'plan') {
  if (!rootEl) {
    console.warn('[app] renderInto called without a root element.');
    return;
  }

  stopActiveDayView();
  rootEl.textContent = ''; // clear without innerHTML

  const view = renderDay(day, framing);
  rootEl.appendChild(view.node);
  view.start();
  activeDayView = view;
}

// ---------------------------------------------------------------------------
// Bootstrap — guarded so a non-browser import (Node syntax check / unit test)
// of the pure helpers never touches the DOM and never throws.
// ---------------------------------------------------------------------------

/**
 * Build the small "time-travel active" indicator banner shown when an override
 * is in effect, so the user never forgets the app is faking time. XSS-safe: the
 * (user-controlled) override is rendered via textContent only. The "use real
 * clock" link is a same-origin relative link to ?now=clear, built safely.
 * @param {Date} override the active simulated "now"
 * @returns {HTMLElement}
 */
function buildTimeTravelBanner(override) {
  const bar = el('div', 'time-travel-banner');
  bar.setAttribute('role', 'status');

  const label = el('span', 'time-travel-banner-label', 'Time-travel mode');
  bar.appendChild(label);

  // Render the simulated moment via textContent (never innerHTML).
  const when = override.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  bar.appendChild(el('span', 'time-travel-banner-when', when));

  // Same-origin escape hatch back to the real clock.
  const clear = el('a', 'time-travel-banner-clear', 'Use real clock');
  clear.href = '?now=clear';
  bar.appendChild(clear);

  return bar;
}

if (typeof document !== 'undefined') {
  const boot = () => {
    const root = document.getElementById('app-root');
    if (root) mountApp(root);
    // Surface the time-travel indicator (if an override resolved at load).
    // The banner is position:fixed, so it lives directly on <body>.
    if (ACTIVE_NOW_OVERRIDE && document.body) {
      document.body.appendChild(buildTimeTravelBanner(ACTIVE_NOW_OVERRIDE));
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
