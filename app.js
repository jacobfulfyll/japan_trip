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
// Firebase web config (tracked → ships on GitHub Pages). Pure local data, no
// network/DOM, so importing it at module top level is Node-safe (the auth gate's
// SDK import is dynamic + browser-only; see the bootstrap block at the bottom).
import { firebaseConfig } from './firebase-config.js';

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

    // Optional dayParts: {morning?, afternoon?, evening?} — each value must be
    // a string if present. Warn and strip on any shape violation; never reject
    // the day. Matches the existing warn-and-skip ethos.
    let dayParts;
    if (day.dayParts != null) {
      if (typeof day.dayParts !== 'object' || Array.isArray(day.dayParts)) {
        console.warn(`[app] ${day.date}: "dayParts" is not an object; stripping.`);
      } else {
        const out = {};
        for (const key of ['morning', 'afternoon', 'evening']) {
          const v = day.dayParts[key];
          if (v === undefined) continue;
          if (typeof v === 'string' && v.length > 0) {
            out[key] = v;
          } else {
            console.warn(`[app] ${day.date}: "dayParts.${key}" is not a non-empty string; stripping that field.`);
          }
        }
        if (Object.keys(out).length > 0) dayParts = out;
      }
    }

    const normalized = { ...day, dayNumber: deriveDayNumber(day.date, startIso) };
    if (dayParts) {
      normalized.dayParts = dayParts;
    } else {
      // Drop any malformed/empty dayParts so the rendered shape stays clean.
      delete normalized.dayParts;
    }

    valid.push({
      sortKey: parsed.getTime(), // cached for sorting; dropped before freezing
      day: normalized,
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

/**
 * True once the trip has started (today is on or after TRIP.start, by local
 * calendar day). Reads "now" only through getNow(). Gates the ☰ menu's "Add
 * photos" row — disabled before the trip starts. Unparseable clock/start → false
 * (fail closed).
 * @param {Date} [now]
 * @returns {boolean}
 */
function tripHasStarted(now = getNow()) {
  const todayIso = localISODate(now);
  const toStart = dayDelta(todayIso, getTrip().start); // >0 ⇒ trip is in the future
  return toStart != null && toStart <= 0;
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

/** Build a safe external map link as an icon-only button, or null if the URL is unusable. */
function mapLink(url, label) {
  const safe = safeUrl(url);
  if (!safe) return null;
  const a = el('a', 'map-link');
  a.href = safe;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.setAttribute('aria-label', label ?? 'Open in Google Maps');
  return a;
}

const TAG_LABELS = {
  meal: 'Meal',
  transit: 'Transit',
  sight: 'Sight',
  checkin: 'Check-in',
  checkout: 'Checkout',
  reservation: 'Reservation',
  rest: 'Rest',
  bar: 'Drinks',
  spa: 'Spa',
};

// Emoji marker per transit mode. Used in the .plan-transit line row; for
// multi-leg journeys, the primary leg's emoji is joined to the transfer's
// emoji with a '+' (e.g. 'Ⓜ️+🚌').
const TRANSIT_MODE_EMOJI = {
  bus: '🚌',
  train: '🚆',
  subway: 'Ⓜ️',
};

/**
 * Resolve the pill label for a plan item. Transit items become mode-aware
 * when `item.transit?.mode` is authored (e.g. 'Bus' / 'Train' / 'Subway');
 * everything else falls back to TAG_LABELS or the raw tag string.
 */
function resolveTagLabel(item) {
  if (item?.tag === 'transit' && item.transit?.mode && typeof item.transit.mode === 'string') {
    const m = item.transit.mode;
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  return TAG_LABELS[item?.tag] ?? item?.tag;
}

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
 * Bucket a day's plan items into Morning / Afternoon / Evening by parsing the
 * hour from each item's `time` (e.g. "08:00"). Buckets:
 *   Morning   → hour < 12
 *   Afternoon → 12 ≤ hour ≤ 16
 *   Evening   → hour ≥ 17
 *
 * Items missing `time` or with an unparseable hour are bucketed into Morning AND
 * a `console.warn` is emitted (surface the data gap rather than silently degrade).
 *
 * Each returned item carries an `indexInPlan` matching its position in the input
 * — this index is what `buildPlanItem` passes to `nearestPrecedingCoords` for
 * walking-distance origin. Per-section reindexing would break walk distances.
 *
 * Always returns three buckets in order (Morning, Afternoon, Evening). Empty
 * buckets are NOT omitted by the helper — the consumer (renderDay) drops them.
 * Keeps the helper trivially testable.
 *
 * @param {Array<object>} plan
 * @returns {Array<{name:'Morning'|'Afternoon'|'Evening', items:Array<{item:object,indexInPlan:number}>}>}
 */
export function bucketPlanByDayPart(plan) {
  const morning = [];
  const afternoon = [];
  const evening = [];
  const arr = Array.isArray(plan) ? plan : [];

  arr.forEach((item, i) => {
    const time = item && typeof item.time === 'string' ? item.time : '';
    const hour = parseInt(time.slice(0, 2), 10);
    if (!Number.isFinite(hour)) {
      console.warn(`[app] plan item at index ${i} has no parseable time ("${time}"); bucketing into Morning.`);
      morning.push({ item, indexInPlan: i });
      return;
    }
    if (hour < 12) morning.push({ item, indexInPlan: i });
    else if (hour <= 16) afternoon.push({ item, indexInPlan: i });
    else evening.push({ item, indexInPlan: i });
  });

  return [
    { name: 'Morning', items: morning },
    { name: 'Afternoon', items: afternoon },
    { name: 'Evening', items: evening },
  ];
}

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

/** True if the user has requested reduced motion. Browser-only — false in Node
 * (no `window`), so build-time callers degrade to the non-animated path. */
function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const reduceMotion = prefersReducedMotion();

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

// Same idea for day-part-body aria-controls ids: monotonic and unique even
// across multiple day-view mounts in one document.
let dayPartSeq = 0;

const DAY_PART_KEYS = { Morning: 'morning', Afternoon: 'afternoon', Evening: 'evening' };

/**
 * Build a fallback one-line summary from a bucket's item titles, truncated to
 * ~80 chars at a separator/word boundary. Used when `day.dayParts[bucketKey]`
 * is absent (unauthored future days / defensive cover).
 */
function deriveBucketSummary(bucketItems) {
  const titles = bucketItems
    .map((b) => (b.item && typeof b.item.title === 'string') ? b.item.title : '')
    .filter((t) => t.length > 0);
  const joined = titles.join(' • ');
  if (joined.length <= 80) return joined;
  // Trim back to the last ' • ' or whitespace boundary inside the 80-char window.
  const head = joined.slice(0, 80);
  const sepIdx = head.lastIndexOf(' • ');
  if (sepIdx > 0) return head.slice(0, sepIdx) + ' …';
  const spaceIdx = head.lastIndexOf(' ');
  if (spaceIdx > 0) return head.slice(0, spaceIdx) + ' …';
  return head + '…';
}

/**
 * Build the small `.plan-transit` block rendered under a transit item's title.
 * Returns null when there's no usable structured data (caller skips appending).
 * Shows three short rows when populated:
 *   line:    [mode-emoji(+transfer-emoji)] Line name (and ' + ' transfer line name if present)
 *   stops:   from → to (chained ' → transfer.to' if a transfer is set)
 *   minutes: <total> min  (primary + transfer.minutes if both present)
 *
 * XSS-safe by construction: every text node goes through textContent / el().
 */
function buildTransitBlock(transit) {
  if (!transit || typeof transit !== 'object') return null;
  const { mode, line, from, to, minutes, transfer } = transit;
  if (!from || !to) return null; // require endpoints

  const xfer = transfer && typeof transfer === 'object' ? transfer : null;
  const block = el('div', 'plan-transit');

  // Line row — emoji prefix + line name(s). Render only when at least one
  // line name is present (mode-only would be redundant with the pill).
  if (line || xfer?.line) {
    const lineRow = el('div', 'plan-transit-line');
    const emojiPrimary = TRANSIT_MODE_EMOJI[mode] ?? '';
    const emojiTransfer = xfer?.mode ? (TRANSIT_MODE_EMOJI[xfer.mode] ?? '') : '';
    const emoji = emojiTransfer ? `${emojiPrimary}+${emojiTransfer}` : emojiPrimary;
    if (emoji) {
      const e = el('span', 'plan-transit-emoji', emoji);
      e.setAttribute('aria-hidden', 'true');
      lineRow.appendChild(e);
    }
    const labelParts = [];
    if (line) labelParts.push(String(line));
    if (xfer?.line) labelParts.push(String(xfer.line));
    lineRow.appendChild(el('span', 'plan-transit-line-name', labelParts.join(' + ')));
    block.appendChild(lineRow);
  }

  // Stops row — from → to (chained through transfer.to if present).
  const stops = [String(from), String(to)];
  if (xfer?.to) stops.push(String(xfer.to));
  block.appendChild(el('div', 'plan-transit-stops', stops.join(' → ')));

  // Minutes row — primary + transfer minutes if both present.
  const m1 = Number.isFinite(minutes) ? Number(minutes) : null;
  const m2 = xfer && Number.isFinite(xfer.minutes) ? Number(xfer.minutes) : null;
  const total = m1 != null && m2 != null ? m1 + m2 : (m1 ?? m2);
  if (total != null) {
    block.appendChild(el('div', 'plan-transit-minutes', `${total} min`));
  }

  return block;
}

/**
 * Build the inline transit-alternative span for a recommendation card. Unlike
 * `buildTransitBlock` (the stacked 3-row block for plan items), this is a
 * single-line render appended to `.rec-walk`:
 *
 *   <mode-emoji[+transfer-emoji]> <total-min> min (<from> → <to>[ → <transfer.to>])
 *
 * `minutes` on each leg sums to the door-to-door total. Returns a span; caller
 * is responsible for the leading separator (" · ").
 */
function buildRecTransitSpan(transit) {
  const { mode, from, to, minutes, transfer } = transit;
  const xfer = transfer && typeof transfer === 'object' ? transfer : null;
  const span = el('span', 'rec-transit');

  const emojiPrimary = TRANSIT_MODE_EMOJI[mode] ?? '';
  const emojiTransfer = xfer?.mode ? (TRANSIT_MODE_EMOJI[xfer.mode] ?? '') : '';
  const emoji = emojiPrimary + emojiTransfer;
  if (emoji) {
    const e = el('span', 'rec-transit-emoji', emoji + ' ');
    e.setAttribute('aria-hidden', 'true');
    span.appendChild(e);
  }

  const m1 = Number.isFinite(minutes) ? Number(minutes) : null;
  const m2 = xfer && Number.isFinite(xfer.minutes) ? Number(xfer.minutes) : null;
  const total = m1 != null && m2 != null ? m1 + m2 : (m1 ?? m2);
  if (total != null) {
    span.appendChild(el('span', 'rec-transit-min', `${total} min `));
  }

  const stops = [String(from), String(to)];
  if (xfer?.to) stops.push(String(xfer.to));
  span.appendChild(el('span', 'rec-transit-stops', `(${stops.join(' → ')})`));

  return span;
}

/** Build one plan item (timeline row), wiring recommendation expansion. */
function buildPlanItem(item, index, plan, lodging) {
  const isReserved = item.reserved === true;
  const li = el('li', 'plan-item' + (isReserved ? ' plan-item-reserved' : ''));

  const rail = el('div', 'plan-rail');
  rail.appendChild(el('span', 'plan-dot', ''));
  li.appendChild(rail);

  const body = el('div', 'plan-body');

  const content = el('div', 'plan-content');
  const head = el('div', 'plan-head');
  if (item.time) head.appendChild(el('span', 'plan-time', item.time));
  const tagLabel = resolveTagLabel(item);
  if (tagLabel) head.appendChild(el('span', 'plan-tag tag-' + (item.tag ?? 'other'), tagLabel));
  if (isReserved) head.appendChild(el('span', 'plan-reserved-badge', 'Reserved'));
  content.appendChild(head);

  content.appendChild(el('h3', 'plan-title', item.title ?? ''));

  const transitBlock = buildTransitBlock(item.transit);
  if (transitBlock) content.appendChild(transitBlock);

  if (item.note) content.appendChild(el('p', 'plan-note', item.note));

  const link = mapLink(item.mapUrl, 'Open in Google Maps');
  if (link) content.appendChild(link);

  body.appendChild(content);

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

      const hasTransit = rec?.transit && typeof rec.transit === 'object' && rec.transit.from && rec.transit.to;
      const meters = origin ? haversineMeters(origin.from, rec?.coords) : null;
      if (Number.isFinite(meters)) {
        const walkMin = Math.max(1, Math.round(meters / 80));
        if (hasTransit) {
          // Inline transit-alternative pill: drop the distance label + "walk"
          // word from the walk half (the 🚶 prefix + mode emoji convey it).
          const walk = el('p', 'rec-walk', `${walkMin} min`);
          walk.appendChild(el('span', 'rec-walk-from', ` from ${origin.label}`));
          walk.appendChild(el('span', 'rec-walk-sep', ' · '));
          walk.appendChild(buildRecTransitSpan(rec.transit));
          card.appendChild(walk);
        } else {
          const walk = el('p', 'rec-walk', `${walkMin} min`);
          walk.appendChild(el('span', 'rec-walk-sep', ' · '));
          walk.appendChild(el('span', 'rec-walk-from', `from ${origin.label}`));
          card.appendChild(walk);
        }
      } else if (hasTransit) {
        // No walkable anchor (e.g. an airport transfer — the preceding item has
        // no coords and the rec isn't a place you walk to). Show the transit
        // pill on its own so the mode/route/minutes still render.
        const line = el('p', 'rec-walk');
        line.appendChild(buildRecTransitSpan(rec.transit));
        card.appendChild(line);
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
// ---------------------------------------------------------------------------
// Reminisce photo gallery + lightbox ("Engawa Scroll" redesign). Past days drop
// the hero slideshow and lead with a framed header that flows into a masonry
// photo grid; tapping a photo opens a swipeable full-screen lightbox.
// ---------------------------------------------------------------------------

// Cap how many photos a day's gallery shows (and the lightbox scrolls). Keeps a
// busy day scannable on a phone instead of an endless scroll. Tune to taste.
const REMINISCE_GALLERY_MAX = 12;

/**
 * Photos to show in a day's reminisce gallery, capped at REMINISCE_GALLERY_MAX.
 * Source is the day's authored `photos` (the same set that feeds the hero on
 * non-reminisce framings). This is the seam the Firebase photo-journal (v2) will
 * extend — merging in travelers' uploaded photos for the day.
 */
function reminisceGalleryPhotos(day) {
  const photos = Array.isArray(day?.photos) ? day.photos : [];
  return photos.slice(0, REMINISCE_GALLERY_MAX);
}

// ---------------------------------------------------------------------------
// Live reminisce gallery (reminisce-gallery-live)
//
// The reminisce view merges hand-authored `day.photos` with travelers' UPLOADED
// photos for the day (Firestore `photos` docs, written by photo-upload-flow),
// LIVE via onSnapshot. The Firebase read layer is injected through a module-level
// seam so `node --test` stays network-free and the seam-absent render path is
// byte-identical to the authored-only original.
// ---------------------------------------------------------------------------

/**
 * Injected `subscribePhotos(iso, cb)` seam. The bootstrap (boot()) wires this to
 * the live Firestore listener via the photoService; tests inject a stub. When it
 * is null (every existing test, and any non-Firebase host) renderDay's reminisce
 * branch renders the authored photos synchronously, exactly as before.
 * @type {((iso: string, cb: (docs: object[]) => void) => (() => void)) | null}
 */
let subscribePhotosFn = null;

/**
 * Wire (or clear) the live photo subscription seam. Called once by boot() with
 * the photoService-backed listener; pass null to detach (tests).
 * @param {((iso: string, cb: (docs: object[]) => void) => (() => void)) | null} fn
 */
export function setSubscribePhotos(fn) {
  subscribePhotosFn = typeof fn === 'function' ? fn : null;
}

/**
 * Merge authored + uploaded photos for a day's reminisce gallery.
 *
 * Order: authored photos FIRST (in authored order), then uploaded photos sorted
 * by `takenAt` ascending (the sortable capture-time string photo-upload-flow
 * writes). The whole list is capped at REMINISCE_GALLERY_MAX.
 *
 * Dedup key: the resolved photo `url`. An authored photo and an uploaded doc that
 * point at the same URL collapse to one (authored wins, since it is emitted
 * first). Two uploaded docs with the same download URL (re-runs) also collapse.
 * URL is the natural identity here — each Storage upload gets a unique download
 * URL, and authored photos carry their own stable URLs.
 *
 * Each kept photo is normalized to `{ url, alt }` (what the gallery + lightbox
 * consume). Uploaded docs get `alt: "Photo by <uploader>"`. URLs are validated
 * with safeUrl(); anything safeUrl rejects (bad scheme, missing) is dropped —
 * uploaded photos are user data.
 *
 * @param {Array<{url?: string, alt?: string}>} authored authored day.photos
 * @param {Array<{url?: string, uploader?: string, takenAt?: string}>} uploaded Firestore photo docs
 * @returns {Array<{url: string, alt: string}>}
 */
export function mergeGalleryPhotos(authored, uploaded) {
  const seen = new Set();
  const out = [];

  const pushSafe = (rawUrl, alt) => {
    const url = safeUrl(rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, alt: alt ? String(alt) : '' });
  };

  const authoredList = Array.isArray(authored) ? authored : [];
  authoredList.forEach((p) => pushSafe(p?.url, p?.alt));

  const uploadedList = (Array.isArray(uploaded) ? uploaded : [])
    .slice()
    .sort((a, b) => {
      const ta = typeof a?.takenAt === 'string' ? a.takenAt : '';
      const tb = typeof b?.takenAt === 'string' ? b.takenAt : '';
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return 0;
    });
  uploadedList.forEach((d) => {
    const who = d?.uploader ? String(d.uploader) : 'a traveler';
    pushSafe(d?.url, `Photo by ${who}`);
  });

  return out.slice(0, REMINISCE_GALLERY_MAX);
}

/**
 * Masonry photo grid of focusable buttons. `onOpen(index)` fires on activation.
 * XSS-safe: URLs pass through safeUrl(); text via textContent only.
 */
function buildReminisceGallery(photos, onOpen) {
  const gallery = el('section', 'reminisce-gallery');
  gallery.setAttribute('aria-label', 'Photos from this day');
  photos.forEach((p, i) => {
    const src = safeUrl(p?.url);
    if (!src) return;
    const btn = el('button', 'reminisce-photo');
    btn.type = 'button';
    const img = el('img');
    img.src = src;
    img.alt = p?.alt ? String(p.alt) : '';
    img.loading = 'lazy';
    img.decoding = 'async';
    btn.appendChild(img);
    btn.addEventListener('click', () => onOpen(i));
    gallery.appendChild(btn);
  });
  return gallery;
}

/**
 * Full-screen swipeable lightbox over a set of photos. Native CSS scroll-snap
 * provides the swipe/momentum (no gesture JS); JS adds open-at-index, the live
 * counter, keyboard nav, and a focus trap. Returns { node, open(i), destroy() }.
 * Append `node` to the day-view root and wire `destroy` into renderDay's stop().
 *
 * `opts.onClose()` (optional) fires on a USER-driven close (Esc / × / backdrop) —
 * NOT on destroy()-teardown. The live reminisce gallery uses it to apply a photo
 * rebuild that arrived while the viewer was open (so an open lightbox is never
 * yanked out from under the user). Omitted → no behavior change (existing callers).
 */
function buildLightbox(photos, dayLabel, opts = {}) {
  const onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
  const overlay = el('div', 'lightbox');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Photo viewer');

  const bar = el('div', 'lightbox-bar');
  const counter = el('span', 'lightbox-counter');
  counter.setAttribute('aria-live', 'polite');
  const closeBtn = el('button', 'lightbox-close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close photo viewer');
  bar.appendChild(counter);
  bar.appendChild(closeBtn);
  overlay.appendChild(bar);

  const track = el('div', 'lightbox-track');
  photos.forEach((p) => {
    const slide = el('div', 'lightbox-slide');
    const src = safeUrl(p?.url);
    if (src) {
      const img = el('img');
      img.src = src;
      img.alt = p?.alt ? String(p.alt) : '';
      img.decoding = 'async';
      slide.appendChild(img);
    }
    track.appendChild(slide);
  });
  overlay.appendChild(track);

  let current = 0;
  let lastFocused = null;
  let rafPending = false;

  const reduceMotion = prefersReducedMotion();

  function setCounter(i) {
    current = i;
    counter.textContent = `${i + 1} / ${photos.length}`;
    overlay.setAttribute(
      'aria-label',
      `Photo ${i + 1} of ${photos.length}${dayLabel ? ', ' + dayLabel : ''}`,
    );
  }

  function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const w = track.clientWidth || 1;
      setCounter(Math.round(track.scrollLeft / w));
    });
  }
  track.addEventListener('scroll', onScroll, { passive: true });

  function scrollToIndex(i, smooth) {
    const w = track.clientWidth;
    track.scrollTo({ left: i * w, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
  }

  function unmount() {
    if (overlay.parentNode && typeof overlay.parentNode.removeChild === 'function') {
      overlay.parentNode.removeChild(overlay);
    }
  }

  let isOpen = false;

  // Shared teardown. `restoreFocus` returns focus to the element that opened the
  // lightbox — right for a user-driven close, but NOT for navigation teardown
  // (the originating thumbnail is about to be removed, so let the next view own
  // focus instead of yanking it to a detached node).
  function teardown(restoreFocus) {
    if (!isOpen) { unmount(); return; }
    isOpen = false;
    overlay.hidden = true;
    document.removeEventListener('keydown', onKey);
    unmount();
    if (restoreFocus && lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  function close() {
    const wasOpen = isOpen;
    teardown(true);
    // Notify only on a real user-driven close of an open viewer — lets the live
    // gallery apply a deferred snapshot rebuild now that the user has left.
    if (wasOpen && onClose) onClose();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); scrollToIndex(Math.min(current + 1, photos.length - 1), true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollToIndex(Math.max(current - 1, 0), true); }
    else if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); } // sole focusable → trap
  }

  function open(i) {
    // Capture focus origin + mount/listen only on a real open → re-entrant taps
    // (two thumbnails before the overlay paints) can't clobber lastFocused or
    // double-register the keydown listener.
    if (!isOpen) {
      isOpen = true;
      lastFocused = typeof document !== 'undefined' ? document.activeElement : null;
      // Mount on <body> (not inside the day-view) so the fixed overlay escapes the
      // day-view's backdrop-filter/overflow containing block and fills the viewport.
      if (!overlay.parentNode && typeof document !== 'undefined' && document.body) {
        document.body.appendChild(overlay);
      }
      document.addEventListener('keydown', onKey);
    }
    overlay.hidden = false;
    setCounter(i);
    scrollToIndex(i, false); // jump to the tapped photo before it's seen
    closeBtn.focus();
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === track) close();
  });

  function destroy() {
    track.removeEventListener('scroll', onScroll);
    teardown(false);
  }

  return { node: overlay, open, destroy, isOpen: () => isOpen };
}

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

  const isReminisce = framingName === 'reminisce';

  // Hero slideshow on top — suppressed in reminisce framing (past days lead with
  // the framed header + photo gallery instead of a hero).
  const hero = isReminisce ? { node: null, start() {}, stop() {} } : buildHero(photos, framing);
  if (hero.node) view.appendChild(hero.node);

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

  // Reminisce live-gallery lifecycle. Default no-ops so the non-reminisce return
  // (and the seam-absent reminisce path) are unaffected; the live subscription is
  // wired into these inside the reminisce branch only when the seam is present.
  let reminisceStart = () => {};
  let reminisceStop = () => {};

  if (isReminisce) {
    // Authored photos are the SYNCHRONOUS source — rendered immediately so the
    // seam-absent path is byte-identical to the original. The live layer (when the
    // subscribePhotos seam is present) merges uploaded photos in on each snapshot.
    const authoredPhotos = reminisceGalleryPhotos(day);
    const live = !!subscribePhotosFn;

    // Wrap the header in the blue "memory frame" that flows into the gallery.
    const frame = el('section', 'reminisce-frame');
    frame.appendChild(headerBlock);
    const seam = el('p', 'reminisce-frame-seam');
    const setSeam = (count) => {
      seam.textContent = count
        ? `${count} ${count === 1 ? 'photo' : 'photos'}`
        : 'No photos yet';
    };
    setSeam(authoredPhotos.length);
    frame.appendChild(seam);
    view.appendChild(frame);

    // A stable host the gallery / empty-note / lightbox swap into. (Keeping a host
    // node lets a snapshot re-render the grid without touching surrounding chrome.)
    const galleryHost = el('div', 'reminisce-gallery-host');
    view.appendChild(galleryHost);

    // `current` is the merged photo list currently shown. Authored-only at first;
    // each snapshot recomputes it via mergeGalleryPhotos.
    let current = authoredPhotos.map((p) => ({
      url: safeUrl(p?.url),
      alt: p?.alt ? String(p.alt) : '',
    })).filter((p) => p.url);
    let lightbox = null;
    let loadingNote = null;

    // (Re)build the grid + lightbox over `photos`. Tears down any prior lightbox
    // first (the lightbox captures its array at build time, so a stale one would
    // open the wrong set). Empty list → the graceful empty-state note.
    const renderGallery = (photos) => {
      if (lightbox) { lightbox.destroy(); lightbox = null; }
      galleryHost.textContent = '';
      if (photos.length) {
        // The lightbox mounts itself on <body> when opened (see buildLightbox); we
        // only wire the gallery to it and fold its teardown into reminisceStop.
        lightbox = buildLightbox(photos, day.title ?? '', { onClose: applyPending });
        galleryHost.appendChild(buildReminisceGallery(photos, (i) => lightbox.open(i)));
      } else if (!loadingNote) {
        galleryHost.appendChild(el('p', 'reminisce-empty-note', 'Your trip photos from this day will live here.'));
      }
    };

    // A snapshot can arrive while the user is inside the lightbox; defer the
    // rebuild until they close it rather than yanking the open viewer away.
    let pending = null;
    function applyPending() {
      if (pending) { const p = pending; pending = null; renderGallery(p); }
    }
    const applyMerged = (merged) => {
      current = merged;
      setSeam(merged.length);
      if (lightbox && lightbox.isOpen()) { pending = merged; return; }
      renderGallery(merged);
    };

    // First snapshot is pending → with no authored photos, show a small on-theme
    // loading affordance instead of the empty-note (the snapshot may add photos).
    // Set loadingNote BEFORE the initial render so renderGallery's empty branch
    // is suppressed (it skips the empty-note while a loadingNote is present).
    if (live && current.length === 0) {
      loadingNote = el('p', 'reminisce-loading-note', 'Gathering your photos…');
    }

    // Initial synchronous render (authored only) — identical to the original when
    // the seam is absent.
    renderGallery(current);
    if (loadingNote && !loadingNote.parentNode) galleryHost.appendChild(loadingNote);

    if (live) {
      let unsubscribe = null;
      reminisceStart = () => {
        if (unsubscribe) return; // idempotent
        try {
          unsubscribe = subscribePhotosFn(day.date, (docs) => {
            loadingNote = null;
            applyMerged(mergeGalleryPhotos(authoredPhotos, docs));
          });
        } catch (e) {
          console.warn('[reminisce] live photo subscription failed:', e);
          loadingNote = null;
          renderGallery(current); // fall back to authored-only
        }
      };
      reminisceStop = () => {
        if (typeof unsubscribe === 'function') { try { unsubscribe(); } catch { /* ignore */ } }
        unsubscribe = null;
        if (lightbox) { lightbox.destroy(); lightbox = null; }
      };
    } else {
      // Seam absent: nothing live to start; stop() still tears down the lightbox.
      reminisceStop = () => { if (lightbox) { lightbox.destroy(); lightbox = null; } };
    }
  } else {
    view.appendChild(headerBlock);
  }

  // Sparse day: "details coming" placeholder, then stop (no plan/lodging).
  if (isSparse && !isReminisce) {
    const ph = el('div', 'day-placeholder');
    ph.appendChild(el('h2', 'placeholder-title', 'Details coming'));
    ph.appendChild(el('p', 'placeholder-note', "The plan for this day isn't filled in yet."));
    view.appendChild(ph);
    return { node: view, start: hero.start, stop: hero.stop };
  }

  // The plan list — split into Morning / Afternoon / Evening collapsible
  // sections. Items keep their full-plan `indexInPlan` so `nearestPrecedingCoords`
  // still measures walks from the correct preceding stop.
  if (plan.length) {
    const planSection = el('section', 'plan-section');
    planSection.appendChild(el('h2', 'section-heading', framing.planHeading));

    const buckets = bucketPlanByDayPart(plan);
    buckets.forEach((bucket) => {
      if (bucket.items.length === 0) return;

      const bucketKey = DAY_PART_KEYS[bucket.name];
      const authored = day.dayParts && typeof day.dayParts[bucketKey] === 'string'
        ? day.dayParts[bucketKey]
        : null;
      const summaryText = authored ?? deriveBucketSummary(bucket.items);

      const section = el('section', 'day-part');

      const header = el('button', 'day-part-header');
      header.type = 'button';
      const panelId = `day-part-${dayPartSeq++}`;
      header.setAttribute('aria-expanded', 'false');
      header.setAttribute('aria-controls', panelId);
      header.appendChild(el('span', 'day-part-name', bucket.name));
      if (summaryText) header.appendChild(el('span', 'day-part-summary', summaryText));
      header.appendChild(el('span', 'day-part-chev', '▾'));

      const body = el('div', 'day-part-body');
      body.id = panelId;
      body.hidden = true;
      const list = el('ol', 'plan-list');
      bucket.items.forEach(({ item, indexInPlan }) => {
        list.appendChild(buildPlanItem(item, indexInPlan, plan, day.lodging ?? null));
      });
      body.appendChild(list);

      header.addEventListener('click', () => {
        const open = body.hidden;
        body.hidden = !open;
        header.setAttribute('aria-expanded', String(open));
        section.classList.toggle('is-open', open);
      });

      section.appendChild(header);
      section.appendChild(body);
      planSection.appendChild(section);
    });

    view.appendChild(planSection);
  }

  // Lodging card.
  const lodging = buildLodging(day.lodging ?? null);
  if (lodging) view.appendChild(lodging);

  return {
    node: view,
    start: () => { hero.start(); reminisceStart(); },
    stop: () => { hero.stop(); reminisceStop(); },
  };
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
  const day = getDay(iso);
  const authored = day != null;
  const num = day?.dayNumber ?? deriveDayNumber(iso);
  const region = day?.base ?? 'TBD';
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

// Tracks the live nav-bar's ☰ menu teardown so a re-render closes an open
// popover + removes its global scroll/resize/key/outside-click listeners before
// the nav DOM is wiped (no orphaned listeners after navigation).
let activeNavMenuDestroy = null;

/** Stop + forget the active day-view (its slideshow timer + open nav menu). */
function stopActiveDayView() {
  if (activeDayView) {
    activeDayView.stop();
    activeDayView = null;
  }
  if (typeof activeNavMenuDestroy === 'function') {
    activeNavMenuDestroy();
    activeNavMenuDestroy = null;
  }
}

/**
 * Format the day-nav label as "June 24th - Day 9". Falls back to the raw iso
 * if the date is unparseable, or to "Day N" / iso if `num` is null.
 */
const MONTH_NAMES_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatNavLabel(iso, num) {
  const d = parseISODate(iso);
  if (!d) return num != null ? `Day ${num}` : iso;
  const day = d.getUTCDate();
  const suffix = ordinalSuffix(day);
  const datePart = `${MONTH_NAMES_LONG[d.getUTCMonth()]} ${day}${suffix}`;
  return num != null ? `${datePart} - Day ${num}` : datePart;
}

function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * Build the ☰ hamburger trigger + its body-mounted popover menu.
 *
 * The popover is mounted on `document.body` (NOT inside the nav) so it escapes
 * the `.day-nav` `backdrop-filter` containing block, which would otherwise
 * clip/mis-stack a fixed child. It is positioned from the trigger's bounding
 * rect (browser-only — guarded so the Node test stub never throws). Mirrors
 * buildLightbox's open/teardown/focus-trap pattern: focus moves into the menu
 * on open and returns to ☰ on close; closes on Esc, outside-click, item
 * activation, page scroll, and resize (a fixed popover detaches from ☰ when the
 * page scrolls or the viewport resizes).
 *
 * Rows: "Home" → onHome(); "Add photos" → onAddPhotos(currentIso). The Add
 * photos row is disabled when `addEnabled` is false (no handler / before the
 * trip starts).
 *
 * @returns {{ trigger: HTMLElement, destroy: () => void }}
 */
function buildNavMenu({ onHome, onAddPhotos, addEnabled, currentIso }) {
  const trigger = el('button', 'day-nav-btn day-nav-hamburger', '☰');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Menu');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  const menu = el('div', 'nav-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Menu');

  const homeRow = el('button', 'nav-menu-item', 'Home');
  homeRow.type = 'button';
  homeRow.setAttribute('role', 'menuitem');

  const addRow = el('button', 'nav-menu-item', 'Add photos');
  addRow.type = 'button';
  addRow.setAttribute('role', 'menuitem');
  addRow.disabled = !addEnabled;

  menu.appendChild(homeRow);
  menu.appendChild(addRow);

  let isOpen = false;
  let lastFocused = null;

  function position() {
    // Browser-only — the Node test stub has no getBoundingClientRect. Skip
    // positioning there (open/close/rows logic still works without layout).
    if (typeof trigger.getBoundingClientRect !== 'function') return;
    const r = trigger.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.left = `${Math.round(r.left)}px`;
  }

  function focusableItems() {
    return [homeRow, addRow].filter((b) => !b.disabled);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Trap focus within the (1–2) enabled rows.
      e.preventDefault();
      const items = focusableItems();
      if (!items.length) return;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const i = items.indexOf(active);
      const nextIdx = e.shiftKey
        ? (i <= 0 ? items.length - 1 : i - 1)
        : (i < 0 || i >= items.length - 1 ? 0 : i + 1);
      items[nextIdx].focus();
    }
  }

  function onOutside(e) {
    if (e.target === trigger || trigger.contains?.(e.target)) return;
    if (e.target === menu || menu.contains?.(e.target)) return;
    close();
  }

  // A fixed popover positioned from the trigger rect detaches from ☰ on
  // scroll/resize → close it rather than letting it float out of place.
  function onReposition() {
    close();
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocused = typeof document !== 'undefined' ? document.activeElement : null;
    if (!menu.parentNode && typeof document !== 'undefined' && document.body) {
      document.body.appendChild(menu);
    }
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    position();
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onOutside, true);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('scroll', onReposition, true);
      window.addEventListener('resize', onReposition);
    }
    const items = focusableItems();
    (items[0] ?? homeRow).focus();
  }

  function close(restoreFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutside, true);
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    }
    if (menu.parentNode && typeof menu.parentNode.removeChild === 'function') {
      menu.parentNode.removeChild(menu);
    }
    if (restoreFocus && lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }

  trigger.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });

  homeRow.addEventListener('click', () => {
    close(false);
    if (typeof onHome === 'function') onHome();
  });

  addRow.addEventListener('click', () => {
    if (addRow.disabled) return;
    close(false);
    if (typeof onAddPhotos === 'function') onAddPhotos(currentIso);
  });

  function destroy() {
    close(false);
  }

  return { trigger, destroy };
}

