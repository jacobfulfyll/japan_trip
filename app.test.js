// app.test.js — unit tests for the pure data layer of app.js.
//
// Run with:  node --test
//
// Scope: the public helper API (getTrip / getDays / getDay / getDayByNumber)
// and the data-integrity invariants the downstream screens depend on. These
// are pure functions over data/days.js — no DOM, no I/O — so they run in plain
// Node with the built-in test runner. NO new dependencies, NO build step.
//
// OUT OF SCOPE: renderInto() performs real DOM mutation (document.createElement,
// textContent, appendChild). It cannot be exercised in Node without jsdom, which
// would require adding an npm dependency to this dependency-free static site.
// The DOM bootstrap in app.js is guarded by `typeof document !== 'undefined'`,
// so importing this module here never touches the DOM. renderInto is therefore
// intentionally left to manual/browser verification.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getTrip,
  getDays,
  getDay,
  getDayByNumber,
  buildValidatedDays,
  haversineMeters,
  safeUrl,
  nearestPrecedingCoords,
  formatWalk,
  renderDay,
  getNow,
  setNow,
  frameForDay,
  isEveningWindow,
  pickLandingView,
  tripWindowDates,
  mountApp,
  renderOverview,
  parseNowOverride,
  resolveNowOverride,
} from './app.js';
import { TRIP, DAYS } from './data/days.js';

/**
 * Run a fn with console.warn silenced, returning the warn-call count. The
 * malformed-input tests deliberately trigger app.js's warn-and-skip path; we
 * assert it warned, but don't want that noise in the test output.
 */
