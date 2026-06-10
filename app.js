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

// ---------------------------------------------------------------------------
// Inline-SVG helpers (nav-bar icons). SVG elements MUST be created in the SVG
// namespace via createElementNS — a plain createElement('svg') yields an inert
// HTML-namespaced element that never renders. The class is set via
// setAttribute('class', …) because an SVG element's `.className` is a read-only
// SVGAnimatedString, not a writable string. Icons use stroke:currentColor /
// fill:none so they inherit --brand-mid from the button.
// ---------------------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG-namespaced element and apply a flat attribute map. */
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value != null) node.setAttribute(name, String(value));
    }
  }
  return node;
}

/**
 * Build a stroke-style `<svg>` icon root on the shared 24×24 viewBox. All icons
 * are fill:none + stroke:currentColor (inherit --brand-mid from the button),
 * round caps, decorative (aria-hidden / not focusable). The caller passes only
 * what varies (class, pixel size, stroke-width, optional stroke-linejoin) and
 * appends the geometry children.
 */
function iconSvg({ className, size, strokeWidth, linejoin }) {
  return svgEl('svg', {
    class: className,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': linejoin,
    'aria-hidden': 'true',
    focusable: 'false',
  });
}

/**
 * Three evenly-spaced horizontal lines, mathematically centered in a 24×24
 * viewBox (lines at y = 7 / 12 / 17, x from 4 → 20). Replaces the Unicode ☰
 * glyph so the hamburger renders identically across iOS/Android.
 */
function buildHamburgerIcon() {
  const svg = iconSvg({ className: 'nav-icon', size: 22, strokeWidth: 2 });
  for (const y of [7, 12, 17]) {
    svg.appendChild(svgEl('line', { x1: 4, y1: y, x2: 20, y2: y }));
  }
  return svg;
}

/** Small leading icon for the menu "Home" row — a simple house outline. */
function menuHomeIcon() {
  const svg = iconSvg({ className: 'nav-menu-icon', size: 18, strokeWidth: 1.8, linejoin: 'round' });
  svg.appendChild(svgEl('path', { d: 'M4 11.5 12 4l8 7.5' }));
  svg.appendChild(svgEl('path', { d: 'M6 10v9h12v-9' }));
  return svg;
}