/**
 * Build the day navigation bar for the day at `index` in `dates`.
 * Layout (grid `1fr auto 1fr`): ☰ hamburger left, centered day label, prev/next
 * chevron circles right. Buttons are clamped to the window ends. `onGo(index)`
 * navigates. `onHome()` returns to the trip overview. `onAddPhotos(iso)` (when
 * provided + the trip has started) is the Add-photos seam in the ☰ menu.
 *
 * The ☰ menu is always rendered (it carries Home, which replaces the old
 * top-left 🏠 button); the returned nav owns a `_destroyMenu` hook so the caller
 * can tear down the popover + its global listeners on unmount.
 */
function buildNavBar(dates, index, onGo, onHome, onAddPhotos) {
  const nav = el('nav', 'day-nav');
  nav.setAttribute('aria-label', 'Day navigation');

  const iso = dates[index];

  // ☰ menu (leading child) — carries Home + Add photos.
  const addEnabled = typeof onAddPhotos === 'function' && tripHasStarted();
  const navMenu = buildNavMenu({ onHome, onAddPhotos, addEnabled, currentIso: iso });
  nav._destroyMenu = navMenu.destroy;

  // Position label (e.g. "June 24th - Day 9") — derived, never authored.
  const dayObj = getDay(iso);
  const num = dayObj?.dayNumber ?? deriveDayNumber(iso);
  const label = el('span', 'day-nav-pos', formatNavLabel(iso, num));

  // Prev/next — bare-glyph circular chevrons on the right.
  const prev = el('button', 'day-nav-btn day-nav-prev', '‹');
  prev.type = 'button';
  prev.disabled = index <= 0;
  prev.setAttribute('aria-label', 'Previous day');
  prev.addEventListener('click', () => onGo(index - 1));

  const next = el('button', 'day-nav-btn day-nav-next', '›');
  next.type = 'button';
  next.disabled = index >= dates.length - 1;
  next.setAttribute('aria-label', 'Next day');
  next.addEventListener('click', () => onGo(index + 1));

  const group = el('div', 'day-nav-group');
  group.appendChild(prev);
  group.appendChild(next);

  nav.appendChild(navMenu.trigger);
  nav.appendChild(label);
  nav.appendChild(group);
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

/** Scroll the viewport to the top on a screen change. Guarded for non-browser
 *  test envs (where window.scrollTo is absent). */
function scrollToTop() {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } catch {
    window.scrollTo(0, 0);
  }
}