function captureWarnings(fn) {
  const original = console.warn;
  let count = 0;
  console.warn = () => {
    count += 1;
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Shared helpers for the tests (kept independent of app.js internals).
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Independent UTC-midnight parser so tests don't depend on app.js internals. */
function utcMidnight(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Expected 1-based day number for an ISO date relative to TRIP.start. */
function expectedDayNumber(iso) {
  return Math.round((utcMidnight(iso) - utcMidnight(TRIP.start)) / MS_PER_DAY) + 1;
}

// ===========================================================================
// getDays() — completeness & ordering
// ===========================================================================

test('getDays returns every present day (10) from data/days.js', () => {
  assert.equal(getDays().length, 10);
  // Sanity-check it tracks the source array length (all source days are valid).
  assert.equal(getDays().length, DAYS.length);
});

test('getDays returns days sorted ascending by date', () => {
  const dates = getDays().map((d) => d.date);
  const sorted = [...dates].sort(); // ISO YYYY-MM-DD sorts lexicographically
  assert.deepEqual(dates, sorted);
});

test('getDays spans the present range Jun 24 -> Jul 3 with no gap days included', () => {
  const dates = getDays().map((d) => d.date);
  assert.equal(dates[0], '2026-06-24');
  assert.equal(dates[dates.length - 1], '2026-07-03');
  // The Jun 16-23 gap is genuinely absent (partial-trip-safe), not zero-filled.
  assert.ok(!dates.includes('2026-06-17'));
  assert.ok(!dates.includes('2026-06-23'));
});

// ===========================================================================
// dayNumber derivation
// ===========================================================================

test('dayNumber for Jun 24 (first present day) is 9', () => {
  assert.equal(getDay('2026-06-24').dayNumber, 9);
});

test('dayNumber for Jul 3 (last present day) is 18', () => {
  assert.equal(getDay('2026-07-03').dayNumber, 18);
});

test('dayNumber equals (date - TRIP.start) in days, + 1, for every day', () => {
  for (const day of getDays()) {
    assert.equal(
      day.dayNumber,
      expectedDayNumber(day.date),
      `dayNumber mismatch for ${day.date}`,
    );
  }
});

test('dayNumber is strictly increasing across the sorted days', () => {
  const nums = getDays().map((d) => d.dayNumber);
  for (let i = 1; i < nums.length; i++) {
    assert.ok(nums[i] > nums[i - 1], `dayNumber not increasing at index ${i}`);
  }
});

// ===========================================================================
// getDay(iso) — present, gap, and malformed inputs
// ===========================================================================

test('getDay returns the matching day for a present ISO date', () => {
  const day = getDay('2026-06-24');
  assert.ok(day);
  assert.equal(day.date, '2026-06-24');
  assert.equal(day.base, 'Kyoto');
});

test('getDay returns null for an absent date inside the Jun 16-23 gap', () => {
  // This is the critical partial-trip-safe behavior: unauthored days are null,
  // never a throw and never a fabricated empty day.
  assert.equal(getDay('2026-06-17'), null);
});

test('getDay returns null for a valid date entirely outside the trip', () => {
  assert.equal(getDay('2025-01-01'), null);
});

test('getDay returns null for a malformed date string without throwing', () => {
  assert.equal(getDay('not-a-date'), null);
});

test('getDay returns null for an empty string without throwing', () => {
  assert.equal(getDay(''), null);
});

test('getDay returns null for null/undefined without throwing', () => {
  assert.equal(getDay(null), null);
  assert.equal(getDay(undefined), null);
});

test('getDay returns null for a non-string argument without throwing', () => {
  assert.equal(getDay(20260624), null);
  assert.equal(getDay({}), null);
});

// ===========================================================================
// getDayByNumber(n) — present, gap, out-of-range
// ===========================================================================

test('getDayByNumber returns the right day for a present number (9 -> Jun 24)', () => {
  const day = getDayByNumber(9);
  assert.ok(day);
  assert.equal(day.date, '2026-06-24');
});

test('getDayByNumber returns the right day for the last number (18 -> Jul 3)', () => {
  assert.equal(getDayByNumber(18).date, '2026-07-03');
});

test('getDayByNumber returns null for a number in the unauthored gap (2)', () => {
  // Day 2 = Jun 17, which is in the not-yet-authored range.
  assert.equal(getDayByNumber(2), null);
});

test('getDayByNumber returns null for an out-of-range number', () => {
  assert.equal(getDayByNumber(0), null);
  assert.equal(getDayByNumber(999), null);
  assert.equal(getDayByNumber(-5), null);
});

test('getDayByNumber returns null for null/undefined/NaN without false-matching', () => {
  // In a degraded build (unparseable TRIP.start) every dayNumber is null; the
  // input guard must stop getDayByNumber(null)/(undefined) from matching the
  // first such day. NaN is rejected too (NaN === NaN is false, but be explicit).
  assert.equal(getDayByNumber(null), null);
  assert.equal(getDayByNumber(undefined), null);
  assert.equal(getDayByNumber(NaN), null);
});

test('getDay and getDayByNumber resolve to the same day for present entries', () => {
  for (const day of getDays()) {
    assert.equal(getDayByNumber(day.dayNumber), getDay(day.date));
  }
});

// ===========================================================================
// getTrip() — shape
// ===========================================================================

test('getTrip returns the trip metadata with the expected shape', () => {
  const trip = getTrip();
  assert.equal(typeof trip.title, 'string');
  assert.ok(trip.title.length > 0);
  assert.equal(trip.start, '2026-06-16');
  assert.equal(trip.end, '2026-07-03');
  assert.ok(Array.isArray(trip.travelers));
  assert.equal(trip.travelers.length, 4);
  assert.ok(trip.travelers.every((t) => typeof t === 'string'));
  assert.equal(typeof trip.eveningWindow, 'object');
  assert.equal(typeof trip.eveningWindow.startHour, 'number');
  assert.equal(typeof trip.eveningWindow.endHour, 'number');
});

test('getTrip() returns a deeply-frozen object that cannot be mutated', () => {
  const trip = getTrip();
  // Top-level frozen: assignment throws in strict mode (ES modules are strict).
  assert.ok(Object.isFrozen(trip));
  assert.throws(() => {
    trip.title = 'MUTATED';
  }, TypeError);
  // Deep: nested array and object are frozen too, not just the top level.
  assert.ok(Object.isFrozen(trip.travelers));
  assert.ok(Object.isFrozen(trip.eveningWindow));
  assert.throws(() => {
    trip.travelers.push('intruder');
  }, TypeError);
  assert.throws(() => {
    trip.eveningWindow.startHour = 0;
  }, TypeError);
});

test('a later getTrip() is uncorrupted after a mutation attempt', () => {
  const original = getTrip().title;
  try {
    getTrip().title = 'MUTATED';
  } catch {
    /* frozen — throw expected, swallow it */
  }
  assert.equal(getTrip().title, original);
});

test('getTrip().start is chronologically at or before the first present day', () => {
  // TRIP.start (Jun 16) precedes the first authored day (Jun 24); this is what
  // makes Jun 24 land on Day 9 rather than Day 1.
  const firstDay = getDays()[0].date;
  assert.ok(utcMidnight(getTrip().start) <= utcMidnight(firstDay));
});

// ===========================================================================
// Data-integrity invariants enforced/expected by the schema
// ===========================================================================

test('every returned day has a date that parses to a valid Date', () => {
  for (const day of getDays()) {
    const t = new Date(day.date).getTime();
    assert.ok(Number.isFinite(t), `unparseable date: ${day.date}`);
  }
});

test('every returned day has plan as an array', () => {
  for (const day of getDays()) {
    assert.ok(Array.isArray(day.plan), `plan not an array for ${day.date}`);
  }
});

test('every returned day has photos as an array', () => {
  for (const day of getDays()) {
    assert.ok(Array.isArray(day.photos), `photos not an array for ${day.date}`);
  }
});

test('no plan item carries more than 4 recommendations (schema RULE)', () => {
  for (const day of getDays()) {
    for (const item of day.plan) {
      if (item.recommendations !== undefined) {
        assert.ok(
          Array.isArray(item.recommendations),
          `recommendations not an array on ${day.date} / "${item.title}"`,
        );
        assert.ok(
          item.recommendations.length <= 4,
          `>4 recommendations on ${day.date} / "${item.title}" (${item.recommendations.length})`,
        );
      }
    }
  }
});

test('every plan item has a tag and a title (schema-required fields)', () => {
  for (const day of getDays()) {
    for (const item of day.plan) {
      assert.equal(typeof item.tag, 'string', `missing tag on ${day.date}`);
      assert.ok(item.tag.length > 0, `empty tag on ${day.date}`);
      assert.equal(typeof item.title, 'string', `missing title on ${day.date}`);
      assert.ok(item.title.length > 0, `empty title on ${day.date}`);
    }
  }
});

// ===========================================================================
// Stability: validation runs once at import, not re-derived per call.
// ===========================================================================

test('getDays returns equal contents and stable day references across calls', () => {
  // The validation runs once at import; getDays() returns a fresh array each
  // call (defensive copy — see the immutability tests), but the day objects
  // inside are the same frozen instances, so nothing is re-derived per call.
  const first = getDays();
  const second = getDays();
  assert.notEqual(first, second); // fresh array each call
  assert.deepEqual(first, second); // equal contents
  for (let i = 0; i < first.length; i++) {
    assert.equal(first[i], second[i], `day ${i} should be the same instance`);
  }
});

// ===========================================================================
// Malformed-DAYS skip path — buildValidatedDays() degrades gracefully.
//
// The production VALIDATED_DAYS is built from clean data, so the warn-and-skip
// branches are never hit by the helpers above. buildValidatedDays is exported as
// a pure function (data injected as args) precisely so this path is testable
// with synthetic malformed input. It must SKIP bad entries and KEEP good ones —
// never throw — so the site still renders whatever is valid.
// ===========================================================================

const GOOD_DAY = { date: '2026-06-24', base: 'Kyoto', title: 'Good', plan: [], photos: [] };
const TRIP_STUB = { start: '2026-06-16' };

test('buildValidatedDays skips a non-object entry but keeps the valid ones', () => {
  let result;
  const warnings = captureWarnings(() => {
    result = buildValidatedDays([GOOD_DAY, null, 42, 'nope'], TRIP_STUB);
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-06-24');
  assert.ok(warnings >= 1, 'expected a warning for the skipped entries');
});

test('buildValidatedDays skips an entry with an invalid date string', () => {
  let result;
  captureWarnings(() => {
    result = buildValidatedDays(
      [GOOD_DAY, { date: 'not-a-date', plan: [], photos: [] }],
      TRIP_STUB,
    );
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-06-24');
});

test('buildValidatedDays skips an entry missing a date entirely', () => {
  let result;
  captureWarnings(() => {
    result = buildValidatedDays([GOOD_DAY, { base: 'Tokyo', plan: [] }], TRIP_STUB);
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-06-24');
});

test('buildValidatedDays keeps a date-valid day even when plan/photos are malformed', () => {
  // Shape sanity checks warn but do NOT skip — partial content is allowed.
  let result;
  const warnings = captureWarnings(() => {
    result = buildValidatedDays(
      [{ date: '2026-06-25', plan: 'not-an-array', photos: null }],
      TRIP_STUB,
    );
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-06-25');
  assert.ok(warnings >= 1, 'expected warnings about plan/photos shape');
});

test('buildValidatedDays returns [] (no throw) when explicitly given a non-array', () => {
  // NB: `undefined` is intentionally excluded — it triggers the `= DAYS`
  // default parameter (the real data), which is the documented fallback, not a
  // non-array input. These are values a caller actively passes.
  for (const bad of [null, {}, 'days', 7]) {
    let result;
    captureWarnings(() => {
      result = buildValidatedDays(bad, TRIP_STUB);
    });
    assert.deepEqual(result, [], `expected [] for ${String(bad)}`);
  }
});

test('buildValidatedDays still produces valid days when TRIP.start is unparseable (dayNumber null)', () => {
  // A bad trip start must not break the whole build — days survive, but their
  // derived dayNumber degrades to null rather than throwing.
  let result;
  const warnings = captureWarnings(() => {
    result = buildValidatedDays([GOOD_DAY], { start: 'garbage' });
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].dayNumber, null);
  assert.ok(warnings >= 1, 'expected a warning about TRIP.start');
});

test('buildValidatedDays sorts surviving entries ascending by date', () => {
  let result;
  captureWarnings(() => {
    result = buildValidatedDays(
      [
        { date: '2026-06-26', plan: [], photos: [] },
        { date: 'bad', plan: [], photos: [] }, // dropped
        { date: '2026-06-24', plan: [], photos: [] },
        { date: '2026-06-25', plan: [], photos: [] },
      ],
      TRIP_STUB,
    );
  });
  assert.deepEqual(
    result.map((d) => d.date),
    ['2026-06-24', '2026-06-25', '2026-06-26'],
  );
});

// ===========================================================================
// Impossible-date guard — parseISODate's round-trip check (via getDay).
//
// A well-formed YYYY-MM-DD string can still name a date that does not exist
// (Feb 30, Apr 31, ...). The guard must reject these: lookup returns null,
// never a fabricated/rolled-over day, and never a throw.
// ===========================================================================

test('getDay returns null for a well-formed but impossible date (2026-02-30)', () => {
  assert.equal(getDay('2026-02-30'), null);
});

test('getDay returns null for other impossible calendar dates without throwing', () => {
  for (const iso of ['2026-04-31', '2026-13-01', '2026-00-10', '2026-06-00', '2027-02-29']) {
    assert.equal(getDay(iso), null, `expected null for impossible date ${iso}`);
  }
});

test('buildValidatedDays skips an entry whose date is well-formed but impossible', () => {
  let result;
  captureWarnings(() => {
    result = buildValidatedDays(
      [GOOD_DAY, { date: '2026-02-30', plan: [], photos: [] }],
      TRIP_STUB,
    );
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-06-24');
});

// ===========================================================================
// Immutability contract of the public accessors.
//
// getDays()/getDay()/getDayByNumber() must NOT expose the internal state in a
// way that lets a caller corrupt it for every other consumer. getDays() hands
// out a fresh array copy; every returned day (and its nested objects) is deeply
// frozen. The tests below GUARD that contract — a mutation attempt must not
// affect a subsequent call. (These previously pinned the old leaky behavior;
// they were flipped when the contract was hardened.)
// ===========================================================================

test('getDays returns a fresh array copy that is not the same reference', () => {
  // No longer the live internal array: each call yields a distinct copy, so a
  // caller mutating one cannot reach into the shared internal list.
  assert.notEqual(getDays(), getDays());
  // ...but the copies have equal contents.
  assert.deepEqual(getDays(), getDays());
});

test('mutating the array returned by getDays() does NOT leak into later calls', () => {
  const days = getDays();
  const originalLength = days.length;
  const sentinel = { date: '1999-01-01', injected: true };
  days.push(sentinel); // mutating the returned copy is allowed...
  // ...but it must not reach the internal list a subsequent call returns.
  assert.equal(getDays().length, originalLength);
  assert.ok(!getDays().some((d) => d.injected));
});

test('day objects returned by getDay() are frozen and cannot be mutated', () => {
  const day = getDay('2026-06-24');
  const originalBase = day.base;
  // Frozen, so the assignment is a silent no-op in sloppy mode and a throw in
  // strict mode (ES modules are strict) — either way it must not take effect.
  assert.throws(() => {
    day.base = 'MUTATED';
  }, TypeError);
  // Nested objects are frozen too (deep, not shallow).
  assert.ok(Object.isFrozen(day));
  assert.ok(Object.isFrozen(day.plan));
  // A subsequent lookup still sees the untouched value.
  assert.equal(getDay('2026-06-24').base, originalBase);
});

test('deep-freeze reaches nested arrays inside plan items, not just one level', () => {
  // Regression guard: pin that the freeze descends into a plan item's nested
  // recommendations[] array — proving deepFreeze is recursive, not shallow.
  const day = getDay('2026-06-24');
  const recItem = day.plan.find((p) => Array.isArray(p.recommendations));
  assert.ok(recItem, 'expected a plan item with a recommendations array on Jun 24');
  assert.ok(Object.isFrozen(recItem));
  assert.ok(Object.isFrozen(recItem.recommendations));
  assert.throws(() => {
    recItem.recommendations.push('intruder');
  }, TypeError);
});

// ===========================================================================
// day-view-screen — pure helpers (no DOM required).
//
// These functions are exported from app.js so the distance math, URL scheme
// gate, walk-origin selection, and walk-label formatting can be unit-tested
// directly, WITHOUT a DOM. (safeUrl / nearestPrecedingCoords / formatWalk were
// given a one-line `export` purely for testability; their behavior also surfaces
// through renderDay's DOM, asserted further below.)
// ===========================================================================

// ---------------------------------------------------------------------------
// haversineMeters — pure great-circle distance (item 1).
// ---------------------------------------------------------------------------

test('haversineMeters returns 0 for two identical points', () => {
  assert.equal(haversineMeters({ lat: 35.0116, lng: 135.7681 }, { lat: 35.0116, lng: 135.7681 }), 0);
});

test('haversineMeters: 1 degree of latitude at the equator is ~111.19 km', () => {
  // Reference: 1° latitude ≈ 111,195 m for a 6,371,000 m mean-radius sphere.
  const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111195) < 50, `expected ~111195 m, got ${d}`);
});

test('haversineMeters: a known Kyoto pair (Kyoto Station → Fushimi Inari) is ~2.43 km', () => {
  // Kyoto Station (34.9858,135.7588) → Fushimi Inari (34.9671,135.7727).
  const d = haversineMeters({ lat: 34.9858, lng: 135.7588 }, { lat: 34.9671, lng: 135.7727 });
  assert.ok(Math.abs(d - 2435) < 30, `expected ~2435 m, got ${d}`);
});

test('haversineMeters is symmetric: dist(a,b) === dist(b,a)', () => {
  const a = { lat: 34.9858, lng: 135.7588 };
  const b = { lat: 34.9671, lng: 135.7727 };
  assert.equal(haversineMeters(a, b), haversineMeters(b, a));
});

test('haversineMeters returns null when either point is null/undefined', () => {
  const p = { lat: 35, lng: 135 };
  assert.equal(haversineMeters(null, p), null);
  assert.equal(haversineMeters(p, null), null);
  assert.equal(haversineMeters(undefined, p), null);
  assert.equal(haversineMeters(p, undefined), null);
  assert.equal(haversineMeters(null, null), null);
});

test('haversineMeters returns null when a coordinate component is missing', () => {
  const p = { lat: 35, lng: 135 };
  assert.equal(haversineMeters({ lat: 35 }, p), null); // no lng
  assert.equal(haversineMeters({ lng: 135 }, p), null); // no lat
  assert.equal(haversineMeters(p, {}), null);
});

test('haversineMeters returns null for NaN / non-numeric coordinate components', () => {
  const p = { lat: 35, lng: 135 };
  assert.equal(haversineMeters({ lat: NaN, lng: 135 }, p), null);
  assert.equal(haversineMeters({ lat: 35, lng: Infinity }, p), null);
  assert.equal(haversineMeters({ lat: '35', lng: 135 }, p), null); // string, not number
  assert.equal(haversineMeters(p, { lat: null, lng: 135 }), null);
});

// ---------------------------------------------------------------------------
// safeUrl — scheme allow-list (item 2). Also exercised via DOM href/src below.
// ---------------------------------------------------------------------------

test('safeUrl allows https: and http: absolute URLs unchanged', () => {
  assert.equal(safeUrl('https://maps.google.com/?q=Yasaka'), 'https://maps.google.com/?q=Yasaka');
  assert.equal(safeUrl('http://example.com/x.jpg'), 'http://example.com/x.jpg');
  // Scheme matching is case-insensitive.
  assert.equal(safeUrl('HTTPS://example.com'), 'HTTPS://example.com');
});

test('safeUrl allows scheme-less relative and root-relative paths', () => {
  assert.equal(safeUrl('img/hero.jpg'), 'img/hero.jpg');
  assert.equal(safeUrl('/photos/day1.png'), '/photos/day1.png');
  assert.equal(safeUrl('./local.jpg'), './local.jpg');
});

test('safeUrl rejects javascript: URLs (returns null)', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  // Case / whitespace variations must not slip past the gate.
  assert.equal(safeUrl('JavaScript:alert(1)'), null);
  assert.equal(safeUrl('  javascript:alert(1)'), null);
});

test('safeUrl rejects data: URLs (returns null)', () => {
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeUrl('data:image/png;base64,AAAA'), null);
});

test('safeUrl rejects other dangerous/unknown schemes', () => {
  assert.equal(safeUrl('vbscript:msgbox(1)'), null);
  assert.equal(safeUrl('file:///etc/passwd'), null);
  assert.equal(safeUrl('ftp://host/file'), null);
});

test('safeUrl rejects javascript: smuggled with embedded tab/newline/CR (URL-parser strips them)', () => {
  // The WHATWG URL parser strips ASCII tab/LF/CR, so these would re-form into a
  // live javascript: href if safeUrl did not strip them before the scheme check.
  assert.equal(safeUrl('java\tscript:alert(1)'), null);
  assert.equal(safeUrl('java\nscript:alert(1)'), null);
  assert.equal(safeUrl('java\rscript:alert(1)'), null);
  assert.equal(safeUrl('\tjavascript:alert(1)'), null);
});

test('safeUrl returns null for non-strings and empty/whitespace input', () => {
  assert.equal(safeUrl(null), null);
  assert.equal(safeUrl(undefined), null);
  assert.equal(safeUrl(42), null);
  assert.equal(safeUrl({}), null);
  assert.equal(safeUrl(''), null);
  assert.equal(safeUrl('   '), null);
});

// ---------------------------------------------------------------------------
// nearestPrecedingCoords — walk-origin selection (item 3).
// ---------------------------------------------------------------------------

test('nearestPrecedingCoords returns the nearest preceding plan stop that has coords', () => {
  const plan = [
    { title: 'A', coords: { lat: 1, lng: 1 } },
    { title: 'B', coords: { lat: 2, lng: 2 } },
    { title: 'C' }, // current item (index 2) has no coords
  ];
  const origin = nearestPrecedingCoords(plan, 2, null);
  assert.deepEqual(origin.from, { lat: 2, lng: 2 });
  assert.equal(origin.label, 'B'); // nearest preceding, not the first
});

test('nearestPrecedingCoords skips preceding items lacking coords', () => {
  const plan = [
    { title: 'HasCoords', coords: { lat: 5, lng: 5 } },
    { title: 'NoCoords' },
    { title: 'AlsoNoCoords' },
    { title: 'Current' },
  ];
  const origin = nearestPrecedingCoords(plan, 3, null);
  assert.deepEqual(origin.from, { lat: 5, lng: 5 });
  assert.equal(origin.label, 'HasCoords');
});

test('nearestPrecedingCoords falls back to lodging coords when no plan stop precedes with coords', () => {
  const plan = [
    { title: 'NoCoords' },
    { title: 'Current' },
  ];
  const lodging = { name: 'Cross Hotel Kyoto', coords: { lat: 35.0, lng: 135.77 } };
  const origin = nearestPrecedingCoords(plan, 1, lodging);
  assert.deepEqual(origin.from, { lat: 35.0, lng: 135.77 });
  assert.equal(origin.label, 'Cross Hotel Kyoto');
});

test('nearestPrecedingCoords prefers a preceding plan stop over lodging when both exist', () => {
  const plan = [
    { title: 'Earlier stop', coords: { lat: 10, lng: 10 } },
    { title: 'Current' },
  ];
  const lodging = { name: 'Hotel', coords: { lat: 99, lng: 99 } };
  const origin = nearestPrecedingCoords(plan, 1, lodging);
  assert.deepEqual(origin.from, { lat: 10, lng: 10 }); // plan wins
  assert.equal(origin.label, 'Earlier stop');
});

test('nearestPrecedingCoords falls back to a default label when lodging has no name', () => {
  const lodging = { coords: { lat: 1, lng: 2 } }; // no name
  const origin = nearestPrecedingCoords([{ title: 'x' }, {}], 1, lodging);
  assert.equal(origin.label, 'your lodging');
});

test('nearestPrecedingCoords returns null when nothing precedes and lodging lacks coords', () => {
  assert.equal(nearestPrecedingCoords([{ title: 'only' }], 0, null), null);
  assert.equal(nearestPrecedingCoords([{ title: 'a' }, { title: 'b' }], 1, { name: 'no coords here' }), null);
});

test('nearestPrecedingCoords ignores malformed coords (non-numeric lat/lng)', () => {
  const plan = [
    { title: 'Bad', coords: { lat: '1', lng: 2 } }, // lat not a number → skipped
    { title: 'Current' },
  ];
  // No usable preceding coords and no lodging → null.
  assert.equal(nearestPrecedingCoords(plan, 1, null), null);
});

test('nearestPrecedingCoords falls back to a generic label when the preceding stop has coords but no title', () => {
  const plan = [
    { coords: { lat: 35.0, lng: 135.7 } }, // valid coords, no title
    { title: 'Current' },
  ];
  const result = nearestPrecedingCoords(plan, 1, null);
  assert.deepEqual(result.from, { lat: 35.0, lng: 135.7 });
  assert.equal(result.label, 'the previous stop'); // never literal "undefined"
});

// ---------------------------------------------------------------------------
// formatWalk — distance → human walk label (supports item 6's walk line).
// ---------------------------------------------------------------------------

test('formatWalk returns null for null / non-finite input', () => {
  assert.equal(formatWalk(null), null);
  assert.equal(formatWalk(undefined), null);
  assert.equal(formatWalk(NaN), null);
  assert.equal(formatWalk(Infinity), null);
});

test('formatWalk renders short distances in metres with a minute estimate', () => {
  const label = formatWalk(240); // 240 m / 80 m·min⁻¹ = 3 min
  assert.match(label, /m/);
  assert.match(label, /min walk/);
  assert.match(label, /3 min/);
});

test('formatWalk renders longer distances in kilometres', () => {
  const label = formatWalk(2435); // ≥ 950 m → km form
  assert.match(label, /2\.4 km/);
});

test('formatWalk clamps the walking time to a minimum of 1 minute', () => {
  assert.match(formatWalk(10), /1 min/); // 10 m would round to 0 min; clamped to 1
});

// ===========================================================================
// day-view-screen — DOM rendering (renderDay).
//
// This project has NO jsdom (dependency-free static site; CLAUDE.md mandates no
// npm). To assert renderDay's STRUCTURE (tags, classes, attributes, presence of
// the reservation badge / reminisce seam / placeholder / walk line) without a
// browser, we install a TINY hand-rolled DOM stub below: just enough of
// document.createElement + element to mirror what app.js's el()/renderDay touch
// (className, textContent, setAttribute, classList, hidden, appendChild,
// addEventListener, and the href/src/etc. property assignments).
//
// The stub is deliberately minimal and does NOT emulate a real browser: layout,
// CSS, crossfade animation, and actual navigation are out of scope here and are
// covered by the orchestrator's real-browser VERIFY-APP stage. What we CAN
// assert deterministically in Node is the DOM tree app.js builds.
// ===========================================================================

// --- Minimal DOM stub --------------------------------------------------------

class StubClassList {
  constructor() { this._set = new Set(); }
  add(...cs) { cs.forEach((c) => c && this._set.add(c)); }
  remove(...cs) { cs.forEach((c) => this._set.delete(c)); }
  toggle(c, force) {
    const want = force === undefined ? !this._set.has(c) : force;
    if (want) this._set.add(c); else this._set.delete(c);
    return want;
  }
  contains(c) { return this._set.has(c); }
  get _list() { return [...this._set]; }
}

class StubElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this._classList = new StubClassList();
    this._textContent = '';
    this.hidden = false;
  }
  // className mirrors classList (app.js sets node.className = 'a b c').
  get className() { return this._classList._list.join(' '); }
  set className(v) {
    this._classList = new StubClassList();
    String(v).split(/\s+/).forEach((c) => c && this._classList.add(c));
  }
  get classList() { return this._classList; }
  // textContent: setting replaces; reading aggregates own + descendants' text
  // (matches the DOM, so a subtree text search "just works" in assertions).
  set textContent(v) { this._textContent = String(v); this.children = []; }
  get textContent() {
    const own = this._textContent;
    const kids = this.children.map((c) => c.textContent).join('');
    return own + kids;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  // Test-only helper: fire a registered listener (for the rec-toggle click).
  _fire(type) { (this.listeners[type] || []).forEach((fn) => fn()); }
  // Test-only traversal helpers --------------------------------------------
  _all() {
    const out = [];
    const walk = (n) => { out.push(n); n.children.forEach(walk); };
    this.children.forEach(walk);
    return out;
  }
  query(predicate) { return this._all().find(predicate) ?? null; }
  queryAll(predicate) { return this._all().filter(predicate); }
  byClass(cls) { return this.queryAll((n) => n._classList.contains(cls)); }
  firstByClass(cls) { return this.query((n) => n._classList.contains(cls)); }
}

const stubDocument = {
  createElement(tag) { return new StubElement(tag); },
};

/**
 * Run a fn with a stub document (and optional window.matchMedia) installed on
 * globalThis, restoring the originals afterward. renderDay reads globalThis
 * `document` (via el()) and `window` (for prefers-reduced-motion), so this lets
 * us drive it deterministically in Node.
 */
function withDom(fn, { reduceMotion } = {}) {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = stubDocument;
  if (reduceMotion !== undefined) {
    globalThis.window = {
      matchMedia(q) {
        return { matches: reduceMotion && /prefers-reduced-motion/.test(q) };
      },
    };
  }
  try {
    return fn();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
}

// --- Shared fixtures (synthetic, schema-shaped) -----------------------------

function fullDayFixture() {
  return {
    date: '2026-06-24',
    dayNumber: 9,
    base: 'Kyoto',
    title: 'A full Kyoto day',
    intro: 'Gion and the river.',
    photos: [
      { url: 'https://example.com/a.jpg', alt: 'A' },
      { url: 'https://example.com/b.jpg', alt: 'B' },
      { url: 'https://example.com/c.jpg', alt: 'C' },
    ],
    lodging: {
      name: 'Cross Hotel Kyoto',
      address: 'Kawaramachi, Nakagyo-ku, Kyoto',
      mapUrl: 'https://maps.google.com/?q=Cross+Hotel+Kyoto',
      breakfast: 'Buffet from 7am',
      coords: { lat: 35.0047, lng: 135.7700 },
    },
    plan: [
      { time: '09:00', tag: 'sight', title: 'Yasaka Shrine', note: 'Lanterns.',
        mapUrl: 'https://maps.google.com/?q=Yasaka', coords: { lat: 35.0036, lng: 135.7785 } },
      { time: '20:00', tag: 'meal', title: 'Dinner at Tousuiro', reserved: true,
        note: 'Riverside terrace.',
        recommendations: [
          { name: 'Tousuiro Kiyamachi',
            pros: ['Riverside terrace', 'Vegetarian course'],
            con: 'Needs a reservation.',
            mapUrl: 'https://maps.google.com/?q=Tousuiro',
            coords: { lat: 35.0040, lng: 135.7710 } },
          { name: 'Omen (walk-in fallback)',
            pros: ['No reservation'],
            con: 'Tiny.',
            mapUrl: 'https://maps.google.com/?q=Omen' },
        ] },
    ],
  };
}

// --- Item 4: framing selection ----------------------------------------------

test('renderDay applies the framing modifier class for each of the three framings', () => {
  withDom(() => {
    const a = renderDay(fullDayFixture(), 'anticipation').node;
    const p = renderDay(fullDayFixture(), 'plan').node;
    const r = renderDay(fullDayFixture(), 'reminisce').node;
    assert.ok(a.classList.contains('framing-anticipation'));
    assert.ok(p.classList.contains('framing-plan'));
    assert.ok(r.classList.contains('framing-reminisce'));
  });
});

test('renderDay produces a distinct kicker per framing', () => {
  withDom(() => {
    const kicker = (f) => renderDay(fullDayFixture(), f).node.firstByClass('day-kicker').textContent;
    assert.equal(kicker('anticipation'), 'Coming up');
    assert.equal(kicker('plan'), 'Today');
    assert.equal(kicker('reminisce'), 'Looking back');
  });
});

test('renderDay applies a lead prefix on the intro for anticipation/reminisce but not plan', () => {
  withDom(() => {
    const prefix = (f) => {
      const node = renderDay(fullDayFixture(), f).node;
      const el = node.firstByClass('day-intro-prefix');
      return el ? el.textContent : null;
    };
    assert.match(prefix('anticipation'), /What's ahead:/);
    assert.match(prefix('reminisce'), /Remember:/);
    assert.equal(prefix('plan'), null); // plan framing has no lead prefix
  });
});

test('renderDay defaults to the plan framing when given an unknown framing name', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'not-a-framing').node;
    assert.ok(node.classList.contains('framing-plan'));
    assert.equal(node.firstByClass('day-kicker').textContent, 'Today');
  });
});

// --- Item 4 (cont.): reminisce seam present only in reminisce ----------------

test('renderDay includes the reminisce photo seam ONLY in the reminisce framing', () => {
  withDom(() => {
    assert.ok(renderDay(fullDayFixture(), 'reminisce').node.firstByClass('reminisce-seam'),
      'reminisce framing should include the photo seam');
    assert.equal(renderDay(fullDayFixture(), 'anticipation').node.firstByClass('reminisce-seam'), null);
    assert.equal(renderDay(fullDayFixture(), 'plan').node.firstByClass('reminisce-seam'), null);
  });
});

test("renderDay's plan heading copy varies by framing", () => {
  withDom(() => {
    const heading = (f) => renderDay(fullDayFixture(), f).node.firstByClass('section-heading').textContent;
    assert.equal(heading('anticipation'), 'The plan');
    assert.equal(heading('plan'), 'The plan');
    assert.equal(heading('reminisce'), 'How the day went');
  });
});

// --- Item 5: sparse + absent day placeholders --------------------------------

test('renderDay renders the "details coming" placeholder for an absent (null) day without throwing', () => {
  withDom(() => {
    let result;
    assert.doesNotThrow(() => { result = renderDay(null, 'plan'); });
    const node = result.node;
    assert.ok(node.classList.contains('day-view-empty'));
    const ph = node.firstByClass('placeholder-title');
    assert.ok(ph);
    assert.equal(ph.textContent, 'Details coming');
    // The controller is still well-formed (no-op timer handles).
    assert.equal(typeof result.start, 'function');
    assert.equal(typeof result.stop, 'function');
    assert.doesNotThrow(() => { result.start(); result.stop(); });
  });
});

test('renderDay renders the placeholder for a non-object day argument', () => {
  withDom(() => {
    for (const bad of [undefined, 42, 'nope']) {
      const node = renderDay(bad, 'plan').node;
      assert.ok(node.classList.contains('day-view-empty'), `expected empty state for ${String(bad)}`);
    }
  });
});

test('renderDay renders the sparse-day placeholder (empty plan + photos) and no plan/lodging', () => {
  withDom(() => {
    const sparse = {
      date: '2026-06-25', dayNumber: 10, base: 'Kyoto', title: 'A quiet day',
      intro: 'Nothing planned yet.', photos: [], plan: [], lodging: null,
    };
    const node = renderDay(sparse, 'plan').node;
    // Header still renders (title/kicker), but the plan section is absent and a
    // placeholder explains the day isn't filled in.
    assert.equal(node.firstByClass('day-title').textContent, 'A quiet day');
    assert.equal(node.firstByClass('placeholder-title').textContent, 'Details coming');
    assert.equal(node.firstByClass('plan-section'), null, 'sparse day should have no plan section');
    assert.equal(node.firstByClass('lodging-card'), null, 'sparse day should have no lodging card');
  });
});

test('renderDay does not throw on a sparse day and returns usable timer handles', () => {
  withDom(() => {
    const sparse = { date: '2026-06-25', title: 'x', photos: [], plan: [], lodging: null };
    let r;
    assert.doesNotThrow(() => { r = renderDay(sparse, 'plan'); });
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
});

// --- Item 1 (acceptance): the core day renders its parts ---------------------

test('renderDay renders hero, header, plan list, and lodging card for a full day', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'plan').node;
    assert.ok(node.firstByClass('day-hero'), 'hero present');
    assert.ok(node.firstByClass('day-header'), 'header present');
    assert.ok(node.firstByClass('plan-list'), 'plan list present');
    assert.ok(node.firstByClass('lodging-card'), 'lodging card present');
    // dayNumber + base surface in the kicker row.
    assert.equal(node.firstByClass('day-number').textContent, 'Day 9');
    assert.equal(node.firstByClass('day-base').textContent, 'Kyoto');
  });
});

test('renderDay renders one plan item per plan entry', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'plan').node;
    assert.equal(node.byClass('plan-item').length, 2);
  });
});