/** Small leading icon for the menu "Add photos" row — a photo/landscape frame. */
function menuPhotoIcon() {
  const svg = iconSvg({ className: 'nav-menu-icon', size: 18, strokeWidth: 1.8, linejoin: 'round' });
  svg.appendChild(svgEl('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }));
  svg.appendChild(svgEl('circle', { cx: 8.5, cy: 10, r: 1.5 }));
  svg.appendChild(svgEl('path', { d: 'M5 17l4.5-4.5L13 16l3-3 3 3' }));
  return svg;
}

/**
 * Build a `.nav-menu-item` button with a leading icon + a text label span.
 * Keeps the label in its own `.nav-menu-label` span so `textContent` still
 * reads cleanly as the label (the SVG contributes no text).
 */
function buildMenuItem(text, icon) {
  const btn = el('button', 'nav-menu-item');
  btn.type = 'button';
  btn.setAttribute('role', 'menuitem');
  if (icon) btn.appendChild(icon);
  btn.appendChild(el('span', 'nav-menu-label', text));
  return btn;
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

/**
 * Rewrite a `https://maps.google.com/?q=<place>` place URL into a Google Maps
 * directions URL ("Your location → the place"). Returns null if the URL is
 * unsafe, has no parseable `q` param, or is relative (relative URLs throw in
 * `new URL` without a base). No `travelmode` param — Google remembers the
 * user's last-used mode.
 *
 * `searchParams.get` decodes the value, so `encodeURIComponent` re-encodes it
 * cleanly — no double-encoding (round-trips an apostrophe in `Apollon's Gold`
 * and a literal `%` in `% Arabica`).
 * @param {unknown} mapUrl
 * @returns {string | null}
 */
export function toDirectionsUrl(mapUrl) {
  const safe = safeUrl(mapUrl);
  if (!safe) return null;
  let q;
  try {
    q = new URL(safe).searchParams.get('q');
  } catch {
    return null;
  }
  if (!q) return null;
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q);
}

/** Build the 📍 "Directions in Google Maps" link, rewriting the place URL to a directions URL when possible (falling back to the raw URL). */
function directionsLink(mapUrl) {
  return mapLink(toDirectionsUrl(mapUrl) ?? mapUrl, 'Directions in Google Maps');
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

  const link = directionsLink(item.mapUrl);
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

      const recLink = directionsLink(rec?.mapUrl);
      if (recLink) card.appendChild(recLink);

      const placeLink = mapLink(rec?.mapUrl, 'Open place in Google Maps');
      if (placeLink) {
        placeLink.classList.add('map-link-place');
        card.appendChild(placeLink);
      }

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
  const link = directionsLink(lodging.mapUrl);
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

// Sanity ceiling on how many photos a day's gallery / lightbox materializes. This
// is NOT a UX cap anymore — the gallery is a 75vh internally-scrollable mosaic
// that shows EVERY photo of the day (driven by content-visibility + lazy images),
// so the true total reaches the seam count and the lightbox. This bound only
// guards against a pathological doc set blowing up the DOM; at trip scale (worst
// case ~200 photos/day) it is never hit.
const REMINISCE_GALLERY_MAX = 1000;

// Defense-in-depth: uploaded photo URLs (the app's only user-generated render
// path) must point at our Firebase Storage bucket. Single literal — single-bucket
// app, so a configurable allowlist is YAGNI. NOTE: if a CDN is ever put in front
// of the bucket, widen this to include that CDN's origin.
const STORAGE_ORIGIN = 'https://firebasestorage.googleapis.com';

/**
 * True iff `safe` (a safeUrl-normalized string) is an absolute URL on the
 * Firebase Storage origin. Applied ONLY to uploaded docs — authored/relative
 * content is unaffected.
 *
 * @param {string} safe a safeUrl()-normalized URL
 * @returns {boolean}
 */
export function isAllowedUploadOrigin(safe) {
  try {
    // Uploaded URLs are always ABSOLUTE https from getDownloadURL.
    // Absolute URLs parse with no base; a relative URL throws here → rejected
    // (correct: an uploaded doc should never carry a relative path). Do NOT pass
    // location.href as a base — that would resolve a foreign relative path against
    // our own origin and is irrelevant since uploads are absolute (also Node-safe:
    // `location` is undefined under `node --test`).
    return new URL(safe).origin === STORAGE_ORIGIN;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Live reminisce gallery (reminisce-gallery-live)
//
// The reminisce view shows travelers' UPLOADED photos for the day only (Firestore
// `photos` docs, written by photo-upload-flow), LIVE via onSnapshot. Authored/stock
// `day.photos` are deliberately EXCLUDED from the gallery — they still drive the
// anticipation/plan hero slideshow, but a past day reminisces only over the
// travelers' own captures. The Firebase read layer is injected through a
// module-level seam so `node --test` stays network-free; with the seam absent the
// gallery renders the empty-state (no authored photos are injected).
// ---------------------------------------------------------------------------

/**
 * Injected `subscribePhotos(iso, cb)` seam. The bootstrap (boot()) wires this to
 * the live Firestore listener via the photoService; tests inject a stub. When it
 * is null (every existing test, and any non-Firebase host) renderDay's reminisce
 * branch renders the empty-state (the gallery is uploads-only; nothing is shown
 * until a live snapshot arrives).
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
 * Attach orientation-corrected dims to `obj`, but ONLY when both are finite —
 * both-or-neither. A half-present or absent pair leaves `obj` untouched (no
 * `width`/`height` keys), so a dim-less photo renders a 1×1 tile. Mutates and
 * returns `obj`. The single source of truth for the dims-passthrough rule shared
 * by mergeGalleryPhotos, the worker dispatcher, and the upload-doc writer.
 * @template T
 * @param {T} obj
 * @param {number} [width]
 * @param {number} [height]
 * @returns {T}
 */
function withDims(obj, width, height) {
  if (Number.isFinite(width) && Number.isFinite(height)) {
    obj.width = width;
    obj.height = height;
  }
  return obj;
}

/**
 * Merge authored + uploaded photos for a day's reminisce gallery.
 *
 * Order: authored photos FIRST (in authored order), then uploaded photos sorted
 * by `takenAt` ascending (the sortable capture-time string photo-upload-flow
 * writes). The whole list is bounded only by the REMINISCE_GALLERY_MAX sanity
 * ceiling (~1000) — there is no UX cap; every photo of the day is returned.
 *
 * Dedup key: the resolved photo `url`. An authored photo and an uploaded doc that
 * point at the same URL collapse to one (authored wins, since it is emitted
 * first). Two uploaded docs with the same download URL (re-runs) also collapse.
 * URL is the natural identity here — each Storage upload gets a unique download
 * URL, and authored photos carry their own stable URLs.
 *
 * Each kept photo is normalized to `{ url, alt, width?, height? }` (what the
 * gallery + lightbox consume). Uploaded docs get `alt: "Photo by <uploader>"` and
 * pass through their orientation-corrected `width`/`height` (finite numbers only)
 * so the mosaic gallery can size each tile before the image downloads; authored
 * photos and dim-less uploads omit them (→ 1×1 tile). URLs are validated with
 * safeUrl(); anything safeUrl rejects (bad scheme, missing) is dropped — uploaded
 * photos are user data.
 *
 * @param {Array<{url?: string, alt?: string}>} authored authored day.photos
 * @param {Array<{url?: string, uploader?: string, takenAt?: string, width?: number, height?: number}>} uploaded Firestore photo docs
 * @returns {Array<{url: string, alt: string, width?: number, height?: number}>}
 */
export function mergeGalleryPhotos(authored, uploaded) {
  const seen = new Set();
  const out = [];

  const pushSafe = (rawUrl, alt, width, height, requireStorageOrigin = false) => {
    const url = safeUrl(rawUrl);
    if (!url || seen.has(url)) return;
    // Uploaded docs (user-generated) must resolve to the Storage origin;
    // authored/relative content is repo-controlled and passes unrestricted.
    if (requireStorageOrigin && !isAllowedUploadOrigin(url)) return;
    seen.add(url);
    out.push(withDims({ url, alt: alt ? String(alt) : '' }, width, height));
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
    pushSafe(d?.url, `Photo by ${who}`, d?.width, d?.height, true);
  });

  return out.slice(0, REMINISCE_GALLERY_MAX);
}

// === Seigaiha mosaic tile-span assignment (redesign-gallery-mosaic) =========
// The gallery is a 3-column CSS grid with `grid-auto-flow: row dense`. The
// SQUARE is the default tile; two larger shapes punctuate the calm grid:
//   - 'gallery-tile-feature' — a 2×2 "crest", chosen by a hash of the photo's
//     immutable Storage URL (NOT its dims/index) so a photo's size never
//     reshuffles when later uploads re-sort the gallery.
//   - 'gallery-tile-pano'    — a full-row 3×1 "panorama break", for genuinely
//     wide shots only (recorded w/h ≥ 1.7).
//
// `grid-auto-flow: dense` can only backfill a gap a big tile opens if a tile of
// the matching size exists LATER in the stream — which is why squares-as-default
// is load-bearing, and why a per-tile classifier CANNOT be hole-free (it can't
// see how many squares follow). The assignment is therefore LIST-BASED with a
// backward credit pass: a crest/pano survives only if enough plain squares
// follow it to backfill the cells it displaces; otherwise it's demoted to a
// square. The exact-placement property test in app.test.js is the AUTHORITY for
// the cost constants below — never ship with that test red.

/** Grid column count. The credit math (CREST_COST/PANO_COST) and the
 *  `.reminisce-gallery` CSS (`repeat(3, 1fr)`) both derive from this — keep them
 *  in lockstep (a test reads index.html for `repeat(3, 1fr)`). */
export const GALLERY_COLS = 3;

/** Plain squares that must follow a 2×2 crest for `dense` to backfill the cells
 *  it displaces. Validated by the exact-placement property test, not by argument. */
const CREST_COST = 3;
/** Plain squares that must follow a 3×1 panorama. Validated by the property test. */
const PANO_COST = 2;

/** Aspect threshold (w/h) at or above which a photo earns a full-row panorama. */
const PANO_ASPECT = 1.7;

/**
 * 32-bit unsigned FNV-1a hash over a string. Tiny, deterministic, dependency-free.
 * Used to pick which photos become crests from their stable Storage URL. Pure.
 * @param {string} str
 * @returns {number} 32-bit unsigned hash
 */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619, kept in 32-bit unsigned range via Math.imul + >>> 0.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A URL is a "crest" candidate iff its FNV-1a hash mod 7 equals 3 — picks ~1-in-7
 * photos as feature tiles, forever, independent of their position in the gallery.
 * Pure. Exported so tests/fixtures DERIVE which URLs are crests, never hard-code.
 * @param {string} url
 * @returns {boolean}
 */
export function isFeatureUrl(url) {
  return fnv1a(url) % 7 === 3;
}

/**
 * Assign one grid-span class per photo for the Seigaiha mosaic. LIST-BASED (not
 * per-tile) so hole-freeness — which depends on how many squares follow a big
 * tile — is provable. Returns a parallel array of '' | 'gallery-tile-feature' |
 * 'gallery-tile-pano' (same length/order as `photos`).
 *
 * Per-photo flags: `pano` requires finite dims AND w/h ≥ PANO_ASPECT; `crest` is
 * `!pano && isFeatureUrl(url)` — PANORAMA OUTRANKS CREST when both could match.
 * Dim-less photos (bail-path originals) are never panos → plain square unless the
 * hash promotes them to a crest.
 *
 * Backward credit pass (end → start): plain squares add credit; a crest is kept
 * only if `credit ≥ CREST_COST` (then spends it), a pano only if `credit ≥
 * PANO_COST` — otherwise it's demoted to a square (and itself adds credit). This
 * guarantees `dense` always has enough following squares to backfill.
 *
 * NOTE (tail crest↔square flip): a crest/pano near the array TAIL can flip to a
 * square (or back) across live rebuilds as later uploads change the trailing
 * credit. BOTH states are hole-safe by construction — the flip is invisible near
 * the scroll fold and never opens a gap. Pure: no DOM, no Date, no randomness.
 *
 * @param {Array<{url?: string, width?: number, height?: number}>} photos
 * @returns {string[]} parallel class array ('' for a plain square)
 */
export function assignTileSpans(photos) {
  if (!Array.isArray(photos)) return [];
  const n = photos.length;
  // Pass 1: intrinsic flags (kind), independent of position.
  // kind: 0 = square, 1 = crest, 2 = pano.
  const kind = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = photos[i] || {};
    const w = p.width;
    const h = p.height;
    const pano = Number.isFinite(w) && Number.isFinite(h) && h > 0 && w / h >= PANO_ASPECT;
    if (pano) {
      kind[i] = 2;
    } else if (isFeatureUrl(p.url)) {
      kind[i] = 1; // crest (panorama already outranked it above)
    } else {
      kind[i] = 0;
    }
  }
  // Pass 2: backward credit demotion → hole-free placement.
  const out = new Array(n);
  let credit = 0;
  for (let i = n - 1; i >= 0; i--) {
    const k = kind[i];
    if (k === 2) {
      if (credit >= PANO_COST) {
        out[i] = 'gallery-tile-pano';
        credit -= PANO_COST;
      } else {
        out[i] = '';
        credit += 1; // demoted to a square — itself becomes backfill
      }
    } else if (k === 1) {
      if (credit >= CREST_COST) {
        out[i] = 'gallery-tile-feature';
        credit -= CREST_COST;
      } else {
        out[i] = '';
        credit += 1;
      }
    } else {
      out[i] = '';
      credit += 1;
    }
  }
  return out;
}

/**
 * Mosaic photo grid of focusable buttons. `onOpen(index)` fires on activation.
 * Each tile's span (square / 2×2 crest / 3×1 panorama) comes from a single
 * `assignTileSpans(photos)` pass so the layout is stable BEFORE any image
 * downloads (no shift while scrolling) and provably hole-free. Spans are indexed
 * by `i` so the `safeUrl` skip below does NOT misalign them. Images request CORS
 * so Firebase Storage responses are non-opaque (unpadded cache accounting).
 * XSS-safe: URLs pass through safeUrl(); text via textContent.
 */
function buildReminisceGallery(photos, onOpen) {
  const gallery = el('section', 'reminisce-gallery');
  gallery.setAttribute('aria-label', 'Photos from this day');
  const spans = assignTileSpans(photos);
  photos.forEach((p, i) => {
    const src = safeUrl(p?.url);
    if (!src) return;
    const spanClass = spans[i];
    const btn = el('button', 'reminisce-photo' + (spanClass ? ' ' + spanClass : ''));
    btn.type = 'button';
    const img = el('img');
    img.crossOrigin = 'anonymous';
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
// Shared topmost-only keyboard-trap stack. Every overlay (modal sheets via
// buildModalSheet, the lightbox via buildLightbox) pushes its onKey on open and
// splices it out on close; only the handler at the top of the stack acts (others
// return immediately). Registration order matches visual z-order in every
// reachable stack (batch-date prompt over the progress sheet; an error modal over
// an open lightbox), so the topmost handler is the visually-topmost overlay — and
// Esc peels exactly one layer. Avoids two stacked overlays fighting over Tab/Esc.
const trapStack = [];

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
  // Slide <img> refs (sparse — a slide with a rejected URL has no img), kept so
  // setCounter can force-load the current photo's immediate neighbors.
  const slideImgs = [];
  photos.forEach((p, idx) => {
    const slide = el('div', 'lightbox-slide');
    const src = safeUrl(p?.url);
    if (src) {
      const img = el('img');
      img.crossOrigin = 'anonymous';
      // Lazy by default so opening the viewer does NOT force-download every photo
      // of the day; the neighbor force-load in setCounter pulls the few that
      // matter (current ± 1) eagerly to kill the cold-swipe blank flash.
      img.loading = 'lazy';
      img.src = src;
      img.alt = p?.alt ? String(p.alt) : '';
      img.decoding = 'async';
      slide.appendChild(img);
      slideImgs[idx] = img;
    }
    track.appendChild(slide);
  });
  overlay.appendChild(track);

  let current = 0;
  let lastFocused = null;
  let rafPending = false;

  const reduceMotion = prefersReducedMotion();

  // Force-load the current slide + its immediate neighbors (i-1, i, i+1): flip
  // them eager and kick a throw-safe decode. Bounded to neighbors so a big day
  // never eagerly fetches the whole set.
  function preloadNeighbors(i) {
    for (let j = i - 1; j <= i + 1; j += 1) {
      const img = slideImgs[j];
      if (!img) continue;
      img.loading = 'eager';
      // decode() is best-effort: the sync try/catch guards a throwing call, and
      // .catch swallows the async rejection (a not-yet-loaded/aborted img) so it
      // never surfaces as an unhandledrejection.
      try { img.decode?.()?.catch(() => {}); } catch { /* decode is best-effort */ }
    }
  }

  function setCounter(i) {
    current = i;
    counter.textContent = `${i + 1} / ${photos.length}`;
    overlay.setAttribute(
      'aria-label',
      `Photo ${i + 1} of ${photos.length}${dayLabel ? ', ' + dayLabel : ''}`,
    );
    preloadNeighbors(i);
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
    // Splice by indexOf (paired with the open() push) — may not be topmost if
    // layers closed out of order. Runs only past the early !isOpen return above,
    // so push/splice stay perfectly balanced.
    const ti = trapStack.indexOf(onKey);
    if (ti !== -1) trapStack.splice(ti, 1);
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
    if (trapStack[trapStack.length - 1] !== onKey) return; // only the topmost overlay acts
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
      trapStack.push(onKey); // topmost-only trap; spliced out in teardown()
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
    // The reminisce gallery is UPLOADS-ONLY: authored/stock `day.photos` are
    // excluded here (they still drive the non-reminisce hero). There is no
    // synchronous source — the gallery is empty until a live snapshot arrives, so
    // `authoredPhotos` is bound to [] and fed to mergeGalleryPhotos([], docs).
    const authoredPhotos = [];
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
    frame.appendChild(seam);
    view.appendChild(frame);

    // A stable host the gallery / empty-note / lightbox swap into. (Keeping a host
    // node lets a snapshot re-render the grid without touching surrounding chrome.)
    const galleryHost = el('div', 'reminisce-gallery-host');
    view.appendChild(galleryHost);

    // `current` is the uploaded photo list currently shown. Empty at first (no
    // authored photos are injected); each snapshot recomputes it via
    // mergeGalleryPhotos([], docs).
    let current = [];
    let lightbox = null;
    let loadingNote = null;

    // (Re)build the grid + lightbox over `photos`. Tears down any prior lightbox
    // first (the lightbox captures its array at build time, so a stale one would
    // open the wrong set). Empty list → the graceful empty-state note.
    const renderGallery = (photos) => {
      if (lightbox) { lightbox.destroy(); lightbox = null; }
      // Preserve the scroll position across a live-snapshot rebuild — the host is
      // a fixed 75vh scroll window, so wiping it would otherwise teleport a
      // mid-browse user back to the top on every snapshot.
      const prevScroll = galleryHost.scrollTop || 0;
      galleryHost.textContent = '';
      if (photos.length) {
        // The lightbox mounts itself on <body> when opened (see buildLightbox); we
        // only wire the gallery to it and fold its teardown into reminisceStop.
        lightbox = buildLightbox(photos, day.title ?? '', { onClose: applyPending });
        galleryHost.appendChild(buildReminisceGallery(photos, (i) => lightbox.open(i)));
        // Restore after the new grid is appended (only meaningful when there is
        // content to scroll). No-op when prevScroll is 0 or the host isn't scrollable.
        if (prevScroll) galleryHost.scrollTop = prevScroll;
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

    // The gallery is uploads-only, so it starts empty on EVERY day. When live, the
    // first snapshot is still pending → show a small on-theme loading affordance
    // instead of the empty-note (the snapshot may add photos), and let the seam
    // read a neutral "Loading…" rather than the contradictory "No photos yet".
    // Set loadingNote BEFORE the initial render so renderGallery's empty branch is
    // suppressed (it skips the empty-note while a loadingNote is present).
    if (live) {
      loadingNote = el('p', 'reminisce-loading-note', 'Gathering your photos…');
      seam.textContent = 'Loading…';
    } else {
      // Seam absent: no live source → the gallery is empty for good. Show the
      // empty-state count immediately.
      setSeam(0);
    }

    // Initial render. When live this shows the loading note; when the seam is
    // absent it shows the empty-state (no authored photos are injected).
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
          setSeam(current.length); // clear "Loading…" → real count (empty-state)
          renderGallery(current); // fall back to whatever we have (empty)
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
  const trigger = el('button', 'day-nav-btn day-nav-hamburger');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Menu');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.appendChild(buildHamburgerIcon());

  const menu = el('div', 'nav-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Menu');

  const homeRow = buildMenuItem('Home', menuHomeIcon());

  const addRow = buildMenuItem('Add photos', menuPhotoIcon());
  addRow.disabled = !addEnabled;

  // Hairline divider between Home and Add photos. role="separator" is exposed
  // but it is NOT in focusableItems() (which is keyed by identity), so the
  // focus trap is unaffected.
  const divider = el('div', 'nav-menu-divider');
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'horizontal');

  menu.appendChild(homeRow);
  menu.appendChild(divider);
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
 * `DateTime` (0x0132) only when the sub-IFD is present-and-intact but genuinely
 * lacks 0x9003. When the 128 KB header slice TRUNCATES the sub-IFD (or the IFD0
 * entry table that could hide the 0x8769 pointer), returns null instead — 0x0132
 * is a file-EDIT timestamp, confidently wrong for a capture date, so the caller
 * degrades to the lastModified-day bucket rather than recording it. Bounds-checked
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

  // Dispatch on container magic, then locate the inner TIFF block's start offset.
  // All three containers (JPEG APP1 / PNG eXIf / ISO-BMFF HEIC Exif item) wrap the
  // SAME TIFF block; once located, `readTiffDateTime` does the shared walk.
  let tiffStart = -1;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG (SOI FFD8).
    tiffStart = locateTiffInJpeg(bytes, len);
  } else if (
    len >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    // PNG (89 50 4E 47 0D 0A 1A 0A).
    tiffStart = locateTiffInPng(bytes, len);
  } else if (
    len >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && // "ftyp"
    isHeicFamilyBrand(bytes, 8)
  ) {
    // ISO-BMFF / HEIC-family.
    tiffStart = locateTiffInIsoBmff(bytes, len);
  } else {
    return null;
  }

  if (tiffStart < 0 || tiffStart + 8 > len) return null;
  return readTiffDateTime(bytes, tiffStart, len);
}

/**
 * True iff a 4-byte brand at offset `off` is a HEIC-family brand we treat as
 * EXIF-bearing ISO-BMFF: heic/heix/hevc/hevx (image/heic) + mif1/msf1
 * (image/heif). AVIF is deliberately excluded. Bounds-safe, pure.
 * @param {Uint8Array} bytes
 * @param {number} off
 * @returns {boolean}
 */
function isHeicFamilyBrand(bytes, off) {
  if (off + 4 > bytes.length) return false;
  const c0 = bytes[off], c1 = bytes[off + 1], c2 = bytes[off + 2], c3 = bytes[off + 3];
  const is = (a, b, c, d) => c0 === a && c1 === b && c2 === c && c3 === d;
  return (
    is(0x68, 0x65, 0x69, 0x63) || // heic
    is(0x68, 0x65, 0x69, 0x78) || // heix
    is(0x68, 0x65, 0x76, 0x63) || // hevc
    is(0x68, 0x65, 0x76, 0x78) || // hevx
    is(0x6d, 0x69, 0x66, 0x31) || // mif1
    is(0x6d, 0x73, 0x66, 0x31)    // msf1
  );
}

/**
 * True iff bytes at `off` form a valid TIFF byte-order marker + magic:
 * "II" (49 49) + 2A 00, or "MM" (4D 4D) + 00 2A. Bounds-checked.
 * @param {Uint8Array} bytes
 * @param {number} off
 * @param {number} len
 * @returns {boolean}
 */
function isTiffMagic(bytes, off, len) {
  if (off + 4 > len) return false;
  if (bytes[off] === 0x49 && bytes[off + 1] === 0x49) {
    return bytes[off + 2] === 0x2a && bytes[off + 3] === 0x00; // II + 2A 00
  }
  if (bytes[off] === 0x4d && bytes[off + 1] === 0x4d) {
    return bytes[off + 2] === 0x00 && bytes[off + 3] === 0x2a; // MM + 00 2A
  }
  return false;
}

/**
 * Locate the TIFF block inside a JPEG: scan APP segments for APP1 (FFE1) that
 * begins with "Exif\0\0". Returns the byte offset of the TIFF header, or -1.
 * @param {Uint8Array} bytes
 * @param {number} len
 * @returns {number}
 */
function locateTiffInJpeg(bytes, len) {
  let p = 2;
  while (p + 4 <= len) {
    if (bytes[p] !== 0xff) { p += 1; continue; } // resync on stray padding
    const marker = bytes[p + 1];
    // Standalone markers (no length): RST0–7, SOI, EOI, TEM.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const segLen = (bytes[p + 2] << 8) | bytes[p + 3];
    if (segLen < 2) return -1; // malformed length
    const segStart = p + 4;
    if (marker === 0xe1) {
      // APP1 — check for the "Exif\0\0" signature.
      if (segStart + 6 <= len &&
          bytes[segStart] === 0x45 && bytes[segStart + 1] === 0x78 &&
          bytes[segStart + 2] === 0x69 && bytes[segStart + 3] === 0x66 &&
          bytes[segStart + 4] === 0x00 && bytes[segStart + 5] === 0x00) {
        return segStart + 6;
      }
    }
    if (marker === 0xda) break; // SOS — image data starts; no EXIF beyond.
    p += 2 + segLen;
  }
  return -1;
}

/**
 * Locate the TIFF block inside a PNG: walk chunks for an `eXIf` chunk whose
 * payload IS the raw TIFF block (no "Exif\0\0" prefix). Stops at IEND. Pure,
 * bounds-checked, never throws. Returns the TIFF offset, or -1.
 * @param {Uint8Array} bytes
 * @param {number} len
 * @returns {number}
 */
function locateTiffInPng(bytes, len) {
  let p = 8; // after the 8-byte signature
  while (p + 8 <= len) {
    const chunkLen = (
      (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]
    ) >>> 0;
    const t0 = bytes[p + 4], t1 = bytes[p + 5], t2 = bytes[p + 6], t3 = bytes[p + 7];
    const payloadOff = p + 8;
    // IEND — stop.
    if (t0 === 0x49 && t1 === 0x45 && t2 === 0x4e && t3 === 0x44) return -1;
    if (payloadOff + chunkLen > len) return -1; // declared length exceeds the slice
    // eXIf.
    if (t0 === 0x65 && t1 === 0x58 && t2 === 0x49 && t3 === 0x66) {
      if (chunkLen < 8) return -1; // too small for a TIFF header
      if (!isTiffMagic(bytes, payloadOff, len)) return -1;
      return payloadOff;
    }
    // Advance: payload + 4-byte CRC (CRC not validated).
    p = payloadOff + chunkLen + 4;
  }
  return -1;
}

/**
 * Locate the TIFF block inside an ISO-BMFF / HEIC file by walking the box tree to
 * the `Exif` item's bytes. Handles the `meta` FullBox (+4 version/flags skip),
 * iinf/infe item-type lookup, and iloc extent resolution (v0/v1/v2,
 * construction_method 0 + single extent only). Pure, bounds-checked, never throws.
 * Returns the TIFF offset, or -1.
 * @param {Uint8Array} bytes
 * @param {number} len
 * @returns {number}
 */
function locateTiffInIsoBmff(bytes, len) {
  // Read an n-byte big-endian unsigned int at `off`. Returns Infinity if it would
  // exceed the slice OR if high bytes beyond ~6 significant bytes are set (so a
  // value that overflows safe-integer / 32-bit space is flagged out-of-bounds
  // rather than silently truncated).
  const uIntBe = (off, n) => {
    if (off + n > len) return Infinity;
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      const b = bytes[off + i];
      // If we've already accumulated >~6 significant bytes and more nonzero bytes
      // arrive, treat as overflow.
      if (i >= 6 && b !== 0) return Infinity;
      v = v * 256 + b;
    }
    return v;
  };

  // Iterate the boxes within [start, end), calling cb(type, contentStart, boxEnd).
  // cb returning truthy stops iteration. Returns nothing; callers read out via cb.
  const eachBox = (start, end, cb) => {
    let p = start;
    while (p + 8 <= end) {
      let size = uIntBe(p, 4);
      if (!Number.isFinite(size)) return;
      const type = (
        String.fromCharCode(bytes[p + 4]) + String.fromCharCode(bytes[p + 5]) +
        String.fromCharCode(bytes[p + 6]) + String.fromCharCode(bytes[p + 7])
      );
      let headerLen = 8;
      if (size === 1) {
        // 64-bit largesize follows the type.
        const large = uIntBe(p + 8, 8);
        if (!Number.isFinite(large)) return;
        size = large;
        headerLen = 16;
      } else if (size === 0) {
        // Box runs to the end of the slice.
        size = end - p;
      }
      if (size < headerLen) return;
      const boxEnd = p + size;
      if (boxEnd > end) return;
      const contentStart = p + headerLen;
      if (cb(type, contentStart, boxEnd)) return;
      p = boxEnd;
    }
  };

  // Top level: REQUIRE the first box to be ftyp; then locate meta.
  let metaContentStart = -1;
  let metaContentEnd = -1;
  let firstSeen = false;
  let firstIsFtyp = false;
  eachBox(0, len, (type, contentStart, boxEnd) => {
    if (!firstSeen) {
      firstSeen = true;
      firstIsFtyp = type === 'ftyp';
      if (!firstIsFtyp) return true; // stop — invalid
    }
    if (type === 'meta') {
      metaContentStart = contentStart;
      metaContentEnd = boxEnd;
      return true; // found meta
    }
    return false;
  });
  if (!firstIsFtyp || metaContentStart < 0) return -1;

  // `meta` is a FullBox: skip 4 bytes (1 version + 3 flags) before its children.
  const metaChildrenStart = metaContentStart + 4;
  if (metaChildrenStart > metaContentEnd) return -1;

  // Within meta children: find iinf (→ Exif item_ID) and iloc (→ extent offset).
  let exifItemId = -1;
  let ilocStart = -1;
  let ilocEnd = -1;
  eachBox(metaChildrenStart, metaContentEnd, (type, contentStart, boxEnd) => {
    if (type === 'iinf') {
      // iinf FullBox: version(1) flags(3) [contentStart points past the box header
      // but the FullBox version/flags are part of the content]. contentStart here
      // is just past the 8-byte box header.
      const version = bytes[contentStart];
      let cur = contentStart + 4; // skip version + flags
      // entry_count: u16 for v0, u32 for v1+.
      let entryCount;
      if (version === 0) {
        entryCount = uIntBe(cur, 2); cur += 2;
      } else {
        entryCount = uIntBe(cur, 4); cur += 4;
      }
      if (!Number.isFinite(entryCount)) return false;
      // Scan infe boxes.
      eachBox(cur, boxEnd, (itype, ics) => {
        if (itype !== 'infe') return false;
        const iv = bytes[ics]; // infe FullBox version
        let itemId = -1;
        let itemTypeOff = -1;
        if (iv === 2) {
          itemId = uIntBe(ics + 4, 2);
          itemTypeOff = ics + 8;
        } else if (iv === 3) {
          itemId = uIntBe(ics + 4, 4);
          itemTypeOff = ics + 10;
        } else {
          return false; // v0/v1 carry no item_type — skip
        }
        if (!Number.isFinite(itemId)) return false;
        if (itemTypeOff + 4 > len) return false;
        // item_type "Exif" (45 78 69 66).
        if (bytes[itemTypeOff] === 0x45 && bytes[itemTypeOff + 1] === 0x78 &&
            bytes[itemTypeOff + 2] === 0x69 && bytes[itemTypeOff + 3] === 0x66) {
          exifItemId = itemId;
          return true; // found it
        }
        return false;
      });
      return false;
    }
    if (type === 'iloc') {
      ilocStart = contentStart;
      ilocEnd = boxEnd;
      return false;
    }
    return false;
  });

  if (exifItemId < 0 || ilocStart < 0) return -1;

  // Parse iloc to resolve the Exif item's single, file-relative extent.
  const ilocVersion = bytes[ilocStart];
  let cur = ilocStart + 4; // skip version + flags
  // Nibble-packed sizes.
  const sizeByte = bytes[cur]; cur += 1;
  const offsetSize = (sizeByte >> 4) & 0x0f;
  const lengthSize = sizeByte & 0x0f;
  const baseIdxByte = bytes[cur]; cur += 1;
  const baseOffsetSize = (baseIdxByte >> 4) & 0x0f;
  const indexSize = baseIdxByte & 0x0f;
  // item_count: u16 (v0/v1) or u32 (v2).
  let itemCount;
  if (ilocVersion === 2) { itemCount = uIntBe(cur, 4); cur += 4; }
  else { itemCount = uIntBe(cur, 2); cur += 2; }
  if (!Number.isFinite(itemCount)) return -1;

  for (let i = 0; i < itemCount; i += 1) {
    if (cur > ilocEnd) return -1;
    // item_ID.
    let itemId;
    if (ilocVersion === 2) { itemId = uIntBe(cur, 4); cur += 4; }
    else { itemId = uIntBe(cur, 2); cur += 2; }
    if (!Number.isFinite(itemId)) return -1;
    // construction_method (v1/v2): 2-byte field, low 4 bits.
    let constructionMethod = 0;
    if (ilocVersion === 1 || ilocVersion === 2) {
      const cm = uIntBe(cur, 2); cur += 2;
      if (!Number.isFinite(cm)) return -1;
      constructionMethod = cm & 0x0f;
    }
    // data_reference_index.
    cur += 2;
    // base_offset.
    let baseOffset = 0;
    if (baseOffsetSize > 0) {
      baseOffset = uIntBe(cur, baseOffsetSize); cur += baseOffsetSize;
      if (!Number.isFinite(baseOffset)) return -1;
    }
    // extent_count.
    const extentCount = uIntBe(cur, 2); cur += 2;
    if (!Number.isFinite(extentCount)) return -1;

    const isTarget = itemId === exifItemId;
    if (isTarget) {
      if (constructionMethod !== 0) return -1; // only file-relative supported
      if (extentCount !== 1) return -1;        // only single-extent supported
    }

    // Per-extent byte width consumed by the real loop below: the optional
    // extent_index (v1/v2 with index_size > 0) plus offset + length fields.
    const perExtentBytes =
      (((ilocVersion === 1 || ilocVersion === 2) && indexSize > 0) ? indexSize : 0) +
      offsetSize + lengthSize;

    if (!isTarget) {
      // NON-target item: we never read its extents — only need the cursor to land
      // on the next item. Advance ARITHMETICALLY past all extents in one step
      // instead of spinning the inner loop. (A crafted file can declare a huge
      // extent_count with zero-width offset/length; looping that burns main-thread
      // time for no purpose. Arithmetic skip is O(1).)
      cur += extentCount * perExtentBytes;
      if (cur > ilocEnd || cur > len) return -1;
      continue;
    }

    // TARGET item: run the real extent loop (extentCount is guaranteed 1 above).
    // Belt-and-suspenders cap in case the invariant ever loosens.
    if (extentCount > 4096) return -1;
    let targetTiffStart = -1;
    for (let e = 0; e < extentCount; e += 1) {
      // extent_index (v1/v2 with index_size > 0).
      if ((ilocVersion === 1 || ilocVersion === 2) && indexSize > 0) {
        cur += indexSize;
      }
      const extentOffset = uIntBe(cur, offsetSize); cur += offsetSize;
      const extentLength = uIntBe(cur, lengthSize); cur += lengthSize;
      if (e === 0) {
        if (!Number.isFinite(extentOffset) || !Number.isFinite(extentLength)) return -1;
        const targetPos = baseOffset + extentOffset;
        if (!Number.isFinite(targetPos)) return -1;
        if (targetPos + 4 > len) return -1;
        if (targetPos + extentLength > len) return -1;
        // Exif item payload: u32 exif_tiff_header_offset, then the TIFF block.
        const exifTiffHeaderOffset = uIntBe(targetPos, 4);
        if (!Number.isFinite(exifTiffHeaderOffset)) return -1;
        const ts = targetPos + 4 + exifTiffHeaderOffset;
        if (!Number.isFinite(ts) || ts + 8 > len) return -1;
        if (!isTiffMagic(bytes, ts, len)) return -1;
        targetTiffStart = ts;
      }
    }
    return targetTiffStart;
  }
  return -1;
}

// Module-local sentinel distinguishing "the slice truncated the bytes we needed"
// from "the bytes are present but the tag is genuinely absent". It only ever lives
// inside readTiffDateTime's two closures (readAscii returns it in its string
// domain; readPointer uses -1 in its number domain) and is consumed before the
// function returns — it NEVER escapes to a caller (return type stays string|null).
const EXIF_TRUNCATED = Symbol('exif-truncated');

/**
 * Shared TIFF-block walker: from the TIFF byte-order marker at `tiffStart`, read
 * IFD0 → follow the Exif sub-IFD pointer (0x8769) → read DateTimeOriginal (0x9003).
 * Falls back to IFD0's weaker DateTime (0x0132) ONLY when the sub-IFD is
 * present-and-intact but genuinely lacks 0x9003. If the slice TRUNCATES the
 * sub-IFD (or the IFD0 entry table that could hide the 0x8769 pointer), returns
 * null instead — 0x0132 is a file-edit time, wrong for a capture date. Bounds-
 * checked throughout (returns null, never throws). The JPEG path stays unchanged
 * for any non-truncated buffer.
 * @param {Uint8Array} bytes
 * @param {number} tiffStart
 * @param {number} len
 * @returns {string | null} raw EXIF datetime, e.g. "2026:06:25 23:30:00"
 */
function readTiffDateTime(bytes, tiffStart, len) {
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
    if (ifdOff + 2 > len) return EXIF_TRUNCATED; // IFD start beyond the slice
    const count = u16(ifdOff);
    let e = ifdOff + 2;
    for (let i = 0; i < count; i += 1, e += 12) {
      if (e + 12 > len) return EXIF_TRUNCATED; // entry table cut mid-scan
      const tag = u16(e);
      if (tag !== wantTag) continue;
      const type = u16(e + 2);
      const num = u32(e + 4);
      if (type !== 2 || num === 0) return null; // ASCII only — genuine absence
      const valOff = num <= 4 ? e + 8 : tiffStart + u32(e + 8);
      if (valOff + num > len) return EXIF_TRUNCATED; // value bytes beyond the slice
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

  // Find the Exif sub-IFD pointer (tag 0x8769) in IFD0. Returns the pointer
  // offset (>0), 0 for "no such tag / empty IFD", or -1 for "entry table
  // truncated mid-scan" (the pointer could be hidden past the cut). Real returns
  // are unsigned offsets, so -1 never collides with a valid value.
  // ASYMMETRY (deliberate — pre-empting a "consistency fix"): the IFD-start guard
  // below still returns 0, not -1, because IFD0's start is already bounds-checked
  // at `if (ifd0 + 2 > len) return null` above, so this guard is unreachable for
  // our only caller and a 0 there is harmless. Two sentinel STYLES also coexist on
  // purpose: readAscii works in a string domain (Symbol EXIF_TRUNCATED), readPointer
  // in a number domain (-1) — each picks a value that can't collide with its own
  // legitimate returns. Do not unify them.
  const readPointer = (ifdOff, wantTag) => {
    if (ifdOff + 2 > len) return 0;
    const count = u16(ifdOff);
    let e = ifdOff + 2;
    for (let i = 0; i < count; i += 1, e += 12) {
      if (e + 12 > len) return -1; // entry table cut mid-scan — 0x8769 may be hidden
      if (u16(e) === wantTag) return u32(e + 8);
    }
    return 0;
  };

  const exifIfdOff = readPointer(ifd0, 0x8769);
  if (exifIfdOff === -1) return null; // IFD0 table truncated — 0x8769 may be hidden past the cut
  if (exifIfdOff) {
    const subDate = readAscii(tiffStart + exifIfdOff, 0x9003); // DateTimeOriginal
    if (subDate === EXIF_TRUNCATED) return null; // MUST precede truthiness — Symbols are truthy
    if (subDate) return subDate;
  }
  // Weaker fallback: IFD0 DateTime (0x0132) — file-modification time, not capture.
  // Only reached on GENUINE sub-IFD absence; a truncated 0x0132 read collapses to null.
  const fb = readAscii(ifd0, 0x0132);
  return fb === EXIF_TRUNCATED ? null : fb; // sentinel never escapes
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

// ---- Interrupted-run marker (minimize-upload-modal) ------------------------
//
// A per-device localStorage marker (`jt:upload-run`) that exists ONLY while an
// upload run is alive: written when a run starts (post-prepared, so a cancelled
// picker never strands one), re-stamped by a heartbeat while running, removed
// when the run ends in-page. boot() checks it ONCE per page boot: a stale
// heartbeat with done < total means the previous run died mid-flight (page
// killed under memory pressure / long background) → one-shot recovery notice.
// Resume-from-background never reboots the page, so the notice CANNOT appear
// on the resume path — the false-positive guard is structural, not tuned. A
// FRESH heartbeat means a live run owns the marker (e.g. another tab) → it is
// silently left alone.

const UPLOAD_RUN_KEY = 'jt:upload-run';

/** Heartbeat re-stamp period while a run is alive. */
const RUN_HEARTBEAT_MS = 7000;

/** A heartbeat older than this is a dead run (live runs re-stamp every ~7s). */
export const RUN_MARKER_STALE_MS = 60_000;

/**
 * Read the upload-run marker, or null. Throw-safe (private mode → null). A
 * malformed/partial marker is treated as absent AND cleared so it can never
 * wedge the boot check.
 * @returns {{ startedAt:number, total:number, done:number, beatAt:number } | null}
 */
export function readRunMarker() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(UPLOAD_RUN_KEY);
    if (typeof raw !== 'string' || raw === '') return null;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const ok = parsed && typeof parsed === 'object'
      && Number.isFinite(parsed.startedAt) && Number.isFinite(parsed.total)
      && Number.isFinite(parsed.done) && Number.isFinite(parsed.beatAt);
    if (!ok) { clearRunMarker(); return null; }
    return {
      startedAt: parsed.startedAt,
      total: parsed.total,
      done: parsed.done,
      beatAt: parsed.beatAt,
    };
  } catch {
    return null;
  }
}

/**
 * Write the upload-run marker. Throw-safe (private mode → false, no-op). All
 * four fields must be finite numbers (timestamps are epoch ms from getNow()).
 * @param {{ startedAt:number, total:number, done:number, beatAt:number }} marker
 * @returns {boolean} true if persisted
 */
export function writeRunMarker(marker) {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (!marker || typeof marker !== 'object') return false;
    const { startedAt, total, done, beatAt } = marker;
    if (![startedAt, total, done, beatAt].every(Number.isFinite)) return false;
    localStorage.setItem(UPLOAD_RUN_KEY, JSON.stringify({ startedAt, total, done, beatAt }));
    return true;
  } catch {
    return false;
  }
}

/** Remove the upload-run marker. Throw-safe (private mode → silent no-op). */
export function clearRunMarker() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(UPLOAD_RUN_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Build the live runMarker dep for wirePhotoSync: { start(total), beat(done),
 * clear() } backed by the localStorage marker + an interval heartbeat that
 * re-stamps `beatAt` while the run is alive (so a parallel boot — another tab —
 * sees a fresh heartbeat and stays quiet). Timers and the clock are injectable
 * for tests (the createWorkerDownscaler `setTimer` pattern); defaults are the
 * real setInterval/clearInterval + getNow. Every op is throw-safe via the
 * marker helpers above.
 *
 * @param {object} [opts]
 * @param {() => Date} [opts.now] clock seam (default getNow)
 * @param {number} [opts.heartbeatMs] re-stamp period (default RUN_HEARTBEAT_MS)
 * @param {(fn:Function, ms:number) => unknown} [opts.setTimer] interval-style timer
 * @param {(id:unknown) => void} [opts.clearTimer]
 * @returns {{ start:(total:number)=>void, beat:(done:number)=>void, clear:()=>void }}
 */
export function createRunMarker({ now = getNow, heartbeatMs = RUN_HEARTBEAT_MS, setTimer, clearTimer } = {}) {
  const setT = typeof setTimer === 'function' ? setTimer : (fn, ms) => setInterval(fn, ms);
  const clearT = typeof clearTimer === 'function' ? clearTimer : (id) => clearInterval(id);
  let timerId = null;
  let live = null; // { startedAt, total, done } while a run is alive

  const stamp = () => {
    if (!live) return; // a stray late tick after clear() must never re-stamp
    writeRunMarker({
      startedAt: live.startedAt,
      total: live.total,
      done: live.done,
      beatAt: now().getTime(),
    });
  };
  const stopTimer = () => {
    if (timerId != null) {
      try { clearT(timerId); } catch { /* injected timer impl */ }
      timerId = null;
    }
  };

  return {
    start(total) {
      stopTimer(); // never two heartbeats — a prior interval would re-stamp a cleared marker
      live = {
        startedAt: now().getTime(),
        total: Number.isFinite(total) ? total : 0,
        done: 0,
      };
      stamp();
      timerId = setT(stamp, heartbeatMs);
    },
    beat(done) {
      if (!live) return;
      if (Number.isFinite(done)) live.done = done;
      stamp();
    },
    clear() {
      stopTimer();
      live = null;
      clearRunMarker();
    },
  };
}

/**
 * Boot-time interrupted-run check. Deps are injectable for tests; the once-per-
 * boot latch lives at the CALLER (the browser boot path) so this stays a pure
 * decision + side-effect unit. Returns a descriptor of what happened:
 *   { action:'none' }              — no marker
 *   { action:'live' }              — fresh heartbeat → a live run owns it; left alone
 *   { action:'cleared', marker }   — stale but done >= total (finished, died
 *                                    before clearing) → cleared, no message
 *   { action:'notified', marker }  — stale with done < total → cleared + the
 *                                    one-shot recovery notice with real counts
 * A negative heartbeat age (clock skew / time-travel override) reads as fresh —
 * never a false alarm.
 *
 * @param {object} [deps]
 * @param {() => object|null} [deps.read]
 * @param {() => void} [deps.clear]
 * @param {() => Date} [deps.now]
 * @param {(marker:object) => void} [deps.notify]
 * @param {number} [deps.staleMs]
 * @returns {{ action:string, marker?:object }}
 */
export function checkInterruptedRun({
  read = readRunMarker,
  clear = clearRunMarker,
  now = getNow,
  notify = showInterruptedRunNotice,
  staleMs = RUN_MARKER_STALE_MS,
} = {}) {
  const marker = read();
  if (!marker) return { action: 'none' };
  if (now().getTime() - marker.beatAt < staleMs) return { action: 'live' };
  clear();
  if (marker.done < marker.total) {
    notify(marker);
    return { action: 'notified', marker };
  }
  return { action: 'cleared', marker };
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

// EXIF lives in the JPEG APP1 segment, whose payload the JPEG format hard-caps at
// 65,533 bytes (the 16-bit length field, minus 2). Apple's worst-case header
// (with MakerNote/thumbnail ahead of DateTimeOriginal) runs ≈ 68 KB. Reading the
// first 128 KB covers that with margin while avoiding decoding the whole image
// into memory just to find a 19-byte timestamp. If the tag isn't in the slice the
// parser returns null and the file is silently bucketed by its lastModified day
// (the batch-date prompt only fires when even that hint is unavailable).
const EXIF_SCAN_BYTES = 131072; // 128 KB

/**
 * Resolve a file's normalized EXIF datetime + bucket date.
 * Precedence: EXIF DateTimeOriginal string → File.lastModified → null (caller's
 * no-EXIF batch path supplies the user-correctable default). NEVER uses Date()
 * for the EXIF case. Returns { exifDateTime, date, fromExif }.
 *
 * Reads only the first ~128 KB of the file (see EXIF_SCAN_BYTES) — the EXIF
 * timestamp is in the header, so slicing avoids loading the full image and is
 * what fixes the dead-air delay between the picker and the progress sheet.
 * @param {File} file
 * @returns {Promise<{exifDateTime:string|null, date:string|null, fromExif:boolean}>}
 */
async function fileCaptureDate(file) {
  let exifDateTime = null;
  try {
    // Slice the header at the CALL SITE (fileToArrayBuffer stays generic). The
    // `typeof file.slice === 'function'` guard is defensive for test stubs / odd
    // Blob-likes — fall back to reading the whole thing if slice is unavailable.
    const head = (file && typeof file.slice === 'function')
      ? file.slice(0, EXIF_SCAN_BYTES)
      : file;
    const buf = await fileToArrayBuffer(head);
    exifDateTime = readCaptureDate(buf);
  } catch {
    exifDateTime = null;
  }
  if (exifDateTime) {
    return { exifDateTime, date: bucketDateFromExif(exifDateTime), fromExif: true };
  }
  // No EXIF → use lastModified as the bucket day directly (the caller's batch-date
  // prompt only fires for records whose date stays null, i.e. when even this hint
  // is unavailable). lastModified is the camera/file mtime in device-local terms;
  // localISODate is acceptable HERE (a best-effort bucket; out-of-window days are
  // skipped by the window filter, never silently mis-filed), unlike for EXIF.
  if (file && Number.isFinite(file.lastModified) && file.lastModified > 0) {
    const lm = localISODate(new Date(file.lastModified));
    return { exifDateTime: null, date: lm, fromExif: false };
  }
  return { exifDateTime: null, date: null, fromExif: false };
}

/**
 * Sniff an image's true format from its leading magic bytes. Pure — no DOM, no
 * network. Used by the upload bail path: when BOTH downscale decoders fail we
 * upload the ORIGINAL bytes, and we must label them honestly (a HEIC must not be
 * stamped .jpg / image/jpeg). Browsers sniff bytes for <img> rendering anyway, so
 * this is about archive hygiene (a downloaded file with a correct extension), not
 * display. Callers pass the first 16 bytes (`file.slice(0, 16)`) — that is enough
 * for every branch below (the longest probe reads bytes 8–11).
 * @param {ArrayBuffer | Uint8Array} buffer at least the first bytes of a file
 *   (a raw ArrayBuffer or a Uint8Array view — other ArrayBufferViews such as
 *   DataView are not byte-indexable here and are not supported)
 * @returns {{ ext: string, contentType: string } | null} null if unidentifiable
 */
export function sniffImageType(buffer) {
  let b;
  try {
    if (buffer instanceof Uint8Array) b = buffer;
    else if (buffer && typeof buffer.byteLength === 'number') b = new Uint8Array(buffer);
    else return null;
  } catch {
    return null;
  }
  // Match a signature at offset `off`. Each value is a raw byte (number) or an
  // ASCII string (each char = one byte). A short buffer needs no length guard:
  // an out-of-range index reads `undefined`, which never equals an expected byte.
  const at = (off, ...sig) => {
    let i = off;
    for (const part of sig) {
      const expected = typeof part === 'string'
        ? Array.from(part, (ch) => ch.charCodeAt(0))
        : [part];
      for (const byte of expected) {
        if (b[i] !== byte) return false;
        i += 1;
      }
    }
    return true;
  };

  // JPEG: FF D8.
  if (at(0, 0xff, 0xd8)) return { ext: 'jpg', contentType: 'image/jpeg' };
  // PNG: 89 50 4E 47 0D 0A 1A 0A.
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ext: 'png', contentType: 'image/png' };
  // GIF: "GIF8".
  if (at(0, 'GIF8')) return { ext: 'gif', contentType: 'image/gif' };
  // WebP: "RIFF"....​"WEBP".
  if (at(0, 'RIFF') && at(8, 'WEBP')) return { ext: 'webp', contentType: 'image/webp' };
  // ISO-BMFF (HEIC family): "ftyp" at 4–7, brand at 8–11.
  if (at(4, 'ftyp')) {
    if (at(8, 'heic') || at(8, 'heix') || at(8, 'hevc') || at(8, 'hevx')) {
      return { ext: 'heic', contentType: 'image/heic' };
    }
    if (at(8, 'mif1') || at(8, 'msf1')) return { ext: 'heif', contentType: 'image/heif' };
    if (at(8, 'avif')) return { ext: 'avif', contentType: 'image/avif' };
  }
  // TIFF: "II*\0" (little-endian) or "MM\0*" (big-endian).
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) {
    return { ext: 'tif', contentType: 'image/tiff' };
  }
  // BMP: "BM".
  if (at(0, 0x42, 0x4d)) return { ext: 'bmp', contentType: 'image/bmp' };

  return null;
}

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

/**
 * Downscale + orientation-correct an image File to a JPEG Blob (~2048px max edge,
 * quality ~0.85). Uses createImageBitmap(file, { imageOrientation: 'from-image' })
 * so EXIF rotation is baked in. Browser-only. Bails to the ORIGINAL file on any
 * decode/encode failure (HEIC the browser can't decode, etc.) — never throws.
 * Returns { blob, downscaled } on the bail path; the success path also carries the
 * orientation-corrected, post-scale { width, height } (used to size gallery tiles
 * before any image downloads). Originals (bail) have no measured dims.
 * @param {File} file
 * @returns {Promise<{blob: Blob, downscaled: boolean, width?: number, height?: number}>}
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
    return { blob, downscaled: true, width: w, height: h };
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
    // On success, carry the worker's orientation-corrected dims through to the
    // upload doc (a legacy worker reply without them must NOT throw — withDims
    // omits them → square tile).
    const result = msg.ok
      ? withDims({ blob: msg.blob, downscaled: true }, msg.width, msg.height)
      : { blob: pending.get(msg.id)?.file, downscaled: false };
    resolveEntry(msg.id, result);
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
 * `dismissible:false`). Opt-in `onBackdrop` fires on a click that lands on the
 * dimmed backdrop itself (e.target === overlay — card taps never trigger it);
 * the default (no handler) leaves backdrop clicks inert, exactly as before.
 * Browser-only at runtime, but constructed via el() so the
 * Node DOM stub can build + drive it in tests.
 */
function buildModalSheet({ titleText, dismissible = true, onClose, onBackdrop } = {}) {
  const overlay = el('div', 'photo-modal');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  if (typeof onBackdrop === 'function') {
    overlay.addEventListener('click', (e) => {
      if (e && e.target === overlay) onBackdrop();
    });
  }

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
          .filter((n) => !n.disabled && !n.hidden && n.tabIndex !== -1);
  }

  function onKey(e) {
    if (trapStack[trapStack.length - 1] !== onKey) return; // only the topmost overlay acts
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
    trapStack.push(onKey); // topmost-only trap; spliced out in close()
    const items = focusables();
    (items[0] ?? card).focus?.();
  }

  function close(restoreFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    overlay.hidden = true;
    document.removeEventListener('keydown', onKey);
    // Splice by indexOf (paired with the open() push) — may not be topmost if
    // layers closed out of order.
    const ti = trapStack.indexOf(onKey);
    if (ti !== -1) trapStack.splice(ti, 1);
    if (overlay.parentNode && typeof overlay.parentNode.removeChild === 'function') {
      overlay.parentNode.removeChild(overlay);
    }
    if (restoreFocus && lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    if (typeof onClose === 'function') onClose();
  }

  function destroy() { close(false); }

  return { node: overlay, card, bodyEl, open, close, destroy };
}

/** Crude focusable test for the Node stub (buttons/inputs that aren't disabled or hidden). */
function isFocusable(n) {
  if (!n || n.disabled || n.hidden) return false;
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

/** Success pill lingers this long before fading (tap-before-fade re-expands). */
const PILL_FADE_DELAY_MS = 5000;
/** Matches the .photo-progress-pill opacity transition; node removed after it. */
const PILL_FADE_MS = 450;

/**
 * Progress sheet: opens in an INDETERMINATE "Preparing photos…" state the
 * instant it's built (so the screen appears immediately after the picker),
 * flips to a live "Adding N of M…" line on the first setProgress() call, then
 * swaps to a summary + Done button when finished. Body-mounted, NOT
 * dismissible while running — but MINIMIZABLE: the "–" header button (chosen
 * over "×", which reads as cancel on a running job) or a backdrop tap shrinks
 * the modal to a body-mounted floating pill with a live aria-polite count;
 * tapping the pill re-expands. The modal and the pill never coexist.
 * Finishing while minimized flips the pill to "✓ N added" and auto-fades it
 * after ~5s (tapping before the fade re-expands to the summary + Done view);
 * finishing while expanded keeps today's behavior. The pre-totals
 * indeterminate phase (sheet open, setProgress not yet called) passes through
 * the machine — the pill shows "⬆ Adding photos…" until a total is known.
 * Timers are injectable for tests (the createWorkerDownscaler `setTimer`
 * pattern); wirePhotoSync still calls `progress()` with no args.
 *
 * The determinate fill bar is HIDDEN until setProgress() runs — showing a 0%
 * (or any) fill during the indeterminate prepare phase would imply false
 * progress. No new CSS: the bar is hidden via the `hidden` attribute,
 * revealed on the flip to counting.
 *
 * Returns { setProgress(done,total), finish(summaryText, meta?), destroy } —
 * the same contract as before (`meta` is an optional extension carrying
 * { added } so the success pill can show the real added count).
 *
 * @param {object} [opts]
 * @param {(fn:Function, ms:number) => unknown} [opts.setTimer] timeout-style timer
 * @param {(id:unknown) => void} [opts.clearTimer]
 */
export function buildProgressSheet({ setTimer, clearTimer } = {}) {
  const setT = typeof setTimer === 'function' ? setTimer : (fn, ms) => setTimeout(fn, ms);
  const clearT = typeof clearTimer === 'function' ? clearTimer : (id) => clearTimeout(id);

  let mode = 'expanded'; // 'expanded' | 'pill'
  let finished = false;
  let lastDone = null;   // null until setProgress is first called (indeterminate)
  let lastTotal = null;
  let addedCount = null; // from finish() meta — drives the "✓ N added" pill
  let fadeTimers = [];

  const modal = buildModalSheet({
    titleText: 'Adding photos',
    dismissible: false,
    onBackdrop: () => minimize(),
  });

  const status = el('p', 'photo-progress-status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Preparing photos…';
  modal.bodyEl.appendChild(status);

  const bar = el('div', 'photo-progress-bar');
  bar.hidden = true; // indeterminate prepare phase shows no (false) determinate fill
  const fill = el('div', 'photo-progress-fill');
  bar.appendChild(fill);
  modal.bodyEl.appendChild(bar);

  const doneBtn = el('button', 'photo-modal-btn', 'Done');
  doneBtn.type = 'button';
  doneBtn.hidden = true;
  doneBtn.addEventListener('click', () => modal.close());
  modal.bodyEl.appendChild(doneBtn);

  // "–" minimize control. Icon-only → explicit aria-label. Appended to the card
  // (CSS pins it to the top-right corner); while running it is the modal's only
  // visible focusable, so the trap lands on it.
  const minBtn = el('button', 'photo-modal-minimize', '–');
  minBtn.type = 'button';
  minBtn.setAttribute('aria-label', 'Minimize — uploads keep running');
  minBtn.addEventListener('click', () => minimize());
  modal.card.appendChild(minBtn);

  // Floating pill — a single <button> (whole pill = the ≥44px tap target),
  // body-mounted like the lightbox/nav popover so no containing block clips it.
  const pill = el('button', 'photo-progress-pill');
  pill.type = 'button';
  pill.setAttribute('aria-live', 'polite');
  pill.addEventListener('click', () => expand());

  function pillLabel() {
    if (finished) return addedCount != null ? `✓ ${addedCount} added` : '✓ Done';
    if (lastTotal == null) return '⬆ Adding photos…'; // totals not known yet
    return `⬆ ${lastDone} of ${lastTotal}`;
  }

  /** Sync the pill to the current state — label + success tint. */
  function syncPill() {
    pill.textContent = pillLabel();
    pill.classList.toggle('is-success', finished);
  }

  function cancelFade() {
    fadeTimers.forEach((id) => { try { clearT(id); } catch { /* injected timer impl */ } });
    fadeTimers = [];
    pill.classList.remove('is-fading');
  }

  function removePill() {
    cancelFade();
    if (pill.parentNode && typeof pill.parentNode.removeChild === 'function') {
      pill.parentNode.removeChild(pill);
    }
  }

  // Success-while-minimized: linger, then fade (CSS opacity transition), then
  // remove. Two timers so the fade is actually visible; both are cancelled by a
  // tap-before-fade (expand) and by destroy().
  function startFade() {
    cancelFade();
    fadeTimers.push(setT(() => { pill.classList.add('is-fading'); }, PILL_FADE_DELAY_MS));
    fadeTimers.push(setT(() => { removePill(); }, PILL_FADE_DELAY_MS + PILL_FADE_MS));
  }

  function minimize() {
    if (mode === 'pill') return;
    mode = 'pill';
    modal.close(false); // keep state; do NOT restore focus — it moves to the pill
    syncPill();
    if (!pill.parentNode && typeof document !== 'undefined' && document.body) {
      document.body.appendChild(pill);
    }
    pill.focus?.();
    if (finished) startFade();
  }

  function expand() {
    if (mode !== 'pill') return;
    mode = 'expanded';
    removePill();
    modal.open();
    // Sane focus: the live control for the current state, not whatever the
    // generic trap picks (the hidden Done button while running).
    (finished ? doneBtn : minBtn).focus?.();
  }

  modal.open();

  return {
    setProgress(done, total) {
      lastDone = done;
      lastTotal = total;
      bar.hidden = false; // reveal the determinate bar on the flip to counting
      status.textContent = `Adding ${done} of ${total}…`;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      try { fill.style.width = `${pct}%`; } catch { /* stub has no style */ }
      if (mode === 'pill') syncPill();
    },
    finish(summaryText, meta) {
      finished = true;
      addedCount = meta && Number.isFinite(meta.added) ? meta.added : null;
      // Update the modal innards regardless of mode, so a later expand (tap on
      // the success pill before it fades) lands on the summary + Done view.
      status.textContent = summaryText;
      try { fill.style.width = '100%'; } catch { /* ignore */ }
      doneBtn.hidden = false;
      if (mode === 'pill') {
        syncPill();
        startFade();
      } else {
        doneBtn.focus?.();
      }
    },
    destroy() {
      removePill();
      modal.destroy();
    },
  };
}

/**
 * Show a transient notice sheet (errors, the interrupted-run recovery notice).
 * Body-mounted, dismissible. XSS-safe: message reaches the DOM via textContent.
 * @param {string} message
 * @param {string} [titleText]
 */
function showPhotoError(message, titleText = 'Couldn’t add photos') {
  const modal = buildModalSheet({ titleText, dismissible: true });
  modal.bodyEl.appendChild(el('p', 'photo-modal-note', message));
  const ok = el('button', 'photo-modal-btn', 'OK');
  ok.type = 'button';
  ok.addEventListener('click', () => modal.close());
  modal.bodyEl.appendChild(ok);
  modal.open();
}

/**
 * The interrupted-run recovery notice (checkInterruptedRun's default notifier).
 * Real counts via textContent; the re-select promise is honest — the dedup
 * preload makes a re-selection a true top-up (already-uploaded files skip).
 * @param {{ done:number, total:number }} marker
 */
function showInterruptedRunNotice(marker) {
  const done = Number.isFinite(marker?.done) ? marker.done : 0;
  const total = Number.isFinite(marker?.total) ? marker.total : 0;
  showPhotoError(
    `Your last photo upload was interrupted: ${done} of ${total} made it. `
      + 'Re-select those photos — the ones already uploaded will be skipped automatically.',
    'Upload interrupted',
  );
}

// ---- Orchestrator (injected-seam, testable) -------------------------------

/**
 * The file-picker `accept` filter. `image/*` covers the common families, but
 * iOS Safari historically excludes HEIC/HEIF from `image/*` unless they're named
 * explicitly — so we append `image/heic,image/heif` to surface untranscoded
 * iPhone captures in the picker.
 * @type {string}
 */
export const PICKER_ACCEPT = 'image/*,image/heic,image/heif';

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
    input.accept = PICKER_ACCEPT;
    input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const done = (files) => { if (settled) return; settled = true; cleanup(); resolve(files); };
    const onChange = () => done(input.files ? Array.from(input.files) : []);
    // 'change' resolves with the chosen files; 'cancel' (newer browsers) resolves
    // with []. On browsers without the 'cancel' event a dismissed picker leaves
    // this promise pending — harmless, since the next pick supersedes it (the
    // discarded input is cleaned up and a fresh one opens).
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
 * @param {(path:string, blob:Blob, contentType?:string) => Promise<string>} deps.uploadBlob upload → download URL (contentType defaults to 'image/jpeg')
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
 * @param {{start:(total:number)=>void, beat:(done:number)=>void, clear:()=>void}} [deps.runMarker]
 *   interrupted-run marker (createRunMarker); defaults to a no-op so existing
 *   harnesses need no change. start() fires only post-prepared (a cancelled
 *   pick strands no marker); clear() fires on EVERY in-page exit after start —
 *   the marker exists to catch silent page deaths, not in-page outcomes the
 *   user already saw.
 * @param {number} [deps.concurrency=3]
 * @returns {{ run: (currentIso?:string) => Promise<object|undefined> }}
 */
export function wirePhotoSync(deps) {
  const {
    pickFiles, readDate, downscale, uploadBlob, writeDoc, readDedup,
    updateSyncState, travelers, getStoredUploader, setStoredUploader,
    askUploader, askBatchDate, progress, onError, isOnline, now, windowDates,
    runMarker,
    concurrency = 3,
  } = deps;

  // Marker ops are best-effort — a buggy injected marker must never kill a run
  // (beat() runs inside the worker loop's finally; a throw there would
  // propagate past the per-file catch).
  const marker = {
    start: (t) => { try { runMarker?.start(t); } catch { /* best-effort */ } },
    beat: (d) => { try { runMarker?.beat(d); } catch { /* best-effort */ } },
    clear: () => { try { runMarker?.clear(); } catch { /* best-effort */ } },
  };

  let running = false; // re-entrancy latch — a double-tap is a no-op while busy.
  let lastUi = null; // the prior run's progress sheet — swept before minting a new one,
                     // so a lingering "✓ N added" success pill can't resurrect a stale
                     // "finished" modal when a second upload starts.

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
    let markerStarted = false; // gate so an exit BEFORE start can't clear a foreign marker
    try {
      const uploader = await resolveUploader();
      if (!uploader) return undefined; // dismissed identity prompt

      const files = await pickFiles();
      if (!files || files.length === 0) return undefined;

      if (typeof isOnline === 'function' && !isOnline()) {
        onError('You need an internet connection to add photos. Reconnect and try again.');
        return undefined;
      }

      // Mount the progress sheet NOW — in its indeterminate "Preparing photos…"
      // state — so the screen appears the instant the picker closes, BEFORE the
      // dedup preload + the per-file EXIF header reads (which can take a beat on a
      // large multi-select). It flips to the "Adding N of M…" counting bar at the
      // start of the upload phase below (the first ui.setProgress call).
      //
      // Every exit after this point MUST settle the sheet — finish() on the normal
      // path, destroy() on the early "nothing prepared" return, and destroy()-then-
      // rethrow on an unexpected throw (the catch below) — so it can never orphan.
      //
      // Sweep a prior run's still-lingering sheet/pill (e.g. a minimized "✓ N added"
      // success pill mid-fade) BEFORE minting the new one — order is load-bearing:
      // sweep old → mint new → record new.
      try { if (lastUi) lastUi.destroy(); } catch { /* best-effort sweep of a prior run's lingering sheet/pill */ }
      lastUi = null;
      const ui = progress();
      lastUi = ui;
      try {
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
        // The batch-date prompt is a second body-mounted modal opened OVER the
        // progress sheet; later-mounted sits on top (expected) and resolves null on
        // cancel.
        if (noDate.length) {
          const fallback = (typeof currentIso === 'string' && currentIso)
            || localISODate(now()) || windowDates()[0] || null;
          const batchDate = await askBatchDate(noDate.length, fallback);
          if (batchDate) {
            noDate.forEach((rec) => { rec.date = batchDate; prepared.push(rec); });
          }
          // Cancelled → those files are dropped (skipped), never silently mis-dated.
        }

        // Nothing to upload (every file was no-date and the batch prompt was
        // cancelled, or every readDate yielded no date). Tear the sheet down so it
        // doesn't orphan, then bail.
        if (prepared.length === 0) {
          ui.destroy();
          return undefined;
        }

        const tally = { added: 0, dupes: 0, skipped: 0, errors: 0 };
        const daysAdded = new Set();
        let completed = 0;
        const total = prepared.length;
        // Files are prepared and the total is known → the interrupted-run marker
        // goes live (a page death from here on leaves it behind for the boot check).
        marker.start(total);
        markerStarted = true;
        // The flip from indeterminate "Preparing photos…" to the determinate
        // "Adding 0 of N…" counting bar — the upload phase starts here.
        ui.setProgress(0, total);

        // Per-file worker. Bounded concurrency via a shared cursor.
        let cursor = 0;
        const advance = () => {
          completed += 1;
          ui.setProgress(completed, total);
          marker.beat(completed);
        };

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

              const { blob, downscaled, width, height } = await downscale(rec.file);
              // Success path (downscaled JPEG): byte-for-byte identical to before —
              // .jpg path, image/jpeg. Bail path (both decoders failed; blob is the
              // ORIGINAL file): sniff the true format from the first 16 bytes so we
              // never stamp a HEIC/PNG/etc as .jpg. An unknown/unreadable header →
              // application/octet-stream (the deployed Storage rules reject that, so
              // such a rare upload tallies as an error — better than a false label).
              let ext = 'jpg';
              let contentType = 'image/jpeg';
              if (!downscaled) {
                let sniffed = null;
                try {
                  const head = await rec.file.slice(0, 16).arrayBuffer();
                  sniffed = sniffImageType(head);
                } catch {
                  sniffed = null; // header read failed → treat as unknown
                }
                ({ ext, contentType } = sniffed || { ext: 'bin', contentType: 'application/octet-stream' });
                console.warn('[photos] uploading original (downscale failed):', contentType);
              }
              const path = `trip-photos/${rec.date}/${cleanUploader}/${uuid()}.${ext}`;
              const url = await uploadBlob(path, blob, contentType);
              // Orientation-corrected dims (success path only) drive the mosaic
              // gallery's tile spans; the bail path (original bytes, no measured
              // dims) writes a doc without them → that photo renders a 1×1 tile.
              await writeDoc(withDims({
                date: rec.date,
                uploader,
                storagePath: path,
                url,
                takenAt: rec.exifDateTime || `${rec.date} 00:00:00`,
                size: rec.file.size,
              }, width, height));
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
        ui.finish(summary, { added: tally.added });
        return { ...tally, days: daysAdded.size };
      } catch (err) {
        // An unexpected throw between mount and finish — never leave the sheet
        // orphaned on screen. Destroy it, then rethrow so the caller's existing
        // error surface still fires.
        try { ui.destroy(); } catch { /* destroy must not mask the original error */ }
        throw err;
      }
    } finally {
      // The run is ending IN-PAGE (finish or throw) → the marker must not
      // survive, or the next boot would announce a phantom interruption.
      if (markerStarted) marker.clear();
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

// Lazy run-marker singleton (same trap as photoService/getWorkerDownscaler:
// buildOnAddPhotos re-runs when onAuthStateChanged re-fires, and two marker
// instances would mean two heartbeat-interval handles fighting over the same
// localStorage key). The heartbeat interval lives inside this one instance.
let runMarkerSingleton = null;
function getRunMarker() {
  if (!runMarkerSingleton) runMarkerSingleton = createRunMarker();
  return runMarkerSingleton;
}

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
    // Not-ready route: go straight to the throttled main-thread decoder. No retry
    // — re-running the SAME decoder on a failure is pointless.
    if (!ok) return downscaleImageThrottled(file);
    // Worker route: on a worker FAILURE (resolves { downscaled: false }, original
    // bytes) give the file ONE retry on the genuinely different main-thread decoder
    // before giving up. This runs behind the progress sheet, so the brief per-file
    // main-thread jank is acceptable (and bounded to files the worker couldn't do).
    const r = await wd.downscale(file);
    if (r && r.downscaled) return r;
    return downscaleImageThrottled(file);
  };

  const sync = wirePhotoSync({
    pickFiles: pickFilesBrowser,
    readDate: fileCaptureDate,
    downscale: downscaleRouted,
    uploadBlob: (path, blob, contentType = 'image/jpeg') => new Promise((resolve, reject) => {
      const task = uploadBytesResumable(ref(storage, path), blob, { contentType });
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
    runMarker: getRunMarker(),
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

  // One-shot interrupted-run detection. Latched per PAGE BOOT (module load),
  // not per mount — mountTheApp re-runs on sign-out/in, and the structural
  // false-positive guard ("a resumed page never shows the notice") holds only
  // if the check is bound to boot. Resume-from-background never re-executes
  // module code, so this path is unreachable on resume.
  let interruptedRunCheckDone = false;
  const checkInterruptedRunOnce = () => {
    if (interruptedRunCheckDone) return;
    interruptedRunCheckDone = true;
    try { checkInterruptedRun(); }
    catch (err) { console.warn('[photos] interrupted-run check failed:', err); }
  };

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
    // After the app mounts (the notice modal mounts on <body>): did the last
    // upload run die mid-flight? Stale marker + done < total → one-shot notice.
    checkInterruptedRunOnce();
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
    // Request durable storage ONCE (fire-and-forget, throw-safe). Installed web
    // apps are granted this heuristically; it exempts the photo cache from
    // eviction so a big day stays browsable offline. Never awaited in a way that
    // can reject the boot; guarded so a host without navigator.storage is a no-op.
    try {
      if (typeof navigator !== 'undefined' && navigator.storage
          && typeof navigator.storage.persist === 'function') {
        Promise.resolve(navigator.storage.persist()).catch(() => {});
      }
    } catch { /* persistence is best-effort; never block boot */ }

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