/**
 * Mount the day-and-nav UI for `index` within `dates` into `rootEl`. Clears the
 * previous render + stops its slideshow first. Framing is derived from the
 * clock via frameForDay so manual nav re-applies the lifecycle framing. Shows
 * the evening prep button only inside TRIP.eveningWindow AND only while viewing
 * today's day — "tomorrow" is meaningful only relative to the actual current
 * day, so paging to a past/future day (or previewing pre-trip) hides it.
 */
function mountDayAt(rootEl, dates, index, navigate, onHome, onAddPhotos) {
  stopActiveDayView();
  rootEl.textContent = ''; // clear without innerHTML
  scrollToTop();

  const iso = dates[index];
  const day = getDay(iso); // null for the unauthored leg → placeholder
  const now = getNow();
  const framing = frameForDay(iso, now);

  const shell = el('div', 'day-screen');

  const nav = buildNavBar(dates, index, navigate, onHome, onAddPhotos);
  activeNavMenuDestroy = nav._destroyMenu ?? null;
  shell.appendChild(nav);

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
 * from the clock. Returns a small controller ({ go, toIso, toOverview, destroy })
 * so the UI is testable and a future caller can drive it.
 * @param {HTMLElement} rootEl
 * @param {{ onAddPhotos?: (iso: string) => void }} [opts] optional handlers.
 *   `onAddPhotos(iso)` powers the ☰ menu's "Add photos" row (the seam a future
 *   Firebase upload task wires); omitted → the row renders disabled.
 * @returns {{go:(i:number)=>void, toIso:(iso:string)=>void, toOverview:()=>void, destroy:()=>void} | undefined}
 */