test('renderDay renders the lodging breakfast note when present', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'plan').node;
    const bf = node.firstByClass('lodging-breakfast');
    assert.ok(bf);
    assert.match(bf.textContent, /Buffet from 7am/);
  });
});

// --- Item 4 (acceptance): map links are safe external links ------------------

test('renderDay map links carry target=_blank and rel=noopener noreferrer', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'plan').node;
    const links = node.byClass('map-link');
    assert.ok(links.length > 0, 'expected at least one map link');
    for (const a of links) {
      assert.equal(a.tagName, 'A');
      assert.equal(a.target, '_blank');
      assert.equal(a.rel, 'noopener noreferrer');
      assert.match(a.href, /^https?:/);
    }
  });
});

test('map links are icon-only: no visible label text, but aria-label preserved', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'plan').node;
    const links = node.byClass('map-link');
    assert.ok(links.length > 0, 'expected at least one map link');
    for (const a of links) {
      assert.equal(a.textContent, '', 'map link must have no body text (icon comes from CSS ::before)');
      const aria = a.getAttribute('aria-label');
      assert.ok(aria && aria.length > 0, 'map link must carry an aria-label for screen readers');
    }
  });
});

test('renderDay omits a map link whose URL has a dangerous scheme (safeUrl gate via DOM)', () => {
  withDom(() => {
    const day = fullDayFixture();
    day.plan[0].mapUrl = 'javascript:alert(1)'; // must be dropped, not rendered
    day.plan[1].recommendations = []; // simplify
    const node = renderDay(day, 'plan').node;
    // No map-link should point at a javascript: URL.
    const bad = node.byClass('map-link').find((a) => /javascript:/i.test(a.href || ''));
    assert.equal(bad, undefined, 'a javascript: map URL must never reach an href');
  });
});

