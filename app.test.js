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