export function mountApp(rootEl, opts = {}) {
  if (!rootEl) {
    console.warn('[app] mountApp called without a root element.');
    return undefined;
  }

  const { onAddPhotos } = opts;
  const dates = tripWindowDates();

  const clampIndex = (i) => Math.max(0, Math.min(dates.length - 1, i));
  // Forward declarations so the inner navigators can reference each other.
  const navigate = (i) =>
    mountDayAt(rootEl, dates, clampIndex(i), navigate, mountOverview, onAddPhotos);
  const toIso = (iso) => {
    const i = dates.indexOf(iso);
    if (i >= 0) navigate(i);
  };
  // Mount the overview screen. Called at boot when pickLandingView picks 'overview'
  // and on every Home-button tap. Recomputes daysUntil each call so the countdown
  // reflects "now" rather than whatever it was at boot.
  function mountOverview() {
    stopActiveDayView();
    rootEl.textContent = '';
    scrollToTop();
    // daysUntil is only set on the pre-trip 'overview' landing; mid/post-trip
    // it is absent (re-mounts from the Home button), and renderOverview's
    // countdown branch is gated by Number.isFinite — null passes through cleanly.
    const { daysUntil } = pickLandingView(getNow());
    const overview = renderOverview(daysUntil ?? null, toIso);
    rootEl.appendChild(overview.node);
    overview.start();
  }

  const landing = pickLandingView(getNow());

  if (landing.view === 'overview') {
    mountOverview();
  } else {
    // Find the index of the landing day; fall back to the first window day.
    const landingIso = landing.day?.date ?? localISODate(getNow());
    const idx = dates.indexOf(landingIso);
    navigate(idx >= 0 ? idx : 0);
  }

  return {
    go: navigate,
    toIso,
    toOverview: mountOverview,
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

// ===========================================================================
// Photo upload flow (photo-upload-flow)
//
// One-tap "Add photos": foreground multi-select picker → read each photo's EXIF
// capture date → bucket by trip day → downscale → upload to Firebase Storage →
// write a Firestore metadata doc; deduped and overwrite-proof.
//
// Architecture mirrors the auth gate: every Firebase/DOM/FileReader boundary is
// an INJECTED dependency of `wirePhotoSync(deps)`, so the orchestration is
// unit-testable with stubs and `node --test` stays network-free. The pure cores
// (`readCaptureDate`, `exifDateTimeString`, `compositeKey`, `decideFile`) take
// no DOM/Firebase and are exported for direct unit tests.
//
// SECURITY: all user-derived strings reach the DOM via textContent/createElement
// (the el() helper) — never innerHTML. Storage paths are sanitized; the EXIF
// date STRING is used directly (no Date() conversion → no device-tz day drift).
// ===========================================================================

// ---- EXIF capture-date parser (pure core) ---------------------------------

/**
 * Read EXIF `DateTimeOriginal` (tag 0x9003, in the Exif sub-IFD) from a JPEG's
 * bytes and return the raw EXIF datetime string `"YYYY:MM:DD HH:MM:SS"`, or null
 * if absent/unparseable. Pure: takes an ArrayBuffer (or ArrayBuffer-like with a
 * byteLength) and returns a string|null — no DOM, no I/O.
 *
 * Walks: SOI `FFD8` → scan APP segments for APP1 `FFE1` carrying `"Exif\0\0"` →
 * read the TIFF header endianness (`II`=little, `MM`=big) → IFD0 → follow the
 * Exif-IFD pointer (tag 0x8769) → read 0x9003. Falls back to IFD0's weaker
 * `DateTime` (0x0132) only if the sub-IFD date is missing. Bounds-checked
 * throughout (a truncated/garbage buffer returns null, never throws).
 *
 * @param {ArrayBuffer | ArrayBufferView} buffer
 * @returns {string | null} raw EXIF datetime, e.g. "2026:06:25 23:30:00"
 */
export function readExifDateTimeOriginal(buffer) {
  let bytes;
  try {
    if (buffer instanceof Uint8Array) bytes = buffer;
    else if (buffer && typeof buffer.byteLength === 'number') bytes = new Uint8Array(buffer);
    else return null;
  } catch {
    return null;
  }
  const len = bytes.length;
  if (len < 4) return null;
  // SOI marker FFD8.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  // Scan APP segments for APP1 (FFE1) that begins with "Exif\0\0".
  let p = 2;
  let tiffStart = -1;
  while (p + 4 <= len) {
    if (bytes[p] !== 0xff) { p += 1; continue; } // resync on stray padding
    const marker = bytes[p + 1];
    // Standalone markers (no length): RST0–7, SOI, EOI, TEM.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const segLen = (bytes[p + 2] << 8) | bytes[p + 3];
    if (segLen < 2) return null; // malformed length
    const segStart = p + 4;
    if (marker === 0xe1) {
      // APP1 — check for the "Exif\0\0" signature.
      if (segStart + 6 <= len &&
          bytes[segStart] === 0x45 && bytes[segStart + 1] === 0x78 &&
          bytes[segStart + 2] === 0x69 && bytes[segStart + 3] === 0x66 &&
          bytes[segStart + 4] === 0x00 && bytes[segStart + 5] === 0x00) {
        tiffStart = segStart + 6;
        break;
      }
    }
    if (marker === 0xda) break; // SOS — image data starts; no EXIF beyond.
    p += 2 + segLen;
  }
  if (tiffStart < 0 || tiffStart + 8 > len) return null;

  // TIFF header: byte-order ("II"/"MM"), magic 0x002A, IFD0 offset.
  const b0 = bytes[tiffStart];
  const b1 = bytes[tiffStart + 1];
  let little;
  if (b0 === 0x49 && b1 === 0x49) little = true;       // "II"
  else if (b0 === 0x4d && b1 === 0x4d) little = false;  // "MM"
  else return null;

  const u16 = (off) => little
    ? bytes[off] | (bytes[off + 1] << 8)
    : (bytes[off] << 8) | bytes[off + 1];
  const u32 = (off) => {
    const v = little
      ? bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)
      : (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
    return v >>> 0; // unsigned
  };

  if (u16(tiffStart + 2) !== 0x002a) return null; // TIFF magic
  const ifd0Off = u32(tiffStart + 4);
  const ifd0 = tiffStart + ifd0Off;
  if (ifd0 + 2 > len) return null;

  // Read an ASCII value for a tag in the IFD at `ifdOff`. Returns the trimmed
  // string, or null. Handles inline (≤4 byte) and offset values.
  const readAscii = (ifdOff, wantTag) => {
    if (ifdOff + 2 > len) return null;
    const count = u16(ifdOff);
    let e = ifdOff + 2;
    for (let i = 0; i < count; i += 1, e += 12) {
      if (e + 12 > len) return null;
      const tag = u16(e);
      if (tag !== wantTag) continue;
      const type = u16(e + 2);
      const num = u32(e + 4);
      if (type !== 2 || num === 0) return null; // ASCII only
      const valOff = num <= 4 ? e + 8 : tiffStart + u32(e + 8);
      if (valOff + num > len) return null;
      let s = '';
      for (let k = 0; k < num; k += 1) {
        const c = bytes[valOff + k];
        if (c === 0) break; // NUL terminator
        s += String.fromCharCode(c);
      }
      s = s.trim();
      return s || null;
    }
    return null;
  };

  // Find the Exif sub-IFD pointer (tag 0x8769) in IFD0.
  const readPointer = (ifdOff, wantTag) => {
    if (ifdOff + 2 > len) return 0;
    const count = u16(ifdOff);
    let e = ifdOff + 2;
    for (let i = 0; i < count; i += 1, e += 12) {
      if (e + 12 > len) return 0;
      if (u16(e) === wantTag) return u32(e + 8);
    }
    return 0;
  };

  const exifIfdOff = readPointer(ifd0, 0x8769);
  if (exifIfdOff) {
    const subDate = readAscii(tiffStart + exifIfdOff, 0x9003); // DateTimeOriginal
    if (subDate) return subDate;
  }
  // Weaker fallback: IFD0 DateTime (0x0132) — file-modification time, not capture.
  return readAscii(ifd0, 0x0132);
}

/**
 * Normalize a raw EXIF datetime string `"YYYY:MM:DD HH:MM:SS"` into a sortable
 * string `"YYYY-MM-DD HH:MM:SS"` (dashes in the date, no timezone). Returns null
 * if the input doesn't match the EXIF shape. NO Date() conversion — keeps the
 * camera wall-clock verbatim so the bucket day never drifts by a timezone.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function exifDateTimeString(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // Sanity bounds — reject impossible components (00 month/day, >23h etc).
  const Y = +y, MO = +mo, D = +d, H = +h, MI = +mi, S = +s;
  if (MO < 1 || MO > 12 || D < 1 || D > 31 || H > 23 || MI > 59 || S > 59) return null;
  if (Y < 1970 || Y > 9999) return null;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/**
 * Read a JPEG's bytes → normalized sortable EXIF datetime `"YYYY-MM-DD HH:MM:SS"`,
 * or null. Convenience composition of readExifDateTimeOriginal + exifDateTimeString.
 * @param {ArrayBuffer | ArrayBufferView} buffer
 * @returns {string | null}
 */
export function readCaptureDate(buffer) {
  return exifDateTimeString(readExifDateTimeOriginal(buffer));
}

/** Extract the bucket day "YYYY-MM-DD" from a normalized EXIF datetime, or null. */
export function bucketDateFromExif(normalized) {
  if (typeof normalized !== 'string') return null;
  const m = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ---- Dedup composite key (pure core) --------------------------------------

/**
 * Best-effort dedup key for a photo, computed WITHOUT a decode (so a re-selected
 * photo is skipped before any image decode/upload). Uses
 * `(uploader, exifDateTime, originalFileSize)`. When `exifDateTime` is absent the
 * key degrades to `(uploader, '', size)` — a deliberately weaker key (see the
 * accepted trade-off): two distinct same-size no-EXIF photos could collide, which
 * we accept over a wrong overwrite.
 * @param {string} uploader
 * @param {string|null|undefined} exifDateTime normalized "YYYY-MM-DD HH:MM:SS" or null
 * @param {number} originalFileSize bytes
 * @returns {string}
 */
export function compositeKey(uploader, exifDateTime, originalFileSize) {
  const u = sanitizePathSegment(uploader);
  const dt = typeof exifDateTime === 'string' ? exifDateTime : '';
  const sz = Number.isFinite(originalFileSize) ? String(originalFileSize) : '0';
  return `${u}|${dt}|${sz}`;
}

// ---- Path / identity helpers ----------------------------------------------

/**
 * Sanitize a string for safe use as a single Firebase Storage path segment:
 * strip slashes, control chars, and Storage-reserved characters; collapse
 * whitespace to "-"; cap length. The four traveler names are already clean — this
 * is defensive (guards a stray pasted name). Empty result → "unknown".
 * @param {unknown} s
 * @returns {string}
 */
export function sanitizePathSegment(s) {
  if (typeof s !== 'string') return 'unknown';
  const cleaned = s
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f]/g, '')   // control chars
    .replace(/[\/\\]/g, '')             // path separators
    .replace(/[#?\[\]*]/g, '')          // Storage-reserved + glob chars
    .replace(/\s+/g, '-')               // whitespace → dash
    .replace(/^[.\-]+/, '')             // no leading dot/dash
    .slice(0, 64)
    .trim();
  return cleaned || 'unknown';
}

const UPLOADER_KEY = 'jt:uploader';

/**
 * Read the persisted uploader identity from localStorage (key `jt:uploader`),
 * or null. Guarded — localStorage can throw in Safari private mode; a throw
 * degrades to "no stored identity" (ask again this session).
 * @returns {string | null}
 */
export function getUploader() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(UPLOADER_KEY);
    return typeof v === 'string' && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/**
 * Persist the uploader identity. Guarded — a throw (private mode) is swallowed;
 * the choice still works for the current session (the caller keeps it in memory).
 * @param {string} name
 * @returns {boolean} true if persisted
 */
export function setUploader(name) {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (typeof name !== 'string' || !name.trim()) return false;
    localStorage.setItem(UPLOADER_KEY, name);
    return true;
  } catch {
    return false;
  }
}

// ---- Per-file decision (pure core) ----------------------------------------

/**
 * Decide what to do with one already-prepared file descriptor, BEFORE any decode
 * or upload. Pure: no DOM/Firebase. Returns a discriminated result:
 *   { action: 'skip-window', date }   — bucket day is outside the trip window
 *   { action: 'skip-dedup', key }     — composite key already present
 *   { action: 'upload', date, key }   — proceed (downscale + upload)
 *
 * @param {object} d
 * @param {string} d.uploader
 * @param {string|null} d.exifDateTime normalized "YYYY-MM-DD HH:MM:SS" or null
 * @param {string} d.date bucket day "YYYY-MM-DD" (already resolved by the caller)
 * @param {number} d.size original file size in bytes
 * @param {Set<string>} d.dedupSet keys already uploaded (preload + this batch)
 * @param {Set<string>} d.windowSet allowed trip-window days (Set of ISO dates)
 * @returns {{action:'skip-window'|'skip-dedup'|'upload', date?:string, key?:string}}
 */
export function decideFile({ uploader, exifDateTime, date, size, dedupSet, windowSet }) {
  if (!windowSet.has(date)) return { action: 'skip-window', date };
  const key = compositeKey(uploader, exifDateTime, size);
  if (dedupSet.has(key)) return { action: 'skip-dedup', key };
  return { action: 'upload', date, key };
}

/**
 * Format the end-of-run summary line from tallies. Pure.
 * @param {{added:number, dupes:number, skipped:number, errors:number, days:number}} t
 * @returns {string}
 */
export function summarizeRun({ added, dupes, skipped, errors, days }) {
  const parts = [];
  parts.push(added === 0
    ? 'No new photos added'
    : `Added ${added} ${added === 1 ? 'photo' : 'photos'}${days ? ` across ${days} ${days === 1 ? 'day' : 'days'}` : ''}`);
  if (dupes) parts.push(`${dupes} already in journal`);
  if (skipped) parts.push(`${skipped} outside the trip skipped`);
  if (errors) parts.push(`${errors} couldn’t be added`);
  return parts.join(' · ');
}

// ---- Browser wrappers (DOM / File / Image — not unit-tested directly) ------

/** Read a File/Blob to an ArrayBuffer via FileReader. Browser-only. */
function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('read failed'));
    fr.readAsArrayBuffer(file);
  });
}