test('renderDay drops a hero photo whose url has a dangerous scheme (img src gate)', () => {
  withDom(() => {
    const day = fullDayFixture();
    day.photos = [
      { url: 'javascript:alert(1)', alt: 'evil' },
      { url: 'https://example.com/ok.jpg', alt: 'ok' },
    ];
    const node = renderDay(day, 'plan').node;
    const imgs = node.queryAll((n) => n.tagName === 'IMG');
    assert.ok(imgs.length >= 1);
    for (const img of imgs) {
      assert.ok(!/javascript:/i.test(img.src || ''), 'a javascript: photo url must never reach an img src');
    }
  });
});

// --- Item 7: reservation highlighting ---------------------------------------

test('renderDay marks a reserved plan item with the reserved class and a "Reserved" badge', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'plan').node;
    const reserved = node.byClass('plan-item-reserved');
    assert.equal(reserved.length, 1, 'exactly one reserved item in the fixture');
    const badge = node.firstByClass('plan-reserved-badge');
    assert.ok(badge, 'reserved item shows a Reserved badge');
    assert.equal(badge.textContent, 'Reserved');
  });
});

test('renderDay does NOT mark non-reserved plan items as reserved', () => {
  withDom(() => {
    const day = fullDayFixture();
    // Make every item non-reserved.
    day.plan.forEach((it) => { delete it.reserved; });
    const node = renderDay(day, 'plan').node;
    assert.equal(node.byClass('plan-item-reserved').length, 0);
    assert.equal(node.firstByClass('plan-reserved-badge'), null);
  });
});

// --- Item 5/6: recommendation expansion + walk distance ----------------------

test('renderDay renders a recommendation toggle (collapsed) for items with recommendations', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'plan').node;
    const toggle = node.firstByClass('rec-toggle');
    assert.ok(toggle, 'expected a rec toggle button');
    assert.equal(toggle.tagName, 'BUTTON');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false'); // collapsed initially
    const panel = node.firstByClass('rec-panel');
    assert.ok(panel);
    assert.equal(panel.hidden, true); // panel starts hidden
  });
});

test('clicking the rec toggle expands the panel and flips aria-expanded', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'plan').node;
    const toggle = node.firstByClass('rec-toggle');
    const panel = node.firstByClass('rec-panel');
    toggle._fire('click');
    assert.equal(panel.hidden, false, 'panel should open on click');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.ok(toggle.classList.contains('is-open'));
    // Toggling again collapses it.
    toggle._fire('click');
    assert.equal(panel.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  });
});

test('renderDay renders each recommendation card with name, pros, and con', () => {
  withDom(() => {
    const node = renderDay(fullDayFixture(), 'plan').node;
    const cards = node.byClass('rec-card');
    assert.equal(cards.length, 2, 'two recommendations in the fixture');
    const names = node.byClass('rec-name').map((n) => n.textContent);
    assert.ok(names.includes('Tousuiro Kiyamachi'));
    assert.ok(names.includes('Omen (walk-in fallback)'));
    assert.ok(node.byClass('rec-pro').length >= 2, 'pros rendered');
    assert.ok(node.byClass('rec-con').length >= 1, 'cons rendered');
  });
});

test('renderDay shows a walking-distance line when both origin and recommendation have coords (item 6)', () => {
  withDom(() => {
    // Fixture: plan[0] Yasaka has coords (origin), rec[0] Tousuiro has coords.
    const node = renderDay(fullDayFixture(), 'plan').node;
    const walks = node.byClass('rec-walk');
    assert.ok(walks.length >= 1, 'expected a walk line for the coord-bearing recommendation');
    const walk = walks[0];
    assert.match(walk.textContent, /min walk/);
    // The "from <origin label>" suffix names the preceding stop with coords.
    assert.match(walk.textContent, /from Yasaka Shrine/);
  });
});

test('renderDay omits the walking-distance line when the recommendation has no coords (item 6)', () => {
  withDom(() => {
    // rec[1] Omen has NO coords → no walk line for it. The fixture has exactly
    // one coord-bearing rec, so there should be exactly one walk line total.
    const node = renderDay(fullDayFixture(), 'plan').node;
    assert.equal(node.byClass('rec-walk').length, 1);
  });
});

test('renderDay omits ALL walk lines when there is no usable origin (no preceding coords, no lodging coords)', () => {
  withDom(() => {
    const day = fullDayFixture();
    // Strip coords from the preceding stop AND lodging → no origin to measure from.
    delete day.plan[0].coords;
    day.lodging.coords = undefined;
    const node = renderDay(day, 'plan').node;
    assert.equal(node.byClass('rec-walk').length, 0);
  });
});

// --- Item 2 / 8: slideshow + reduced-motion ----------------------------------