/**
 * Resolve a file's normalized EXIF datetime + bucket date.
 * Precedence: EXIF DateTimeOriginal string → File.lastModified → null (caller's
 * no-EXIF batch path supplies the user-correctable default). NEVER uses Date()
 * for the EXIF case. Returns { exifDateTime, date, fromExif }.
 * @param {File} file
 * @returns {Promise<{exifDateTime:string|null, date:string|null, fromExif:boolean}>}
 */
async function fileCaptureDate(file) {
  let exifDateTime = null;
  try {
    const buf = await fileToArrayBuffer(file);
    exifDateTime = readCaptureDate(buf);
  } catch {
    exifDateTime = null;
  }
  if (exifDateTime) {
    return { exifDateTime, date: bucketDateFromExif(exifDateTime), fromExif: true };
  }
  // No EXIF → use lastModified as a best-effort hint for the bucket day, but mark
  // it not-from-EXIF so the caller routes it through the user-correctable batch.
  // lastModified is the camera/file mtime in device-local terms; localISODate is
  // acceptable HERE (it's a hint the user can override), unlike for EXIF.
  if (file && Number.isFinite(file.lastModified) && file.lastModified > 0) {
    const lm = localISODate(new Date(file.lastModified));
    return { exifDateTime: null, date: lm, fromExif: false };
  }
  return { exifDateTime: null, date: null, fromExif: false };
}

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

/**
 * Downscale + orientation-correct an image File to a JPEG Blob (~2048px max edge,
 * quality ~0.85). Uses createImageBitmap(file, { imageOrientation: 'from-image' })
 * so EXIF rotation is baked in. Browser-only. Bails to the ORIGINAL file on any
 * decode/encode failure (HEIC the browser can't decode, etc.) — never throws.
 * Returns { blob, downscaled }.
 * @param {File} file
 * @returns {Promise<{blob: Blob, downscaled: boolean}>}
 */
async function downscaleImage(file) {
  try {
    if (typeof createImageBitmap !== 'function') return { blob: file, downscaled: false };
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    let canvas;
    if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(w, h);
    else { canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return { blob: file, downscaled: false }; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    let blob;
    if (typeof canvas.convertToBlob === 'function') {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    } else {
      blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    }
    if (!blob) return { blob: file, downscaled: false };
    return { blob, downscaled: true };
  } catch {
    return { blob: file, downscaled: false };
  }
}

/**
 * Build a pool-backed dispatcher that offloads downscaleImage's work to Web
 * Workers (photo-worker.js). Returns `{ downscale, ready, destroy, _pendingSize }`.
 *
 * - `downscale(file)` matches downscaleImage's contract: resolves `{ blob, downscaled }`.
 *   It NEVER throws and NEVER pends forever — on worker failure, timeout, or a
 *   postMessage throw it resolves to the ORIGINAL `{ blob: file, downscaled: false }`.
 * - `ready` is an always-settling promise: true once any worker posts `{ready:true}`,
 *   false on any worker `onerror`, a `{ready:false}` from every worker, or a
 *   readiness timeout. It never leaves it pending.
 *
 * `spawn` is injected (tests pass a fake that returns a plain object with
 * postMessage/onmessage/onerror/terminate). MAX_DIMENSION/JPEG_QUALITY are passed
 * in every message — the worker never hardcodes them (single source of truth).
 *
 * Pending requests live in ONE Map keyed by a GLOBAL monotonic id (not per-worker)
 * so a second message to a worker can't orphan the first resolver.
 *
 * @param {{ spawn: () => Worker, poolSize?: number, timeoutMs?: number,
 *           setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} opts
 */
export function createWorkerDownscaler({
  spawn,
  poolSize = 2,
  timeoutMs = 8000,
  setTimer = (typeof setTimeout !== 'undefined' ? setTimeout : null),
  clearTimer = (typeof clearTimeout !== 'undefined' ? clearTimeout : null),
} = {}) {
  let nextId = 1;                       // global monotonic id
  let cursor = 0;                       // round-robin pointer
  const pending = new Map();            // id -> { resolve, file, timer }

  // Cancel a timer handle iff there is one AND a clearTimer to call (both are
  // seam-injectable / absent in non-timer environments — these guards are
  // load-bearing, never drop them).
  const cancelTimer = (t) => { if (t != null && clearTimer) clearTimer(t); };

  let resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });
  let readySettled = false;
  const settleReady = (val) => {
    if (readySettled) return;
    readySettled = true;
    cancelTimer(readyTimer);
    resolveReady(val);
  };

  // Fail-safe readiness timeout so a worker that never posts {ready} can't hang
  // the probe. Uses the same timeoutMs budget.
  let readyTimer = null;
  if (setTimer) readyTimer = setTimer(() => settleReady(false), timeoutMs);

  const resolveEntry = (id, result) => {
    const entry = pending.get(id);
    if (!entry) return; // late reply for a timed-out / unknown id → no-op
    cancelTimer(entry.timer);
    pending.delete(id);
    entry.resolve(result);
  };

  const handleMessage = (msg) => {
    if (!msg) return;
    if (msg.ready !== undefined) { settleReady(!!msg.ready); return; }
    if (msg.id === undefined) return;
    resolveEntry(
      msg.id,
      msg.ok
        ? { blob: msg.blob, downscaled: true }
        : { blob: pending.get(msg.id)?.file, downscaled: false },
    );
  };

  const failAll = () => {
    for (const [, entry] of pending) {
      cancelTimer(entry.timer);
      entry.resolve({ blob: entry.file, downscaled: false });
    }
    pending.clear();
    settleReady(false);
  };

  const workers = [];
  for (let i = 0; i < Math.max(1, poolSize); i += 1) {
    const wkr = spawn();
    wkr.onmessage = (e) => handleMessage(e && e.data !== undefined ? e.data : e);
    wkr.onerror = () => failAll();
    workers.push(wkr);
  }

  function downscale(file) {
    return new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimer
        ? setTimer(() => {
            // Timeout → original; deleting the entry makes any late reply a no-op.
            pending.delete(id);
            resolve({ blob: file, downscaled: false });
          }, timeoutMs)
        : null;
      pending.set(id, { resolve, file, timer });
      const wkr = workers[cursor];
      cursor = (cursor + 1) % workers.length;
      try {
        wkr.postMessage({ id, file, maxDimension: MAX_DIMENSION, quality: JPEG_QUALITY });
      } catch {
        cancelTimer(timer);
        pending.delete(id);
        resolve({ blob: file, downscaled: false });
      }
    });
  }

  function destroy() {
    for (const [, entry] of pending) cancelTimer(entry.timer);
    pending.clear();
    cancelTimer(readyTimer);
    for (const wkr of workers) { try { wkr.terminate?.(); } catch { /* ignore */ } }
  }

  return { downscale, ready, destroy, _pendingSize: () => pending.size };
}