test('renderDay (motion allowed) renders all valid hero slides and a start()/stop() that cycle without throwing', () => {
  withDom(() => {
    const ctl = renderDay(fullDayFixture(), 'plan');
    const slides = ctl.node.byClass('hero-slide');
    assert.equal(slides.length, 3, 'all three valid photos become slides when motion is allowed');
    // First slide active initially.
    assert.ok(slides[0].classList.contains('is-active'));
    // start() begins the interval; stop() clears it — neither should throw, and
    // we must not leak a live interval out of the test.
    assert.doesNotThrow(() => ctl.start());
    assert.doesNotThrow(() => ctl.stop());
  }, { reduceMotion: false });
});

test('renderDay under prefers-reduced-motion renders a SINGLE slide and start() is a no-op (item 8)', () => {
  withDom(() => {
    const ctl = renderDay(fullDayFixture(), 'plan');
    const slides = ctl.node.byClass('hero-slide');
    assert.equal(slides.length, 1, 'reduced-motion collapses the slideshow to one static slide');
    // No timer should be started; start()/stop() must be safe no-ops. If a real
    // setInterval were created here it would keep the Node process alive and the
    // test runner would hang — so a clean exit is itself part of the assertion.
    assert.doesNotThrow(() => { ctl.start(); ctl.stop(); });
  }, { reduceMotion: true });
});

test('renderDay renders an empty-hero placeholder (role=img) when a day has no valid photos', () => {
  withDom(() => {
    const day = fullDayFixture();
    day.photos = []; // no photos (plan is still populated, so the day isn't "sparse")
    const node = renderDay(day, 'plan').node;
    const hero = node.firstByClass('day-hero');
    assert.ok(hero.classList.contains('day-hero-empty'));
    assert.equal(hero.getAttribute('role'), 'img');
    assert.ok(node.byClass('hero-slide').length === 0, 'no slides when there are no photos');
  });
});

// ===========================================================================
// DATE/TIME-AWARE NAVIGATION (date-time-aware-navigation task)
//
// Covers the lifecycle + landing logic that drives the clock-aware experience:
//   getNow / setNow (clock seam), frameForDay, isEveningWindow,
//   pickLandingView, tripWindowDates, and the mountApp nav controller.
//
// DETERMINISM: every test that depends on "now" pins it via setNow() (or passes
// `now` explicitly to the pure fn). The pure lifecycle fns compare by LOCAL
// calendar day / local hour (getFullYear/getMonth/getDate/getHours), so the
// fixture Dates are built with the LOCAL Date constructor — e.g.
// `new Date(2026, 5, 25, 23, 59)` is unambiguously local midnight-minus-one and
// is interpreted identically regardless of the machine's timezone.
//
// Each block that calls setNow restores the wall clock with setNow(null) in a
// teardown so clock state never leaks across tests.
// ===========================================================================

/** Build a Date in LOCAL time. monthIndex is 0-based (5 = June). */
function localDate(y, monthIndex, d, h = 0, min = 0) {
  return new Date(y, monthIndex, d, h, min, 0, 0);
}

// --- getNow / setNow (clock seam) -------------------------------------------

test('setNow pins getNow to a fixed instant; setNow(null) restores the wall clock', () => {
  try {
    const pinned = localDate(2026, 5, 25, 12, 0);
    setNow(() => pinned);
    assert.equal(getNow().getTime(), pinned.getTime());
    // A second read returns the same pinned instant (no drift).
    assert.equal(getNow().getTime(), pinned.getTime());
  } finally {
    setNow(null);
  }
  // Restored: getNow now tracks the real clock (close to Date.now()).
  const drift = Math.abs(getNow().getTime() - Date.now());
  assert.ok(drift < 1000, 'wall clock restored after setNow(null)');
});

test('getNow falls back to the wall clock when the override returns a non-Date / invalid value', () => {
  try {
    setNow(() => 'not a date');
    const drift = Math.abs(getNow().getTime() - Date.now());
    assert.ok(drift < 1000, 'invalid provider result → wall clock');
    setNow(() => new Date(NaN));
    const drift2 = Math.abs(getNow().getTime() - Date.now());
    assert.ok(drift2 < 1000, 'NaN Date from provider → wall clock');
  } finally {
    setNow(null);
  }
});

test('getNow falls back to the wall clock when the override THROWS', () => {
  try {
    setNow(() => { throw new Error('clock blew up'); });
    const d = getNow();
    assert.ok(d instanceof Date && !Number.isNaN(d.getTime()), 'throwing provider → valid Date');
    const drift = Math.abs(d.getTime() - Date.now());
    assert.ok(drift < 1000, 'throwing provider → wall clock, no propagated exception');
  } finally {
    setNow(null);
  }
});

// --- frameForDay: calendar-day boundaries -----------------------------------

test('frameForDay returns "plan" when the day is the same local calendar day (delta 0)', () => {
  // now is 23:59 on the same calendar day as the target — still delta 0.
  const now = localDate(2026, 5, 25, 23, 59);
  assert.equal(frameForDay('2026-06-25', now), 'plan');
  // ...and at 00:00 of that calendar day too.
  assert.equal(frameForDay('2026-06-25', localDate(2026, 5, 25, 0, 0)), 'plan');
});

test('frameForDay returns "anticipation" the instant before local midnight of a future day (delta +1)', () => {
  // 2026-06-24 23:59 local, target 2026-06-25 → tomorrow → anticipation.
  const now = localDate(2026, 5, 24, 23, 59);
  assert.equal(frameForDay('2026-06-25', now), 'anticipation');
});

test('frameForDay flips to "plan" the instant after local midnight (delta +1 → 0 at 00:00)', () => {
  // One minute later than the case above — now it IS 2026-06-25 → plan.
  const now = localDate(2026, 5, 25, 0, 0);
  assert.equal(frameForDay('2026-06-25', now), 'plan');
});

test('frameForDay returns "reminisce" once a full calendar day has passed (delta -1 at 00:00)', () => {
  // 2026-06-26 00:00 local, target 2026-06-25 → yesterday → reminisce.
  const now = localDate(2026, 5, 26, 0, 0);
  assert.equal(frameForDay('2026-06-25', now), 'reminisce');
});

test('frameForDay accepts a day OBJECT (reads .date) and an ISO STRING identically', () => {
  const now = localDate(2026, 5, 25, 10, 0);
  const dayObj = { date: '2026-06-26', title: 'whatever' };
  assert.equal(frameForDay(dayObj, now), 'anticipation', 'object form, future day');
  assert.equal(frameForDay('2026-06-26', now), 'anticipation', 'ISO form, future day');
  assert.equal(frameForDay({ date: '2026-06-24' }, now), 'reminisce', 'object form, past day');
});

test('frameForDay falls back to "plan" for missing / unparseable input', () => {
  const now = localDate(2026, 5, 25, 10, 0);
  assert.equal(frameForDay(null, now), 'plan');
  assert.equal(frameForDay(undefined, now), 'plan');
  assert.equal(frameForDay({}, now), 'plan', 'object with no .date');
  assert.equal(frameForDay('not-a-date', now), 'plan');
  assert.equal(frameForDay('2026-13-99', now), 'plan', 'impossible calendar date');
});

test('frameForDay uses getNow() (the clock seam) when no explicit now is passed', () => {
  try {
    setNow(() => localDate(2026, 5, 24, 12, 0)); // pin "now" to Jun 24
    assert.equal(frameForDay('2026-06-25'), 'anticipation');
    assert.equal(frameForDay('2026-06-24'), 'plan');
    assert.equal(frameForDay('2026-06-23'), 'reminisce');
  } finally {
    setNow(null);
  }
});

// --- isEveningWindow: midnight-wrap boundaries ------------------------------

test('isEveningWindow honors the wrapping TRIP.eveningWindow (21:00–04:00) at exact boundaries', () => {
  const at = (h, m = 0) => isEveningWindow(localDate(2026, 5, 25, h, m));
  assert.equal(at(20, 59), false, '20:59 is before the window');
  assert.equal(at(21, 0), true, '21:00 opens the window');
  assert.equal(at(23, 59), true, '23:59 still in window');
  assert.equal(at(0, 0), true, 'midnight still in window (wraps)');
  assert.equal(at(3, 59), true, '03:59 still in window');
  assert.equal(at(4, 0), false, '04:00 closes the window');
  assert.equal(at(14, 0), false, 'midday is out of the window');
});

test('isEveningWindow returns false for an invalid / missing now', () => {
  assert.equal(isEveningWindow(new Date(NaN)), false);
  assert.equal(isEveningWindow(null), false);
  assert.equal(isEveningWindow('21:00'), false, 'non-Date input');
});

test('isEveningWindow supports an explicit NON-wrapping window (start < end)', () => {
  const win = { startHour: 9, endHour: 17 }; // a same-day 9am–5pm window
  assert.equal(isEveningWindow(localDate(2026, 5, 25, 8, 59), win), false);
  assert.equal(isEveningWindow(localDate(2026, 5, 25, 9, 0), win), true);
  assert.equal(isEveningWindow(localDate(2026, 5, 25, 16, 59), win), true);
  assert.equal(isEveningWindow(localDate(2026, 5, 25, 17, 0), win), false);
  assert.equal(isEveningWindow(localDate(2026, 5, 25, 0, 0), win), false, 'midnight is OUT of a non-wrapping daytime window');
});

test('isEveningWindow treats a degenerate window (start === end) as empty (always false)', () => {
  const win = { startHour: 12, endHour: 12 };
  assert.equal(isEveningWindow(localDate(2026, 5, 25, 12, 0), win), false);
  assert.equal(isEveningWindow(localDate(2026, 5, 25, 0, 0), win), false);
});

test('isEveningWindow returns false when the window hours are non-finite/missing', () => {
  assert.equal(isEveningWindow(localDate(2026, 5, 25, 22, 0), { startHour: NaN, endHour: 4 }), false);
  assert.equal(isEveningWindow(localDate(2026, 5, 25, 22, 0), {}), false);
});

// --- pickLandingView: three phases ------------------------------------------

test('pickLandingView BEFORE the trip → overview with a correct daysUntil countdown', () => {
  // Trip starts 2026-06-16. now = 2026-05-24 → 23 days until Day 1.
  const view = pickLandingView(localDate(2026, 4, 24, 12, 0));
  assert.equal(view.view, 'overview');
  assert.equal(view.day, null);
  assert.equal(view.daysUntil, 23, '2026-06-16 minus 2026-05-24 = 23 calendar days');
});

test('pickLandingView daysUntil is 1 on the eve of the trip and the start day lands DURING (not before)', () => {
  // 2026-06-15 → 1 day until start.
  const eve = pickLandingView(localDate(2026, 5, 15, 9, 0));
  assert.equal(eve.view, 'overview');
  assert.equal(eve.daysUntil, 1);
  // 2026-06-16 (TRIP.start) is inclusive → during the trip, not before.
  const day1 = pickLandingView(localDate(2026, 5, 16, 9, 0));
  assert.equal(day1.view, 'day');
});

test('pickLandingView DURING the trip on an AUTHORED day → that day in "plan" framing', () => {
  // 2026-06-24 is authored (Day 9).
  const view = pickLandingView(localDate(2026, 5, 24, 10, 0));
  assert.equal(view.view, 'day');
  assert.equal(view.framing, 'plan', 'same calendar day → plan');
  assert.ok(view.day, 'authored day is present');
  assert.equal(view.day.date, '2026-06-24');
  assert.equal(view.day.dayNumber, 9);
});