/** Generate a UUID for the unique storage path. Falls back if crypto is absent. */
function uuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---- Body-mounted modal (lightbox focus-trap pattern) ---------------------

let photoModalSeq = 0; // unique-id counter for aria-labelledby title ids

/**
 * Generic body-mounted modal sheet. Mirrors buildLightbox's open/teardown/focus-
 * trap + body-mount (escapes the nav's backdrop-filter containing block). The
 * caller fills `.modal-body`. Returns { node, open, close, destroy, bodyEl }.
 * Focus is trapped across the modal's own focusable controls; Esc closes (unless
 * `dismissible:false`). Browser-only at runtime, but constructed via el() so the
 * Node DOM stub can build + drive it in tests.
 */
function buildModalSheet({ titleText, dismissible = true, onClose } = {}) {
  const overlay = el('div', 'photo-modal');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const card = el('div', 'photo-modal-card');
  if (titleText) {
    const titleId = `photo-modal-title-${photoModalSeq++}`;
    const h = el('h2', 'photo-modal-title', titleText);
    h.id = titleId;
    overlay.setAttribute('aria-labelledby', titleId);
    card.appendChild(h);
  }
  const bodyEl = el('div', 'photo-modal-body');
  card.appendChild(bodyEl);
  overlay.appendChild(card);

  let isOpen = false;
  let lastFocused = null;

  function focusables() {
    return card.queryAll
      ? card.queryAll((n) => isFocusable(n)) // test stub
      : Array.from(card.querySelectorAll('button, [href], input, select, [tabindex]'))
          .filter((n) => !n.disabled && n.tabIndex !== -1);
  }

  function onKey(e) {
    if (dismissible && e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const items = focusables();
      if (!items.length) { e.preventDefault(); return; }
      e.preventDefault();
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const i = items.indexOf(active);
      const nextIdx = e.shiftKey
        ? (i <= 0 ? items.length - 1 : i - 1)
        : (i < 0 || i >= items.length - 1 ? 0 : i + 1);
      items[nextIdx].focus();
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocused = typeof document !== 'undefined' ? document.activeElement : null;
    if (!overlay.parentNode && typeof document !== 'undefined' && document.body) {
      document.body.appendChild(overlay);
    }
    overlay.hidden = false;
    document.addEventListener('keydown', onKey);
    const items = focusables();
    (items[0] ?? card).focus?.();
  }

  function close(restoreFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    overlay.hidden = true;
    document.removeEventListener('keydown', onKey);
    if (overlay.parentNode && typeof overlay.parentNode.removeChild === 'function') {
      overlay.parentNode.removeChild(overlay);
    }
    if (restoreFocus && lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    if (typeof onClose === 'function') onClose();
  }

  function destroy() { close(false); }

  return { node: overlay, card, bodyEl, open, close, destroy };
}

/** Crude focusable test for the Node stub (buttons/inputs that aren't disabled). */
function isFocusable(n) {
  if (!n || n.disabled) return false;
  const tag = n.tagName;
  return tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'A';
}

/**
 * "Who's uploading?" prompt — a one-button-per-traveler picker. Resolves with the
 * chosen name, or null if dismissed. Reads names from TRIP.travelers. Body-mounted.
 * @param {string[]} travelers
 * @returns {Promise<string|null>}
 */
function promptUploader(travelers) {
  return new Promise((resolve) => {
    const modal = buildModalSheet({ titleText: 'Who’s uploading?', dismissible: true,
      onClose: () => resolve(resolved ? chosen : null) });
    let resolved = false;
    let chosen = null;
    const intro = el('p', 'photo-modal-note', 'We’ll remember your pick on this device.');
    modal.bodyEl.appendChild(intro);
    const list = el('div', 'photo-uploader-choices');
    (Array.isArray(travelers) ? travelers : []).forEach((name) => {
      const btn = el('button', 'photo-uploader-choice', name);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        resolved = true;
        chosen = name;
        modal.close();
      });
      list.appendChild(btn);
    });
    modal.bodyEl.appendChild(list);
    modal.open();
  });
}

/**
 * Date-correction prompt for a batch of no-EXIF photos: one date for the whole
 * group (default = the currently-viewed day or today). Resolves with the chosen
 * "YYYY-MM-DD", or null if cancelled. Body-mounted.
 * @param {number} count number of no-EXIF photos in the batch
 * @param {string} defaultIso default bucket date
 * @returns {Promise<string|null>}
 */
function promptBatchDate(count, defaultIso) {
  return new Promise((resolve) => {
    let done = false;
    const modal = buildModalSheet({ titleText: 'What day were these from?', dismissible: true,
      onClose: () => { if (!done) resolve(null); } });
    const note = el('p', 'photo-modal-note',
      `${count} ${count === 1 ? 'photo has' : 'photos have'} no capture date. Pick the day they were taken.`);
    modal.bodyEl.appendChild(note);

    const input = el('input', 'photo-date-input');
    input.type = 'date';
    input.value = typeof defaultIso === 'string' ? defaultIso : '';
    // Clamp the picker to the trip window so the date stays in-range.
    const win = tripWindowDates();
    if (win.length) { input.min = win[0]; input.max = win[win.length - 1]; }
    modal.bodyEl.appendChild(input);

    const actions = el('div', 'photo-modal-actions');
    const cancel = el('button', 'photo-modal-btn photo-modal-btn-ghost', 'Skip these');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { done = true; resolve(null); modal.close(); });
    const ok = el('button', 'photo-modal-btn', 'Add to this day');
    ok.type = 'button';
    ok.addEventListener('click', () => {
      done = true;
      resolve(input.value || defaultIso || null);
      modal.close();
    });
    actions.appendChild(cancel);
    actions.appendChild(ok);
    modal.bodyEl.appendChild(actions);

    modal.open();
  });
}

/**
 * Progress sheet: a live "Adding N of M…" line that swaps to a summary + Done
 * button when finished. Body-mounted, NOT dismissible while running. Returns
 * { setProgress(done,total), finish(summaryText), destroy }.
 */
function buildProgressSheet() {
  const modal = buildModalSheet({ titleText: 'Adding photos', dismissible: false });
  const status = el('p', 'photo-progress-status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Preparing…';
  modal.bodyEl.appendChild(status);

  const bar = el('div', 'photo-progress-bar');
  const fill = el('div', 'photo-progress-fill');
  bar.appendChild(fill);
  modal.bodyEl.appendChild(bar);

  const doneBtn = el('button', 'photo-modal-btn', 'Done');
  doneBtn.type = 'button';
  doneBtn.hidden = true;
  doneBtn.addEventListener('click', () => modal.close());
  modal.bodyEl.appendChild(doneBtn);

  modal.open();

  return {
    setProgress(done, total) {
      status.textContent = `Adding ${done} of ${total}…`;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      try { fill.style.width = `${pct}%`; } catch { /* stub has no style */ }
    },
    finish(summaryText) {
      status.textContent = summaryText;
      try { fill.style.width = '100%'; } catch { /* ignore */ }
      doneBtn.hidden = false;
      doneBtn.focus?.();
    },
    destroy: modal.destroy,
  };
}

/**
 * Show a transient error sheet (e.g. offline). Body-mounted, dismissible.
 * @param {string} message
 */
function showPhotoError(message) {
  const modal = buildModalSheet({ titleText: 'Couldn’t add photos', dismissible: true });
  modal.bodyEl.appendChild(el('p', 'photo-modal-note', message));
  const ok = el('button', 'photo-modal-btn', 'OK');
  ok.type = 'button';
  ok.addEventListener('click', () => modal.close());
  modal.bodyEl.appendChild(ok);
  modal.open();
}

// ---- Orchestrator (injected-seam, testable) -------------------------------

/**
 * Default browser file picker: a hidden multi-select <input type="file"> that
 * resolves with the chosen File[] (or [] if cancelled). Resets `value` each call
 * so re-selecting the SAME photos still fires `change`. Browser-only.
 * @returns {Promise<File[]>}
 */
function pickFilesBrowser() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const done = (files) => { if (settled) return; settled = true; cleanup(); resolve(files); };
    const onChange = () => done(input.files ? Array.from(input.files) : []);
    // A 'cancel' event (supported in newer browsers) or a focus-return with no
    // selection resolves to []. We listen for 'change'; if the user cancels, the
    // promise resolves on the next picker (the input is discarded).
    input.addEventListener('change', onChange);
    input.addEventListener('cancel', () => done([]));
    function cleanup() {
      input.removeEventListener('change', onChange);
      input.value = ''; // reset so an identical re-pick re-fires change next time
      if (input.parentNode) input.parentNode.removeChild(input);
    }
    if (document.body) document.body.appendChild(input);
    input.value = ''; // ensure a clean slate before opening
    input.click();
  });
}

/**
 * Build the photo-sync orchestrator. Every external boundary is INJECTED so the
 * whole flow is unit-testable with stubs (no Firebase, no real DOM/File). Returns
 * `run(currentIso)` — the `onAddPhotos` handler.
 *
 * @param {object} deps
 * @param {() => Promise<File[]>} deps.pickFiles open the picker → chosen files
 * @param {(file:File) => Promise<{exifDateTime:string|null,date:string|null,fromExif:boolean}>} deps.readDate
 * @param {(file:File) => Promise<{blob:Blob,downscaled:boolean}>} deps.downscale
 * @param {(path:string, blob:Blob, onProgress?:(f:number)=>void) => Promise<string>} deps.uploadBlob upload → download URL
 * @param {(docData:object) => Promise<void>} deps.writeDoc write the Firestore photos doc
 * @param {(uploader:string) => Promise<Set<string>>} deps.readDedup preload existing composite keys
 * @param {(uploader:string, lastUpload:string) => Promise<void>} deps.updateSyncState
 * @param {() => string[]} deps.travelers list for the identity prompt
 * @param {() => string|null} deps.getStoredUploader / @param {(name:string)=>void} deps.setStoredUploader
 * @param {(names:string[]) => Promise<string|null>} deps.askUploader identity prompt
 * @param {(count:number, defaultIso:string) => Promise<string|null>} deps.askBatchDate
 * @param {() => {setProgress:Function,finish:Function,destroy:Function}} deps.progress progress sheet factory
 * @param {(msg:string) => void} deps.onError surface a fatal/offline error
 * @param {() => boolean} deps.isOnline
 * @param {() => Date} deps.now clock seam (getNow)
 * @param {() => string[]} deps.windowDates trip window ISO dates (tripWindowDates)
 * @param {number} [deps.concurrency=3]
 * @returns {{ run: (currentIso?:string) => Promise<object|undefined> }}
 */
export function wirePhotoSync(deps) {
  const {
    pickFiles, readDate, downscale, uploadBlob, writeDoc, readDedup,
    updateSyncState, travelers, getStoredUploader, setStoredUploader,
    askUploader, askBatchDate, progress, onError, isOnline, now, windowDates,
    concurrency = 3,
  } = deps;

  let running = false; // re-entrancy latch — a double-tap is a no-op while busy.

  async function resolveUploader() {
    const stored = getStoredUploader();
    if (stored) return stored;
    const chosen = await askUploader(travelers());
    if (chosen) setStoredUploader(chosen);
    return chosen; // may be null if dismissed
  }

  async function run(currentIso) {
    if (running) return undefined;
    running = true;
    try {
      const uploader = await resolveUploader();
      if (!uploader) return undefined; // dismissed identity prompt

      const files = await pickFiles();
      if (!files || files.length === 0) return undefined;

      if (typeof isOnline === 'function' && !isOnline()) {
        onError('You need an internet connection to add photos. Reconnect and try again.');
        return undefined;
      }

      const cleanUploader = sanitizePathSegment(uploader);
      const windowSet = new Set(windowDates());
      // Soft client-side lastUpload bound is applied inside readDedup's consumer;
      // here we just preload all of this uploader's keys (single-field query).
      let dedupSet;
      try {
        dedupSet = await readDedup(uploader);
      } catch (err) {
        // Dedup preload failure is non-fatal — proceed without it (worst case: a
        // duplicate, never a loss). But a network failure here likely means the
        // uploads will fail too; surface it if offline.
        dedupSet = new Set();
        console.warn('[photos] dedup preload failed:', err);
      }
      if (!(dedupSet instanceof Set)) dedupSet = new Set(dedupSet || []);

      // Phase 1: read capture dates (cheap, pre-decode). Partition into dated
      // (EXIF or lastModified) vs. no-date files needing the batch-date prompt.
      const prepared = [];
      const noDate = [];
      for (const file of files) {
        let info;
        try { info = await readDate(file); }
        catch { info = { exifDateTime: null, date: null, fromExif: false }; }
        const rec = { file, exifDateTime: info.exifDateTime, date: info.date, fromExif: info.fromExif };
        if (!rec.date) noDate.push(rec);
        else prepared.push(rec);
        // Yield a macrotask between EXIF reads so the pre-downscale phase (which
        // reads each file's header on the main thread) never blocks the UI for
        // the whole batch on a large multi-select.
        await new Promise((r) => setTimeout(r, 0));
      }

      // No-EXIF / no-date batch → one user-correctable date for the whole group.
      if (noDate.length) {
        const fallback = (typeof currentIso === 'string' && currentIso)
          || localISODate(now()) || windowDates()[0] || null;
        const batchDate = await askBatchDate(noDate.length, fallback);
        if (batchDate) {
          noDate.forEach((rec) => { rec.date = batchDate; prepared.push(rec); });
        }
        // Cancelled → those files are dropped (skipped), never silently mis-dated.
      }

      if (prepared.length === 0) return undefined;

      const ui = progress();
      const tally = { added: 0, dupes: 0, skipped: 0, errors: 0 };
      const daysAdded = new Set();
      let completed = 0;
      const total = prepared.length;
      ui.setProgress(0, total);

      // Per-file worker. Bounded concurrency via a shared cursor.
      let cursor = 0;
      const advance = () => { completed += 1; ui.setProgress(completed, total); };

      async function worker() {
        while (cursor < prepared.length) {
          const rec = prepared[cursor++];
          try {
            const decision = decideFile({
              uploader: cleanUploader,
              exifDateTime: rec.exifDateTime,
              date: rec.date,
              size: rec.file.size,
              dedupSet,
              windowSet,
            });
            if (decision.action === 'skip-window') { tally.skipped += 1; continue; }
            if (decision.action === 'skip-dedup') { tally.dupes += 1; continue; }

            // Reserve the key NOW so two same-key files in one batch don't both upload.
            dedupSet.add(decision.key);

            const { blob } = await downscale(rec.file);
            const path = `trip-photos/${rec.date}/${cleanUploader}/${uuid()}.jpg`;
            const url = await uploadBlob(path, blob);
            await writeDoc({
              date: rec.date,
              uploader,
              storagePath: path,
              url,
              takenAt: rec.exifDateTime || `${rec.date} 00:00:00`,
              size: rec.file.size,
            });
            tally.added += 1;
            daysAdded.add(rec.date);
          } catch (err) {
            tally.errors += 1;
            console.warn('[photos] file failed:', err);
          } finally {
            advance();
          }
        }
      }

      const workers = [];
      const n = Math.max(1, Math.min(concurrency, prepared.length));
      for (let i = 0; i < n; i += 1) workers.push(worker());
      await Promise.all(workers);

      // Update the soft last-sync hint (best-effort; never blocks the summary).
      if (tally.added > 0) {
        const latest = [...daysAdded].sort().pop();
        try { await updateSyncState(uploader, latest); }
        catch (err) { console.warn('[photos] syncState update failed:', err); }
      }

      const summary = summarizeRun({ ...tally, days: daysAdded.size });
      ui.finish(summary);
      return { ...tally, days: daysAdded.size };
    } finally {
      running = false;
    }
  }

  return { run };
}

// Module-level handle to the live photo service, built ONCE in boot() after auth
// resolves (onAuthStateChanged can fire again on sign-out/in). `mountTheApp` is
// defined OUTSIDE boot(), so it reads this module-level reference to wire the
// real onAddPhotos handler into mountApp.
let photoService = null;

// Lazy worker-downscaler singleton. Built on FIRST use only (browser boot path —
// never at module load, so `node --test` never spawns a Worker). Guarded against
// rebuilding because onAuthStateChanged can re-fire (sign-out/in) and re-run the
// mount path. The real `spawn` is the only line that touches a browser API; it is
// invoked exclusively from here.
let workerDownscaler = null;
function getWorkerDownscaler() {
  if (!workerDownscaler) {
    workerDownscaler = createWorkerDownscaler({
      spawn: () => new Worker(new URL('./photo-worker.js', import.meta.url), { type: 'module' }),
    });
  }
  return workerDownscaler;
}

// Main-thread fallback (no OffscreenCanvas-in-worker, e.g. iOS ≤16). Serializes
// downscales through a module-level chain AND yields a macrotask between files so
// a bulk upload can't freeze the UI for the whole batch. Concurrent callers queue
// behind the same chain (the bounded-concurrency loop in wirePhotoSync would
// otherwise fire `concurrency` decodes at once on the main thread → jank).
let downscaleThrottleChain = Promise.resolve();
function downscaleImageThrottled(file) {
  const result = downscaleThrottleChain.then(() => downscaleImage(file));
  // Advance the chain to AFTER a yield, so the next queued downscale gives the UI
  // a frame to breathe. Swallow rejections so one failure can't poison the chain.
  downscaleThrottleChain = result
    .catch(() => {})
    .then(() => new Promise((r) => setTimeout(r, 0)));
  return result;
}

/**
 * Build the real onAddPhotos(currentIso) handler from a lazily-imported Firebase
 * { db, storage } service + the firestore/storage SDK fn bag. Browser-only — all
 * Firebase fns are injected (the SDK is dynamically imported in boot()). Returns
 * the handler, or a no-op if the service is unavailable.
 */
function buildOnAddPhotos(service) {
  if (!service) return undefined;
  const { db, storage, fb } = service;
  const {
    collection, doc, setDoc, getDocs, query, where, serverTimestamp,
    ref, uploadBytesResumable, getDownloadURL,
  } = fb;

  // Per-call downscale router. The worker readiness probe is async and resolves
  // AFTER this handler is built (buildOnAddPhotos runs ONCE at mount), so the
  // worker-vs-fallback decision MUST be made per call — baking it at mount time
  // would freeze the slow path forever. `wd.ready` already always-settles; the
  // extra Promise.race timeout is belt-and-suspenders so a tap never hangs on the
  // probe. On the fallback path we use the anti-freeze throttled main-thread path.
  const wd = getWorkerDownscaler();
  const downscaleRouted = async (file) => {
    const ok = await Promise.race([
      wd.ready,
      new Promise((r) => setTimeout(() => r(false), 8000)),
    ]);
    return ok ? wd.downscale(file) : downscaleImageThrottled(file);
  };

  const sync = wirePhotoSync({
    pickFiles: pickFilesBrowser,
    readDate: fileCaptureDate,
    downscale: downscaleRouted,
    uploadBlob: (path, blob) => new Promise((resolve, reject) => {
      const task = uploadBytesResumable(ref(storage, path), blob, { contentType: 'image/jpeg' });
      task.on('state_changed', null, reject, async () => {
        try { resolve(await getDownloadURL(task.snapshot.ref)); }
        catch (e) { reject(e); }
      });
    }),
    writeDoc: (data) => setDoc(doc(collection(db, 'photos')), { ...data, createdAt: serverTimestamp() }),
    readDedup: async (uploader) => {
      const set = new Set();
      const snap = await getDocs(query(collection(db, 'photos'), where('uploader', '==', uploader)));
      snap.forEach((d) => {
        const data = d.data();
        // Reconstruct the SAME exifDateTime used to key this photo at upload:
        //   takenAt = exifDateTime  (real EXIF, "YYYY-MM-DD HH:MM:SS")
        //          || "<date> 00:00:00"  (the no-EXIF midnight sentinel)
        // A trailing " 00:00:00" is treated as no-EXIF (key degrades to
        // uploader+size) so the read-side key matches the write-side key. This
        // collides only with a *real* midnight capture (rare, accepted). The
        // lastUpload bound is applied CLIENT-side / informational only (no
        // composite index) so a forgotten earlier day is never stranded.
        const ta = typeof data.takenAt === 'string' ? data.takenAt : '';
        const exifDt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ta) && !ta.endsWith(' 00:00:00')
          ? ta
          : null;
        set.add(compositeKey(uploader, exifDt, data.size));
      });
      return set;
    },
    updateSyncState: (uploader, lastUpload) =>
      setDoc(doc(db, 'syncState', sanitizePathSegment(uploader)), { lastUpload, updatedAt: serverTimestamp() }, { merge: true }),
    travelers: () => (Array.isArray(getTrip().travelers) ? getTrip().travelers.slice() : []),
    getStoredUploader: getUploader,
    setStoredUploader: setUploader,
    askUploader: promptUploader,
    askBatchDate: promptBatchDate,
    progress: buildProgressSheet,
    onError: showPhotoError,
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    now: getNow,
    windowDates: () => tripWindowDates(),
    concurrency: 3,
  });

  return (currentIso) => {
    sync.run(currentIso).catch((e) => {
      console.warn('[photos] run failed:', e);
      showPhotoError('Something went wrong adding photos.');
    });
  };
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

// ---------------------------------------------------------------------------
// Auth gate (auth-password-gate)
//
// A password-only landing backed by ONE shared Firebase account. The login
// overlay (static markup in index.html) covers the app until onAuthStateChanged
// reports a user; Firebase's default browserLocalPersistence keeps each device
// signed in across reloads. Security is enforced server-side by Firebase Auth +
// the deployed Storage/Firestore rules (request.auth != null) — this UI gate is
// convenience; the rules are the real lock.
//
// The Firebase SDK is loaded from the gstatic CDN via a DYNAMIC import() inside
// the browser-only boot path below — never at module top level — so `node --test`
// (which imports the pure helpers with no DOM/network) is unaffected.
// ---------------------------------------------------------------------------

// Hardcoded shared-account handle. The email in public client JS is fine — only
// the password is secret. If the real shared account differs, edit this one line.
const SHARED_EMAIL = 'jacob.press3@gmail.com';