test('pickLandingView DURING the trip on an ABSENT day (Jun 16–23 leg) → day descriptor with null day, "plan" framing', () => {
  // 2026-06-18 is within [start,end] but NOT authored → getDay returns null.
  // pickLandingView still returns a 'day' descriptor (renderDay draws the
  // "Details coming" placeholder); framing is 'plan' because it's the same
  // calendar day as `now`.
  const view = pickLandingView(localDate(2026, 5, 18, 10, 0));
  assert.equal(view.view, 'day');
  assert.equal(view.day, null, 'unauthored day has no data');
  assert.equal(view.framing, 'plan');
});

test('pickLandingView AFTER the trip → last authored day (Jul 3) in "reminisce" framing', () => {
  // 2026-07-10 is past TRIP.end (2026-07-03).
  const view = pickLandingView(localDate(2026, 6, 10, 10, 0));
  assert.equal(view.view, 'day');
  assert.equal(view.framing, 'reminisce');
  assert.ok(view.day, 'lands on a real day');
  assert.equal(view.day.date, '2026-07-03', 'the last authored day');
  assert.equal(view.day.dayNumber, 18);
});

test('pickLandingView treats TRIP.end as inclusive (last trip day is DURING, not after)', () => {
  // 2026-07-03 is the end date → during the trip → that day, plan framing.
  const view = pickLandingView(localDate(2026, 6, 3, 10, 0));
  assert.equal(view.view, 'day');
  assert.equal(view.day?.date, '2026-07-03');
  assert.equal(view.framing, 'plan');
});

test('pickLandingView uses getNow() (the clock seam) when no explicit now is passed', () => {
  try {
    setNow(() => localDate(2026, 4, 24, 12, 0)); // before the trip
    const view = pickLandingView();
    assert.equal(view.view, 'overview');
    assert.equal(view.daysUntil, 23);
  } finally {
    setNow(null);
  }
});

// --- tripWindowDates --------------------------------------------------------

test('tripWindowDates enumerates all 18 calendar days, sorted, contiguous, inclusive', () => {
  const dates = tripWindowDates();
  assert.equal(dates.length, 18, 'Jun 16 … Jul 3 inclusive = 18 days');
  assert.equal(dates[0], '2026-06-16', 'first = TRIP.start');
  assert.equal(dates[dates.length - 1], '2026-07-03', 'last = TRIP.end');
  // Strictly ascending and exactly one calendar day apart (no gaps/dupes).
  // utcMidnight() returns epoch ms (a number), so subtract directly.
  for (let i = 1; i < dates.length; i++) {
    const delta = (utcMidnight(dates[i]) - utcMidnight(dates[i - 1])) / MS_PER_DAY;
    assert.equal(delta, 1, `contiguous step at index ${i}`);
  }
});

test('tripWindowDates spans the authored leg correctly (Jun 24 present, day count math holds)', () => {
  const dates = tripWindowDates();
  assert.ok(dates.includes('2026-06-24'), 'authored leg start is in the window');
  assert.ok(dates.includes('2026-06-18'), 'unauthored leg day is still in the window');
});

test('tripWindowDates returns [] for an inverted window (end before start)', () => {
  assert.deepEqual(tripWindowDates({ start: '2026-07-03', end: '2026-06-16' }), []);
});

test('tripWindowDates returns [] for an unparseable window', () => {
  assert.deepEqual(tripWindowDates({ start: 'nope', end: '2026-07-03' }), []);
  assert.deepEqual(tripWindowDates({ start: '2026-06-16', end: 'nope' }), []);
  assert.deepEqual(tripWindowDates({}), []);
});

test('tripWindowDates returns a single date when start === end', () => {
  assert.deepEqual(tripWindowDates({ start: '2026-06-20', end: '2026-06-20' }), ['2026-06-20']);
});

// --- mountApp: navigation, clamping, slideshow cleanup ----------------------
//
// These drive the controller through the existing DOM stub. To prove the
// slideshow timers are managed (no orphaned intervals across navigations) we
// install spy setInterval/clearInterval. Real crossfade timing is NOT under
// test here (covered by the browser VERIFY-APP stage) — we only assert that
// every interval the controller starts is later cleared.

/**
 * Run `fn` with spy timers installed on globalThis. Each setInterval returns a
 * unique id and is recorded; clearInterval records the cleared id. Returns the
 * live set of un-cleared interval ids so a test can assert none leaked. Timers
 * never actually fire (we don't want the slideshow to tick during a unit test).
 */
function withTimerSpies(fn) {
  const prevSet = globalThis.setInterval;
  const prevClear = globalThis.clearInterval;
  let seq = 0;
  const live = new Set();
  globalThis.setInterval = () => { const id = ++seq; live.add(id); return id; };
  globalThis.clearInterval = (id) => { live.delete(id); };
  try {
    return fn(live);
  } finally {
    globalThis.setInterval = prevSet;
    globalThis.clearInterval = prevClear;
  }
}

/** A stub root element (reuses StubElement) the controller mounts into. */
function makeRoot() { return new StubElement('main'); }

test('mountApp returns a controller ({go, toIso, destroy}) and mounts a nav bar', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 5, 24, 12, 0)); // during the trip (authored day)
        const root = makeRoot();
        const ctl = mountApp(root);
        assert.ok(ctl && typeof ctl.go === 'function' && typeof ctl.toIso === 'function' && typeof ctl.destroy === 'function');
        assert.ok(root.firstByClass('day-nav'), 'a day-nav bar is mounted');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp returns undefined and does not throw when called without a root element', () => {
  // Silence the expected warn from the guard.
  const warned = captureWarnings(() => {
    assert.equal(mountApp(null), undefined);
    assert.equal(mountApp(undefined), undefined);
  });
  assert.ok(warned >= 2, 'guard warns for each missing root');
});

test('mountApp clamps PREV at index 0 (Prev disabled on the first window day, no underflow)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        // Land on the first window day (Jun 16) by pinning now to it.
        setNow(() => localDate(2026, 5, 16, 12, 0));
        const root = makeRoot();
        const ctl = mountApp(root);
        const prev = root.firstByClass('day-nav-prev');
        assert.equal(prev.disabled, true, 'Prev is disabled at index 0');
        const pos = root.firstByClass('day-nav-pos').textContent;
        assert.equal(pos, 'Day 1', 'position label shows Day 1 at the window start');
        // Clicking the (disabled) Prev / navigating below 0 is a clamped no-op:
        // still on Day 1, still no crash.
        ctl.go(-5);
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 1', 'clamped to Day 1, no underflow');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp clamps NEXT at the last index (Next disabled on the final window day, no overflow)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        // Land on the last window day (Jul 3, Day 18).
        setNow(() => localDate(2026, 6, 3, 12, 0));
        const root = makeRoot();
        const ctl = mountApp(root);
        const next = root.firstByClass('day-nav-next');
        assert.equal(next.disabled, true, 'Next is disabled at the last index');
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 18');
        // Navigating beyond the end is a clamped no-op.
        ctl.go(999);
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 18', 'clamped to Day 18, no overflow');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp Next button advances one day; Prev is enabled once off the first day', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 5, 16, 12, 0)); // start on Day 1
        const root = makeRoot();
        mountApp(root);
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 1');
        // Fire the Next button's click listener (drives navigate(index+1)).
        root.firstByClass('day-nav-next')._fire('click');
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 2', 'advanced to Day 2');
        assert.equal(root.firstByClass('day-nav-prev').disabled, false, 'Prev enabled once off Day 1');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp does NOT leak slideshow intervals across navigations (prior view stop() is called)', () => {
  withDom(() => {
    withTimerSpies((live) => {
      try {
        // Pin to an authored, multi-photo day so the slideshow actually starts a
        // timer (Jun 24 has 2 photos). Cycling requires >1 photo + no reduce-motion.
        setNow(() => localDate(2026, 5, 24, 12, 0));
        const root = makeRoot();
        const ctl = mountApp(root);
        // One live interval after the initial mount (the active day-view's slideshow).
        assert.equal(live.size, 1, 'initial mount starts exactly one slideshow interval');
        // Navigate to several other authored days; each re-render must stop the
        // previous slideshow before starting the next → never more than one live.
        ctl.toIso('2026-06-25');
        assert.equal(live.size, 1, 'after nav, prior interval cleared (no leak)');
        ctl.toIso('2026-06-26');
        assert.equal(live.size, 1, 'still exactly one live interval');
        // destroy() must clear the last remaining interval.
        ctl.destroy();
        assert.equal(live.size, 0, 'destroy() stops the active slideshow');
        assert.equal(root.children.length, 0, 'destroy() clears the root');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp on a multi-photo day with reduce-motion starts NO interval (nothing to leak)', () => {
  withDom(() => {
    withTimerSpies((live) => {
      try {
        setNow(() => localDate(2026, 5, 24, 12, 0));
        const root = makeRoot();
        mountApp(root);
        assert.equal(live.size, 0, 'reduce-motion: a single static image, no slideshow timer');
      } finally {
        setNow(null);
      }
    });
  }, { reduceMotion: true });
});

test('mountApp BEFORE the trip mounts the overview (countdown), not a day view', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 4, 24, 12, 0)); // before the trip
        const root = makeRoot();
        mountApp(root);
        assert.ok(root.firstByClass('overview-view'), 'overview is mounted before the trip');
        assert.equal(root.firstByClass('day-nav'), null, 'no day-nav chrome on the overview');
        // The countdown reflects pickLandingView.daysUntil (23 on 2026-05-24).
        assert.equal(root.firstByClass('overview-count-num').textContent, '23');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp shows the evening "Prep for tomorrow" CTA inside the evening window only', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        // 22:00 on Jun 24 → inside the 21:00–04:00 window → prep CTA present.
        setNow(() => localDate(2026, 5, 24, 22, 0));
        const evening = makeRoot();
        mountApp(evening);
        assert.ok(evening.firstByClass('evening-prep'), 'evening window → prep section shown');

        // 14:00 on Jun 24 → outside the window → no prep CTA.
        setNow(() => localDate(2026, 5, 24, 14, 0));
        const midday = makeRoot();
        mountApp(midday);
        assert.equal(midday.firstByClass('evening-prep'), null, 'midday → no prep section');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp evening "Prep for tomorrow" CTA NAVIGATES to the next day when clicked', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        // 22:00 on Jun 24 (Day 9) → in the evening window → prep CTA points at Jun 25.
        setNow(() => localDate(2026, 5, 24, 22, 0));
        const root = makeRoot();
        mountApp(root);
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 9', 'starts on Jun 24');
        const cta = root.firstByClass('evening-prep-cta');
        assert.ok(cta, 'evening prep CTA present');
        // Clicking the CTA must move the day view to tomorrow (Day 10 / Jun 25).
        cta._fire('click');
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 10', 'CTA navigated to the next day');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp evening prep surfaces TOMORROW\'s prep list (next day\'s notes, not today\'s)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        // On Jun 24 in-window, the prep section should reflect Jun 25's content.
        setNow(() => localDate(2026, 5, 24, 22, 0));
        const root = makeRoot();
        mountApp(root);
        const dayLabel = root.firstByClass('evening-prep-day');
        assert.ok(dayLabel, 'prep section names tomorrow');
        assert.equal(dayLabel.textContent, getDay('2026-06-25').title,
          'prep section shows the NEXT day\'s title');
        // Tomorrow (Jun 25) is authored with a non-empty prep list → list rendered, not the empty note.
        assert.ok(root.firstByClass('evening-prep-list'), 'tomorrow\'s prep list is rendered');
        assert.equal(root.firstByClass('evening-prep-empty'), null, 'no "nothing to prep" note when tomorrow has prep');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp on the LAST day (Jul 3) in the evening window shows NO prep CTA (no tomorrow in-window)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        // 22:00 on Jul 3 (Day 18, the final window day) → in the evening window,
        // but there is no day after it → buildEveningPrep returns null → no section.
        setNow(() => localDate(2026, 6, 3, 22, 0));
        const root = makeRoot();
        mountApp(root);
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 18', 'on the last window day');
        assert.equal(root.firstByClass('day-nav-next').disabled, true, 'Next clamped at the last day');
        assert.equal(root.firstByClass('evening-prep'), null,
          'no prep section on the last day — there is no tomorrow to prep for');
      } finally {
        setNow(null);
      }
    });
  });
});

test('mountApp evening prep CTA is suppressed once you navigate OFF today (tomorrow is meaningful only vs the real current day)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        // 22:00 on Jun 24 (Day 9 = today) → CTA shows on the landing (today) view.
        setNow(() => localDate(2026, 5, 24, 22, 0));
        const root = makeRoot();
        const ctrl = mountApp(root);
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 9', 'lands on today');
        assert.ok(root.firstByClass('evening-prep'), 'CTA present on today in the evening window');

        // Page forward to a FUTURE day (still 22:00) → "tomorrow" no longer means
        // the day after this one, so the CTA must be gone.
        ctrl.toIso('2026-06-26'); // Day 11
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 11', 'navigated to a future day');
        assert.equal(root.firstByClass('evening-prep'), null,
          'no prep CTA when viewing a non-today day in the evening window');

        // And back to today → CTA returns.
        ctrl.toIso('2026-06-24'); // back to today (Day 9)
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 9', 'back on today');
        assert.ok(root.firstByClass('evening-prep'), 'CTA reappears on today');
      } finally {
        setNow(null);
      }
    });
  });
});

test('frameForDay frames an ABSENT day (unauthored Jun 16–23 leg) purely by its calendar date', () => {
  // 2026-06-18 has no authored data (getDay → null), but frameForDay works off
  // the ISO date alone, so the lifecycle framing is still correct relative to now.
  assert.equal(getDay('2026-06-18'), null, 'precondition: Jun 18 is unauthored');
  assert.equal(frameForDay('2026-06-18', localDate(2026, 5, 17, 12, 0)), 'anticipation', 'before that calendar day');
  assert.equal(frameForDay('2026-06-18', localDate(2026, 5, 18, 12, 0)), 'plan', 'on that calendar day');
  assert.equal(frameForDay('2026-06-18', localDate(2026, 5, 19, 12, 0)), 'reminisce', 'after that calendar day');
});

// ===========================================================================
// trip-overview-home — the pre-trip home (countdown header + tappable 18-day
// index). renderOverview is exported for tests so all three countdown states
// (before / during / after) can be exercised directly — the during-trip branch
// is unreachable through mountApp (pickLandingView never lands on the overview
// mid-trip). The reachable before-trip path is also driven end-to-end through
// mountApp + the DOM stub. Determinism: every test pins `now` via setNow and
// restores the wall clock in a finally.
// ===========================================================================

// --- Countdown header: three states (driven by daysUntil + getNow) ----------

test('renderOverview BEFORE the trip shows an "N days until the trip" countdown', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0)); // 2026-05-24, before the trip
      const { node } = renderOverview(23, () => {});
      assert.equal(node.firstByClass('overview-count-num').textContent, '23');
      assert.equal(node.firstByClass('overview-count-label').textContent, 'days until the trip');
      // No "underway"/"complete" copy on the before-trip header.
      assert.equal(node.firstByClass('overview-kicker').textContent, 'Counting down');
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview pluralizes the countdown label: "day" at 1, "days" otherwise', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 5, 15, 9, 0)); // eve of the trip
      const one = renderOverview(1, () => {}).node;
      assert.equal(one.firstByClass('overview-count-num').textContent, '1');
      assert.equal(one.firstByClass('overview-count-label').textContent, 'day until the trip');
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview DURING the trip shows "The adventure is underway." (no number)', () => {
  withDom(() => {
    try {
      // 2026-06-24 is within [start, end]; daysUntil is null mid-trip.
      setNow(() => localDate(2026, 5, 24, 12, 0));
      const { node } = renderOverview(null, () => {});
      assert.equal(node.firstByClass('overview-count-num'), null, 'no countdown number mid-trip');
      assert.equal(node.firstByClass('overview-count-label').textContent, 'The adventure is underway.');
      assert.equal(node.firstByClass('overview-kicker').textContent, 'In Japan now');
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview AFTER the trip shows "The adventure is complete." (no number)', () => {
  withDom(() => {
    try {
      // 2026-07-10 is past TRIP.end (2026-07-03): dayDelta(end, today) > 0.
      setNow(() => localDate(2026, 6, 10, 12, 0));
      const { node } = renderOverview(null, () => {});
      assert.equal(node.firstByClass('overview-count-num'), null, 'no countdown number after the trip');
      assert.equal(node.firstByClass('overview-count-label').textContent, 'The adventure is complete.');
      assert.equal(node.firstByClass('overview-kicker').textContent, 'Looking back');
    } finally {
      setNow(null);
    }
  });
});

// --- The 18-day index -------------------------------------------------------

test('renderOverview renders exactly one button row per trip-window day (18)', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0));
      const { node } = renderOverview(23, () => {});
      const rows = node.byClass('day-index-row');
      assert.equal(rows.length, tripWindowDates().length, 'one row per window day');
      assert.equal(rows.length, 18, 'Jun 16 … Jul 3 inclusive = 18 rows');
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview index rows are real focusable <button type="button"> with aria-labels', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0));
      const rows = renderOverview(23, () => {}).node.byClass('day-index-row');
      // Native <button type="button"> rows are keyboard-focusable by default and
      // carry an aria-label describing the day. app.js sets row.type as a property.
      assert.ok(rows.every((r) => r.tagName === 'BUTTON'), 'rows are native buttons');
      assert.ok(rows.every((r) => r.type === 'button'), 'every row is type="button"');
      assert.ok(rows.every((r) => (r.getAttribute('aria-label') || '').length > 0),
        'every row carries a non-empty aria-label');
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview AUTHORED rows show day.base + "Planned" status; UNAUTHORED rows show region + "TBD"', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0));
      const rows = renderOverview(23, () => {}).node.byClass('day-index-row');

      // Jun 16 (index 0) is unauthored → region from UNAUTHORED_REGIONS + TBD.
      const first = rows[0];
      assert.ok(first.classList.contains('day-index-row-tbd'), 'unauthored row gets the tbd class');
      assert.equal(first.firstByClass('day-index-region').textContent, 'Travel — NY → Tokyo');
      assert.equal(first.firstByClass('day-index-status').textContent, 'TBD');

      // Jun 24 (index 8) is authored (Kyoto, Day 9) → base + Planned, no tbd class.
      const authored = rows[8];
      assert.equal(authored.classList.contains('day-index-row-tbd'), false, 'authored row has no tbd class');
      assert.equal(authored.firstByClass('day-index-region').textContent, getDay('2026-06-24').base);
      assert.equal(authored.firstByClass('day-index-status').textContent, 'Planned');
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview row shows the derived "Day N" number (incl. unauthored leg) and a tz-safe date label', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0));
      const rows = renderOverview(23, () => {}).node.byClass('day-index-row');

      // Jun 16 (index 0) is unauthored — its "Day 1" number comes from
      // deriveDayNumber(iso) (the day-object fallback), a path no other test
      // exercises by value. Off-by-one numbering would surface here.
      const first = rows[0];
      assert.equal(first.firstByClass('day-index-num').textContent, 'Day 1');
      assert.equal(first.firstByClass('day-index-date').textContent, 'Tue · Jun 16');

      // Jun 24 (index 8) is authored — Day 9, Wed. formatIndexDate reads UTC
      // components, so the label must not drift regardless of the test tz.
      const authored = rows[8];
      assert.equal(authored.firstByClass('day-index-num').textContent, 'Day 9');
      assert.equal(authored.firstByClass('day-index-date').textContent, 'Wed · Jun 24');
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview marks ONLY the row matching today with the day-index-row-today class', () => {
  withDom(() => {
    try {
      // Pin "now" inside the window so one row is today (Jun 24).
      setNow(() => localDate(2026, 5, 24, 12, 0));
      const rows = renderOverview(null, () => {}).node.byClass('day-index-row');
      const todays = rows.filter((r) => r.classList.contains('day-index-row-today'));
      assert.equal(todays.length, 1, 'exactly one row is marked today');
      // It is the Jun 24 row (Day 9, region Kyoto).
      assert.equal(todays[0].firstByClass('day-index-region').textContent, getDay('2026-06-24').base);
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview marks NO row as today when now is outside the trip window', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0)); // before the trip
      const rows = renderOverview(23, () => {}).node.byClass('day-index-row');
      assert.equal(rows.filter((r) => r.classList.contains('day-index-row-today')).length, 0);
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview tapping a row invokes onEnter with that row\'s ISO date', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0));
      const entered = [];
      const rows = renderOverview(23, (iso) => entered.push(iso)).node.byClass('day-index-row');

      rows[0]._fire('click');   // Jun 16 (first window day)
      rows[8]._fire('click');   // Jun 24 (authored)
      assert.deepEqual(entered, ['2026-06-16', '2026-06-24'],
        'each tapped row passes its own ISO date to onEnter');
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview does not throw when a row is tapped without an onEnter handler', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0));
      const rows = renderOverview(23, undefined).node.byClass('day-index-row');
      assert.doesNotThrow(() => rows[0]._fire('click'), 'missing handler is a safe no-op');
    } finally {
      setNow(null);
    }
  });
});

// --- XSS-safety invariant ---------------------------------------------------

test('renderOverview builds the index via element nodes / textContent (no innerHTML)', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0));
      const { node } = renderOverview(23, () => {});
      // The stub has no innerHTML setter; the tree exists purely as appended
      // StubElement children with textContent. Asserting structure proves the
      // content reached the DOM through createElement/textContent, not HTML strings.
      const region = node.firstByClass('day-index-region');
      assert.ok(region instanceof StubElement, 'region is a real element node, not raw HTML');
      assert.equal(typeof region._textContent, 'string', 'text set via textContent, not innerHTML');
      // The countdown number is likewise a textContent leaf, not interpolated markup.
      const num = node.firstByClass('overview-count-num');
      assert.ok(num instanceof StubElement && num.children.length === 0,
        'countdown number is a text-only element node');
    } finally {
      setNow(null);
    }
  });
});

// --- End-to-end through the public mountApp seam (before-trip path) ----------

test('mountApp BEFORE the trip mounts the overview with the full 18-day index and a working row tap', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 4, 24, 12, 0)); // before the trip
        const root = makeRoot();
        const ctl = mountApp(root);
        // Overview chrome, not day chrome.
        assert.ok(root.firstByClass('overview-view'), 'overview mounted pre-trip');
        assert.equal(root.firstByClass('day-nav'), null, 'no day-nav on the overview');
        // The full index renders.
        assert.equal(root.byClass('day-index-row').length, 18, 'all 18 day rows present');
        // Tapping a row routes through the controller's toIso → swaps to a day view.
        root.byClass('day-index-row')[8]._fire('click'); // Jun 24 (Day 9)
        assert.equal(root.firstByClass('overview-view'), null, 'overview replaced after tapping a row');
        assert.ok(root.firstByClass('day-nav'), 'a day view (with nav) is now mounted');
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'Day 9', 'tapped Jun 24 → Day 9');
        ctl.destroy();
      } finally {
        setNow(null);
      }
    });
  });
});