// Pinned Firebase modular SDK (gstatic CDN). Pinned (not @latest) and runtime-
// cached by sw.js so the gate boots offline after the first online load.
const FIREBASE_SDK_VERSION = '10.12.5';
const FIREBASE_APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`;
const FIREBASE_AUTH_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`;
// Firestore + Storage SDKs (photo-upload-flow). Loaded lazily INSIDE boot()'s
// browser-only block (never at module top level) so `node --test` stays
// network-free. sw.js already runtime-caches www.gstatic.com/firebasejs/ → these
// new imports need no sw.js route change (only a CACHE_VERSION bump for the
// shell-file edit). Reuse FIREBASE_SDK_VERSION so all four SDKs stay in lockstep.
const FIREBASE_FIRESTORE_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`;
const FIREBASE_STORAGE_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-storage.js`;

/**
 * Pure gating decision — exported for unit tests so QA can verify the gate with
 * a stub and no network. Truthy auth-state user → reveal the app.
 * @param {unknown} user the onAuthStateChanged argument (Firebase user or null)
 * @returns {boolean}
 */
export function shouldShowApp(user) {
  return Boolean(user);
}

/**
 * Map a Firebase Auth error to a friendly, non-leaky message. Never surfaces raw
 * Firebase error codes or the shared email to the user.
 * @param {unknown} err
 * @returns {string}
 */
export function friendlyAuthError(err) {
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
      return 'That password didn’t work. Try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and try again.';
    default:
      return 'Something went wrong signing in. Please try again.';
  }
}

/**
 * Synchronously neutralize native form submission on the login form.
 *
 * The `#login-form` has no `action`, so a native submit (Enter key) would issue
 * a GET to `index.html?password=<typed>` — leaking the one shared secret into the
 * URL, history, the referrer header, and the SW navigation fetch. This guard must
 * run BEFORE the async SDK import resolves (and before `wireAuthGate` installs the
 * real submit handler), so it is attached at DOM-ready independent of the SDK.
 * The static `onsubmit="return false"` in index.html is the belt; this is the
 * suspenders. Both are idempotent — the real handler's `preventDefault` is
 * harmless on top of these.
 *
 * @param {HTMLFormElement|null} form the login form
 * @returns {boolean} true if a listener was attached
 */
export function installSubmitGuard(form) {
  if (!form || typeof form.addEventListener !== 'function') return false;
  form.addEventListener('submit', (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
  });
  return true;
}

/**
 * Wire the auth gate against an injected auth surface — the testable seam. Keeps
 * the SDK boundary thin: tests pass stubs for everything, no network/SDK needed.
 *
 * @param {object} deps
 * @param {(cb:(user:unknown)=>void)=>void} deps.onAuthStateChanged subscribe to auth state
 * @param {(email:string, password:string)=>Promise<unknown>} deps.signIn sign-in fn
 * @param {HTMLElement} deps.overlay the login overlay element (covers the app)
 * @param {HTMLFormElement} deps.form the login form
 * @param {HTMLInputElement} deps.passwordInput the password field
 * @param {HTMLButtonElement} deps.submitBtn the submit button
 * @param {HTMLElement} deps.errorEl the inline error region
 * @param {()=>void} deps.onAuthed called once when a user first appears (mount app)
 * @param {()=>void} [deps.onSignedOut] called when the user becomes null
 */
export function wireAuthGate(deps) {
  const {
    onAuthStateChanged, signIn, overlay, form, passwordInput,
    submitBtn, errorEl, onAuthed, onSignedOut,
  } = deps;

  let appMounted = false;

  const showError = (message) => {
    if (!errorEl) return;
    errorEl.textContent = message; // textContent only — XSS-safe
    errorEl.hidden = false;
  };
  const clearError = () => {
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.hidden = true;
  };
  const setPending = (pending) => {
    if (submitBtn) {
      submitBtn.disabled = pending;
      submitBtn.textContent = pending ? 'Signing in…' : 'Enter';
    }
    if (passwordInput) passwordInput.disabled = pending;
  };

  const showOverlay = () => {
    if (overlay) overlay.hidden = false;
    setPending(false);
    if (passwordInput) {
      // Focus the field for keyboard/AT users; never echo the value anywhere.
      try { passwordInput.focus(); } catch { /* jsdom-less stub: ignore */ }
    }
  };
  const hideOverlay = () => {
    if (overlay) overlay.hidden = true;
    if (passwordInput) passwordInput.value = ''; // drop the typed password
    clearError();
    setPending(false);
  };

  if (form) {
    form.addEventListener('submit', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      const password = passwordInput ? passwordInput.value : '';
      if (!password) {
        showError('Please enter the password.');
        return;
      }
      clearError();
      setPending(true);
      Promise.resolve()
        .then(() => signIn(SHARED_EMAIL, password))
        // Success path is handled by onAuthStateChanged (reveals the app).
        .catch((err) => {
          setPending(false);
          showError(friendlyAuthError(err));
          if (passwordInput) {
            passwordInput.value = '';
            try { passwordInput.focus(); } catch { /* ignore */ }
          }
        });
    });
  }

  onAuthStateChanged((user) => {
    if (shouldShowApp(user)) {
      hideOverlay();
      if (!appMounted) {
        appMounted = true;
        onAuthed();
      }
    } else {
      showOverlay();
      // Reset the mount-once latch so a later re-sign-in re-mounts the app (the
      // onSignedOut teardown clears #app-root; without this reset, re-auth would
      // un-hide an emptied root). The latch still prevents duplicate mounts while
      // a session stays signed in — the normal flow.
      appMounted = false;
      if (typeof onSignedOut === 'function') onSignedOut();
    }
  });

  // No user yet → show the gate immediately (don't wait for the async callback,
  // which could leave the app briefly uncovered).
  showOverlay();
}

if (typeof document !== 'undefined') {
  // Holds the live mountApp controller so a sign-out can tear the app down
  // (stop the active slideshow/lightbox + clear #app-root), leaving no stale
  // focusable content behind the aria-modal gate.
  let appController = null;

  const mountTheApp = () => {
    const root = document.getElementById('app-root');
    // Wire the real Add-photos handler from the module-level photoService (built
    // once in boot() after auth resolves). If the photo SDK failed to load, the
    // handler is undefined → the ☰ "Add photos" row renders disabled (graceful).
    const onAddPhotos = buildOnAddPhotos(photoService);
    // Wire the live reminisce-gallery read seam (uploaded photos merge into past
    // days). Absent service → setSubscribePhotos(null) keeps the authored-only
    // synchronous render path. Bound so `this` resolves to the service.
    setSubscribePhotos(
      photoService && typeof photoService.subscribePhotos === 'function'
        ? (iso, cb) => photoService.subscribePhotos(iso, cb)
        : null,
    );
    if (root) appController = mountApp(root, onAddPhotos ? { onAddPhotos } : {});
    // Surface the time-travel indicator (if an override resolved at load).
    // The banner is position:fixed, so it lives directly on <body>.
    if (ACTIVE_NOW_OVERRIDE && document.body) {
      document.body.appendChild(buildTimeTravelBanner(ACTIVE_NOW_OVERRIDE));
    }
  };

  // On sign-out, tear down the mounted app so nothing focusable lingers behind
  // the overlay. Reuses mountApp's own destroy() (stops timers + clears root).
  const teardownTheApp = () => {
    if (appController && typeof appController.destroy === 'function') {
      appController.destroy();
    }
    appController = null;
  };

  const boot = async () => {
    const overlay = document.getElementById('login-overlay');
    const form = document.getElementById('login-form');
    const passwordInput = document.getElementById('login-password');
    const submitBtn = document.getElementById('login-submit');
    const errorEl = document.getElementById('login-error');

    // No overlay in the DOM (e.g. a stripped/legacy shell) → fail open to the app
    // rather than trapping the user behind a non-functional gate.
    if (!overlay || !form || !passwordInput) {
      mountTheApp();
      return;
    }

    // Show the gate immediately while the SDK loads, so no content ever peeks.
    overlay.hidden = false;
    try { passwordInput.focus(); } catch { /* ignore */ }

    // Neutralize native submission NOW — synchronously, before the first await.
    // Until wireAuthGate installs the real handler (after the SDK import resolves),
    // an Enter keypress would otherwise GET index.html?password=<typed>, leaking
    // the shared secret into the URL/history/referrer/SW fetch. (Belt-and-suspenders
    // with the static onsubmit="return false" in index.html.)
    installSubmitGuard(form);

    let initializeApp, getAuth, signInWithEmailAndPassword, onAuthStateChanged;
    try {
      ({ initializeApp } = await import(FIREBASE_APP_URL));
      ({ getAuth, signInWithEmailAndPassword, onAuthStateChanged } =
        await import(FIREBASE_AUTH_URL));
    } catch (err) {
      // SDK failed to load (offline + uncached, or CDN down). Surface a friendly
      // message; the offline itinerary is unreachable until the gate can init,
      // but the page never crashes.
      console.warn('[auth] Firebase SDK failed to load:', err);
      if (errorEl) {
        errorEl.textContent =
          'Couldn’t reach the sign-in service. Connect to the internet once to set up offline access.';
        errorEl.hidden = false;
      }
      if (submitBtn) submitBtn.disabled = true;
      return;
    }

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    // Build the photo service ONCE, lazily, from the SAME app instance (a second
    // initializeApp would throw). onAuthStateChanged fires again on sign-out/in,
    // so this is guarded against rebuilding. The firestore/storage SDKs are
    // dynamically imported here (browser-only) — never at module top level —
    // keeping `node --test` network-free. This task owns the FIRST Firestore
    // init → it MUST use initializeFirestore(...persistentLocalCache) so the
    // later gallery task gets offline cache (a plain getFirestore would make the
    // retrofit throw "already initialized").
    const ensurePhotoService = async () => {
      if (photoService) return;
      try {
        const fs = await import(FIREBASE_FIRESTORE_URL);
        const st = await import(FIREBASE_STORAGE_URL);
        let db;
        try {
          // persistentLocalCache with no tabManager defaults to single-tab
          // persistence (the right choice for an installed PWA). This is the
          // FIRST + only Firestore init, so persistence is enabled here for the
          // later gallery task — a plain getFirestore would make that retrofit
          // throw "already initialized".
          db = fs.initializeFirestore(app, {
            localCache: fs.persistentLocalCache(/* default single-tab */),
          });
        } catch (e) {
          // Already initialized (defensive — shouldn't happen since we own first
          // init) → fall back to the existing instance.
          console.warn('[photos] initializeFirestore fell back to getFirestore:', e);
          db = fs.getFirestore(app);
        }
        const storage = st.getStorage(app);
        photoService = {
          db,
          storage,
          fb: {
            collection: fs.collection,
            doc: fs.doc,
            setDoc: fs.setDoc,
            getDocs: fs.getDocs,
            query: fs.query,
            where: fs.where,
            onSnapshot: fs.onSnapshot,
            serverTimestamp: fs.serverTimestamp,
            ref: st.ref,
            uploadBytesResumable: st.uploadBytesResumable,
            getDownloadURL: st.getDownloadURL,
          },
          // Live read seam for the reminisce gallery: subscribe to all `photos`
          // docs for an ISO date. Returns the unsubscribe fn. Offline reads come
          // from persistentLocalCache (set at this same — first — Firestore init).
          subscribePhotos(iso, cb) {
            return fs.onSnapshot(
              fs.query(fs.collection(db, 'photos'), fs.where('date', '==', iso)),
              (snap) => cb(snap.docs.map((d) => d.data())),
              (err) => console.warn('[reminisce] onSnapshot error:', err),
            );
          },
        };
      } catch (err) {
        // Firestore/Storage SDK failed to load (offline + uncached). The auth gate
        // still works; the Add-photos row just stays disabled (no handler).
        console.warn('[photos] Firebase Firestore/Storage SDK failed to load:', err);
        photoService = null;
      }
    };

    wireAuthGate({
      onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb),
      signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
      overlay, form, passwordInput, submitBtn, errorEl,
      // Build the photo service before mounting so the ☰ "Add photos" row is wired
      // on first mount. ensurePhotoService is idempotent (guarded on photoService).
      onAuthed: async () => { await ensurePhotoService(); mountTheApp(); },
      onSignedOut: teardownTheApp,
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