// ===========================================================================
// Time-travel test mode (time-travel-test-mode task)
//   parseNowOverride — pure string → Date|null parser for the override value.
//   resolveNowOverride — load-time resolver; inert under Node (no `window`).
//   Override-flows-the-seam — pinning via setNow(() => parseNowOverride(...))
//     makes getNow() + all downstream time logic react to the simulated moment.
//
// DETERMINISM: parseNowOverride is pure (no clock). Every test that pins the
// clock restores it with setNow(null) in a finally so it can't leak.
// ===========================================================================

// --- parseNowOverride: valid datetime-local string --------------------------
test('parseNowOverride parses a datetime-local string into a LOCAL-time Date (calendar fields)', () => {
  const d = parseNowOverride('2026-06-25T22:00');
  assert.ok(d instanceof Date, 'returns a Date');
  assert.equal(Number.isNaN(d.getTime()), false, 'the Date is valid');
  // Parsed as LOCAL time (matches localDate(2026, 5, 25, 22, 0)) — assert the
  // meaningful calendar/time fields, not exact ms.
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5, 'June (0-based month index)');
  assert.equal(d.getDate(), 25);
  assert.equal(d.getHours(), 22);
  assert.equal(d.getMinutes(), 0);
});

test('parseNowOverride parses the moment as LOCAL wall-clock time (matches localDate)', () => {
  const d = parseNowOverride('2026-06-25T22:00');
  assert.equal(d.getTime(), localDate(2026, 5, 25, 22, 0).getTime(),
    'datetime-local value is the traveler local wall clock, not UTC');
});

test('parseNowOverride accepts a seconds-precision datetime-local value', () => {
  const d = parseNowOverride('2026-06-25T22:30:15');
  assert.ok(d instanceof Date && !Number.isNaN(d.getTime()));
  assert.equal(d.getHours(), 22);
  assert.equal(d.getMinutes(), 30);
});

// --- parseNowOverride: clear-tokens → null ----------------------------------
// The clear-token *handling* (restore real clock) lives in resolveNowOverride;
// parseNowOverride itself just can't parse them, so it returns null for each.
test('parseNowOverride returns null for the empty-string clear token', () => {
  assert.equal(parseNowOverride(''), null);
});

test('parseNowOverride returns null for each word clear token (clear/off/real/reset)', () => {
  for (const token of ['clear', 'off', 'real', 'reset']) {
    assert.equal(parseNowOverride(token), null, `clear token "${token}" → null`);
  }
});

test('parseNowOverride returns null for a whitespace-only string', () => {
  assert.equal(parseNowOverride('   '), null);
  assert.equal(parseNowOverride('\t\n'), null);
});

// --- parseNowOverride: non-string inputs → null -----------------------------
test('parseNowOverride returns null for non-string inputs without throwing', () => {
  assert.equal(parseNowOverride(0), null, 'number');
  assert.equal(parseNowOverride(1750000000000), null, 'a timestamp number is NOT accepted (string-only contract)');
  assert.equal(parseNowOverride(null), null);
  assert.equal(parseNowOverride(undefined), null);
  assert.equal(parseNowOverride({}), null, 'object');
  assert.equal(parseNowOverride([]), null, 'array');
  assert.equal(parseNowOverride(new Date()), null, 'a Date object is not a string');
  assert.equal(parseNowOverride(true), null, 'boolean');
});

// --- parseNowOverride: garbage strings → null -------------------------------
test('parseNowOverride returns null for unparseable date strings (new Date → NaN)', () => {
  assert.equal(parseNowOverride('not-a-date'), null);
  assert.equal(parseNowOverride('2026-13-99'), null, 'impossible month → NaN');
  assert.equal(parseNowOverride('2026-99-99'), null, 'impossible month/day → NaN');
  assert.equal(parseNowOverride('hello world'), null);
});

// NOTE: parseNowOverride trusts `new Date()` and does NOT do strict calendar
// validation (unlike parseISODate behind getDay). An out-of-range-but-rollable
// date string like "2026-02-30" therefore does NOT return null — new Date()
// rolls it over to Mar 2. This pins the actual override-parser contract; it is
// acceptable because the override is a developer/test tool fed by a
// <input type="datetime-local"> (which only emits valid dates). See Discovered
// Issues if stricter rejection is ever wanted.
test('parseNowOverride rolls over an out-of-range datetime-local string (new Date semantics)', () => {
  // A bare YYYY-MM-DD parses as UTC midnight, so the exact local day is
  // TZ-dependent — assert only the TZ-stable facts: it's a valid Date that
  // rolled past February (Feb has no 30th).
  const d = parseNowOverride('2026-02-30');
  assert.ok(d instanceof Date && !Number.isNaN(d.getTime()), 'new Date rolls 2026-02-30 over, not NaN');
  assert.ok(d.getTime() > new Date('2026-02-28').getTime(), 'rolled past the end of February');
});

test('parseNowOverride never throws regardless of input', () => {
  const inputs = ['', '   ', 'clear', 'garbage', '2026-99-99', 0, null, undefined, {}, [], NaN, Symbol.for('x') === Symbol.for('x') ? 'ok' : 'ok'];
  for (const input of inputs) {
    assert.doesNotThrow(() => parseNowOverride(input), `parseNowOverride(${String(input)}) must not throw`);
  }
});

// --- Override flows the clock seam (AC #1 / #3 / #4 at the logic layer) ------
test('pinning via setNow(() => parseNowOverride(...)) makes getNow() return the simulated moment', () => {
  try {
    setNow(() => parseNowOverride('2026-06-25T22:00'));
    const now = getNow();
    assert.equal(now.getFullYear(), 2026);
    assert.equal(now.getMonth(), 5);
    assert.equal(now.getDate(), 25);
    assert.equal(now.getHours(), 22);
  } finally {
    setNow(null);
  }
});

test('override at 22:00 makes isEveningWindow(getNow()) true (evening prep is active)', () => {
  try {
    setNow(() => parseNowOverride('2026-06-25T22:00'));
    assert.equal(isEveningWindow(getNow()), true, '22:00 is inside the 21:00–04:00 window');
  } finally {
    setNow(null);
  }
});

test('override at 02:00 (POST-midnight) makes isEveningWindow(getNow()) true — the window wraps midnight through the seam', () => {
  // AC4: the evening window is 9pm–4am, i.e. it WRAPS midnight. The 22:00 case
  // only exercises the pre-midnight arm; this pins the clock to 02:00 to prove
  // the override → getNow() → isEveningWindow chain honors the post-midnight arm
  // (hour < endHour) too — the trickiest boundary of the window.
  try {
    setNow(() => parseNowOverride('2026-06-26T02:00'));
    assert.equal(isEveningWindow(getNow()), true, '02:00 is inside the wrapping 21:00–04:00 window');
  } finally {
    setNow(null);
  }
});

test('override at 14:00 (same day) makes isEveningWindow(getNow()) false', () => {
  try {
    setNow(() => parseNowOverride('2026-06-25T14:00'));
    assert.equal(isEveningWindow(getNow()), false, '14:00 is outside the evening window');
  } finally {
    setNow(null);
  }
});

test('override DURING the trip makes pickLandingView(getNow()) land on that authored day in "plan"', () => {
  try {
    // Jun 24 is the first authored day (dayNumber 9). Override "now" to it.
    setNow(() => parseNowOverride('2026-06-24T10:00'));
    const view = pickLandingView(getNow());
    assert.equal(view.view, 'day');
    assert.equal(view.framing, 'plan');
    assert.equal(view.day?.date, '2026-06-24');
  } finally {
    setNow(null);
  }
});

test('override BEFORE the trip makes pickLandingView(getNow()) return the overview countdown', () => {
  try {
    setNow(() => parseNowOverride('2026-05-24T12:00'));
    const view = pickLandingView(getNow());
    assert.equal(view.view, 'overview');
    assert.equal(view.day, null);
    assert.equal(view.daysUntil, 23, '2026-05-24 → 23 days until 2026-06-16');
  } finally {
    setNow(null);
  }
});

test('override AFTER the trip makes pickLandingView(getNow()) land on the last day in "reminisce"', () => {
  try {
    setNow(() => parseNowOverride('2026-07-10T12:00'));
    const view = pickLandingView(getNow());
    assert.equal(view.view, 'day');
    assert.equal(view.framing, 'reminisce');
    assert.equal(view.day?.date, '2026-07-03', 'last authored day');
  } finally {
    setNow(null);
  }
});

test('with the override pinned, frameForDay reads getNow() and frames each day relative to the simulated moment', () => {
  try {
    // Simulate "now" = Jun 25. Same day → plan, future → anticipation, past → reminisce.
    setNow(() => parseNowOverride('2026-06-25T22:00'));
    assert.equal(frameForDay('2026-06-25'), 'plan', 'same simulated calendar day');
    assert.equal(frameForDay('2026-06-26'), 'anticipation', 'a future day');
    assert.equal(frameForDay('2026-06-24'), 'reminisce', 'a past day');
  } finally {
    setNow(null);
  }
});

test('setNow(null) restores the real clock after a time-travel override (no longer pinned)', () => {
  try {
    setNow(() => parseNowOverride('2026-06-25T22:00'));
    assert.equal(getNow().getFullYear(), 2026, 'precondition: override is active');
  } finally {
    setNow(null);
  }
  // After restore, getNow() tracks the wall clock again.
  const drift = Math.abs(getNow().getTime() - Date.now());
  assert.ok(drift < 1000, 'wall clock restored after setNow(null)');
});

test('a provider returning parseNowOverride() of a BAD value (null) degrades getNow() to the wall clock', () => {
  try {
    // parseNowOverride('clear') === null → provider returns null → getNow degrades.
    setNow(() => parseNowOverride('clear'));
    const drift = Math.abs(getNow().getTime() - Date.now());
    assert.ok(drift < 1000, 'null override → getNow falls back to the real clock');
  } finally {
    setNow(null);
  }
});

// --- resolveNowOverride: inert under Node (no `window`) ----------------------
test('resolveNowOverride is inert under Node (no window): returns null and does not throw', () => {
  assert.equal(typeof window, 'undefined', 'precondition: no window in the Node test runner');
  let result;
  assert.doesNotThrow(() => { result = resolveNowOverride(); });
  assert.equal(result, null, 'no browser → no override resolved');
});

test('resolveNowOverride does NOT change the active clock when called under Node', () => {
  // Pin a known override, call resolveNowOverride (which should early-return and
  // leave the provider untouched), and confirm getNow() is unchanged.
  try {
    setNow(() => parseNowOverride('2026-06-25T22:00'));
    const before = getNow().getTime();
    resolveNowOverride();
    const after = getNow().getTime();
    assert.equal(after, before, 'the pinned override survives a Node-context resolveNowOverride() call');
    assert.equal(getNow().getHours(), 22, 'still the simulated moment');
  } finally {
    setNow(null);
  }
});
