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
  bucketPlanByDayPart,
  shouldShowApp,
  friendlyAuthError,
  wireAuthGate,
  installSubmitGuard,
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

test('getDays returns every present day (18) from data/days.js', () => {
  assert.equal(getDays().length, 18);
  // Sanity-check it tracks the source array length (all source days are valid).
  assert.equal(getDays().length, DAYS.length);
});

test('getDays returns days sorted ascending by date', () => {
  const dates = getDays().map((d) => d.date);
  const sorted = [...dates].sort(); // ISO YYYY-MM-DD sorts lexicographically
  assert.deepEqual(dates, sorted);
});

test('getDays spans the FULL contiguous trip Jun 16 -> Jul 3 (18 days, no gaps)', () => {
  const dates = getDays().map((d) => d.date);
  assert.equal(dates[0], '2026-06-16');
  assert.equal(dates[dates.length - 1], '2026-07-03');
  // The trip is now fully authored end-to-end: every window date is present and
  // the days are exactly one calendar day apart (no missing/absent interior day,
  // no duplicate). This replaces the former "no zero-filled gap day" check now
  // that the Jun 18–23 leg is authored and the trip is contiguous 18/18.
  assert.deepEqual(dates, tripWindowDates(), 'getDays() covers every trip-window date');
  assert.equal(dates.length, 18, 'Jun 16 … Jul 3 inclusive = 18 days');
  for (let i = 1; i < dates.length; i++) {
    const delta = (utcMidnight(dates[i]) - utcMidnight(dates[i - 1])) / MS_PER_DAY;
    assert.equal(delta, 1, `contiguous (one calendar day apart) at index ${i}`);
  }
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

test('getDay returns null for a date just OUTSIDE the trip window (no interior gap remains)', () => {
  // The trip is now fully authored and contiguous Jun 16 → Jul 3, so there is no
  // interior "gap" date to be absent — every in-window date resolves to a day.
  // The partial-trip-safe null behavior is now exercised at the trip edges: a
  // date one day before the start and one day after the end must return null.
  assert.equal(getDay('2026-06-15'), null, 'day before TRIP.start is absent');
  assert.equal(getDay('2026-07-04'), null, 'day after TRIP.end is absent');
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

test('getDayByNumber resolves EVERY in-range dayNumber 1..18 (no unauthored gap remains)', () => {
  // The trip is fully authored, so there is no longer a window dayNumber that
  // resolves to null. Every Day N from 1 (Jun 16) through 18 (Jul 3) maps to a
  // real day; the out-of-range null behavior is covered by the next test.
  for (let n = 1; n <= 18; n++) {
    const day = getDayByNumber(n);
    assert.ok(day, `Day ${n} should resolve to an authored day`);
    assert.equal(day.dayNumber, n, `Day ${n} round-trips its dayNumber`);
  }
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
// author-travel-arrival — Jun 16 (Wheels Up) + Jun 17 (Touchdown) content.
//
// The fixture repoints above prove the COUNT changed (10 -> 12 days). These
// cases assert the two NEW travel/arrival days are CORRECT and complete, so a
// regression that broke or deleted their content would fail here rather than
// silently shipping. Robust (substring/contains) assertions on prose, not
// brittle whole-string matches.
// ===========================================================================

// --- Jun 16: Wheels Up — Montréal to Tokyo (travel day, Day 1) ---------------

test('Jun 16 exists and is Day 1 with the right base/title', () => {
  const day = getDay('2026-06-16');
  assert.ok(day, 'Jun 16 should be present');
  assert.equal(day.dayNumber, 1, 'Jun 16 is the first trip day');
  assert.equal(day.base, 'In transit');
  assert.equal(day.title, 'Wheels Up — Montréal to Tokyo');
  // getDayByNumber(1) must round-trip to the same day.
  assert.equal(getDayByNumber(1), day);
});

test('Jun 16 is a travel day with lodging null (overnight is in the air)', () => {
  assert.equal(getDay('2026-06-16').lodging, null);
});

test('Jun 16 carries the AC 5 flight as a complete transit plan item', () => {
  const day = getDay('2026-06-16');
  const flight = day.plan.find(
    (p) => p.tag === 'transit' && p.transit && /AC 5/.test(p.transit.line || ''),
  );
  assert.ok(flight, 'an AC 5 flight transit item should be present');
  // Origin/destination on the transit leg (YUL -> NRT).
  assert.match(flight.transit.from, /YUL/);
  assert.match(flight.transit.to, /NRT/);
  // Duration carried as numeric minutes (single source of truth), not prose.
  assert.equal(typeof flight.transit.minutes, 'number');
  assert.ok(flight.transit.minutes > 0);
  // Key ticket facts survive in the note (substring, not exact-string).
  assert.match(flight.note, /777-300ER/);
  assert.match(flight.note, /Premium Economy/);
  assert.match(flight.note, /\+1 day/);
});

// --- Jun 17: Touchdown — Into Akasaka (arrival day, Day 2) -------------------

test('Jun 17 exists and is Day 2 with the Akasaka lodging', () => {
  const day = getDay('2026-06-17');
  assert.ok(day, 'Jun 17 should be present');
  assert.equal(day.dayNumber, 2, 'Jun 17 is the second trip day');
  assert.equal(getDayByNumber(2), day);
  assert.ok(day.lodging, 'Jun 17 is the first night with a hotel');
  assert.equal(day.lodging.name, 'Hotel Via Inn Prime Akasaka');
});

test('Jun 17 airport->hotel item has exactly 2 transit-bearing recommendations (bus + train)', () => {
  const day = getDay('2026-06-17');
  const intoCity = day.plan.find(
    (p) => p.tag === 'transit' && Array.isArray(p.recommendations) && p.recommendations.length > 0,
  );
  assert.ok(intoCity, 'a transit item with airport->hotel recommendations should be present');
  assert.equal(intoCity.recommendations.length, 2, 'exactly two ways into the city');
  // Both recs carry a transit block with required numeric minutes.
  for (const rec of intoCity.recommendations) {
    assert.ok(rec.transit, `rec "${rec.name}" should carry a transit block`);
    assert.equal(typeof rec.transit.minutes, 'number', `rec "${rec.name}" minutes must be numeric`);
    assert.ok(rec.transit.minutes > 0);
  }
  // Both bus and train modes are represented (Limousine Bus + N'EX).
  const modes = intoCity.recommendations.map((r) => r.transit.mode).sort();
  assert.deepEqual(modes, ['bus', 'train']);
});

test('Jun 17 dinner recommendations include the vegan-safe Kyushu Jangara option (Megan)', () => {
  const day = getDay('2026-06-17');
  const dinner = day.plan.find(
    (p) => p.tag === 'meal' && Array.isArray(p.recommendations) && p.recommendations.length > 0,
  );
  assert.ok(dinner, 'a first-night ramen meal with recommendations should be present');
  const vegan = dinner.recommendations.find((r) => /Kyushu Jangara/.test(r.name));
  assert.ok(vegan, "Megan's vegan-safe Kyushu Jangara option must be present");
  // The veg signal lives in its pros — keep the safety cue load-bearing.
  assert.ok(
    vegan.pros.some((p) => /vegan/i.test(p)),
    'the Kyushu Jangara pros should advertise a vegan option',
  );
});

// --- Render smoke tests for the two new days --------------------------------

test('renderDay renders Jun 16 (travel day, lodging null) without throwing', () => {
  withDom(() => {
    let r;
    assert.doesNotThrow(() => { r = renderDay(getDay('2026-06-16'), 'plan'); });
    assert.ok(r.node, 'a node is returned');
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
});

test('renderDay renders Jun 17 (arrival day) without throwing', () => {
  withDom(() => {
    let r;
    assert.doesNotThrow(() => { r = renderDay(getDay('2026-06-17'), 'plan'); });
    assert.ok(r.node, 'a node is returned');
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
});

// --- Schema invariants specific to the two new days -------------------------

test('Jun 16 and Jun 17 obey the <=4 recommendations schema RULE', () => {
  for (const iso of ['2026-06-16', '2026-06-17']) {
    for (const item of getDay(iso).plan) {
      if (item.recommendations !== undefined) {
        assert.ok(
          item.recommendations.length <= 4,
          `>4 recommendations on ${iso} / "${item.title}"`,
        );
      }
    }
  }
});

test('Jun 16 and Jun 17 do NOT author dayNumber in the source (it is derived)', () => {
  // dayNumber must be DERIVED, never a literal key in data/days.js. Check the
  // raw source objects (DAYS), not getDay()'s output (which adds the derived #).
  for (const iso of ['2026-06-16', '2026-06-17']) {
    const raw = DAYS.find((d) => d.date === iso);
    assert.ok(raw, `raw source day ${iso} should exist`);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(raw, 'dayNumber'),
      `${iso} must not author a literal dayNumber key`,
    );
  }
});

test('Jun 16 and Jun 17 plan items all carry a parseable HH:MM time (no tilde/untimed buckets)', () => {
  // Regression guard: every authored Kyoto day gives each plan item a real
  // "HH:MM" time. The travel/arrival days must match — an unparseable time
  // (e.g. a "~18:00" tilde or a missing `time`) silently dumps the item into
  // Morning, so an evening check-in would render ABOVE the afternoon arrival.
  for (const iso of ['2026-06-16', '2026-06-17']) {
    for (const item of getDay(iso).plan) {
      assert.match(
        item.time ?? '',
        /^\d{2}:\d{2}$/,
        `${iso} / "${item.title}" must have a parseable HH:MM time`,
      );
    }
  }
});

test('Jun 17 buckets afternoon arrival/transit and evening check-in/dinner in chronological order', () => {
  // The arrival day reads correctly only if NRT arrival + the into-city leg sit
  // in Afternoon and the check-in + first-night ramen sit in Evening. Proves the
  // time fix (16:30 transit, 18:00 check-in, 19:30 dinner) buckets as intended.
  const [morning, afternoon, evening] = bucketPlanByDayPart(getDay('2026-06-17').plan);
  assert.equal(morning.items.length, 0, 'nothing should fall back into Morning');
  assert.deepEqual(
    afternoon.items.map((x) => x.item.tag),
    ['transit', 'transit'],
    'afternoon = NRT arrival + into-city transit',
  );
  assert.deepEqual(
    evening.items.map((x) => x.item.tag),
    ['checkin', 'meal'],
    'evening = hotel check-in + first-night ramen',
  );
});

test('Jun 17 airport-transfer recs render their transit pill but NOT a misleading "from <hotel>" walk line', () => {
  withDom(() => {
    // The NRT→Akasaka recs (Limousine Bus + N'EX) are airport transfers, not
    // walkable spots. They carry NO coords, so the walk-distance origin must not
    // fall back to the lodging and print "9 min from the hotel" on a leg that
    // travels TO the hotel. The transit pill must still render. Scope the check
    // PER CARD: the dinner recs below legitimately DO show a walk from the hotel.
    const node = renderDay(getDay('2026-06-17'), 'plan').node;
    const cardByName = (name) =>
      node.byClass('rec-card').find((c) => c.firstByClass('rec-name')?.textContent === name);

    for (const name of ['Airport Limousine Bus (to Kioicho)', "Narita Express (N'EX)"]) {
      const card = cardByName(name);
      assert.ok(card, `${name} card rendered`);
      assert.equal(card.byClass('rec-transit').length, 1, `${name} keeps its transit pill`);
      assert.match(card.firstByClass('rec-transit').textContent, /Narita Airport T1 →/, `${name} pill shows the route`);
      assert.equal(card.byClass('rec-walk-from').length, 0, `${name} shows NO "from <hotel>" walk line`);
    }
    // Sanity: the bus pill carries 110 min, the N'EX pill 56 min.
    assert.match(cardByName('Airport Limousine Bus (to Kioicho)').firstByClass('rec-transit').textContent, /110 min/);
    assert.match(cardByName("Narita Express (N'EX)").firstByClass('rec-transit').textContent, /56 min/);

    // The dinner recs, by contrast, ARE walkable from the hotel — that walk line
    // is correct and must survive the fix.
    const dinner = cardByName('Kyushu Jangara Akasaka');
    assert.ok(dinner, 'dinner rec card rendered');
    assert.match(dinner.firstByClass('rec-walk-from')?.textContent ?? '', /Via Inn Prime Akasaka/,
      'walkable dinner rec still shows its distance from the hotel');
  });
});

test('Jun 16 and Jun 17 photos all carry a license credit in the existing CC/PD format', () => {
  // Acceptance criterion: photos are CC/PD Wikimedia with attribution in the
  // existing `credit` format ("<attribution> · <license>"). Assert structure
  // (non-empty, has the " · " separator, names a CC/CC0/PD license) — not exact
  // strings — so a copy tweak to an attribution name won't break this.
  for (const iso of ['2026-06-16', '2026-06-17']) {
    const photos = getDay(iso).photos;
    assert.ok(photos.length > 0, `${iso} should have hype photos`);
    for (const p of photos) {
      assert.equal(typeof p.credit, 'string', `${iso} photo "${p.alt}" must carry a credit`);
      assert.ok(p.credit.includes(' · '), `${iso} credit must use the "<who> · <license>" format`);
      assert.match(
        p.credit,
        /CC0|CC BY|public domain/i,
        `${iso} credit "${p.credit}" must name a CC/CC0/PD license`,
      );
      // Alt text is required for the a11y/render path.
      assert.ok(typeof p.alt === 'string' && p.alt.length > 0, `${iso} photo must have alt text`);
    }
  }
});

test('the two new days VALIDATE cleanly (no warn-and-skip) — proven by zero warnings on the real data', () => {
  // Acceptance criterion: Jun 16/17 validate with no console warn-skip. The
  // production helpers (getDays) run validation once at import where warnings
  // are swallowed; re-run the SAME validator on the live DAYS+TRIP under a warn
  // spy to prove the real data emits zero warnings AND all 14 days survive.
  // (If either new day were malformed it would either warn or be skipped — both
  // are caught here.)
  let result;
  const warnings = captureWarnings(() => {
    result = buildValidatedDays(DAYS, TRIP);
  });
  assert.equal(warnings, 0, 'live trip data must validate with no warnings');
  assert.equal(result.length, DAYS.length, 'every authored day survives validation (none skipped)');
  assert.equal(result.length, 18, 'all 18 days present after validation');
  // Both new days specifically made it through.
  assert.ok(result.find((d) => d.date === '2026-06-16'), 'Jun 16 survived validation');
  assert.ok(result.find((d) => d.date === '2026-06-17'), 'Jun 17 survived validation');
});

// ===========================================================================
// author-tokyo-asakusa-ginza — Jun 18 (Asakusa/Ueno) + Jun 19 (teamLab/Ginza) content.
//
// Mirrors the author-travel-arrival block above: these cases assert the two NEW
// Tokyo days are CORRECT and complete (lodging, day numbers, the veg-safe meal
// anchors that keep Megan covered, the teamLab early slot + pre-book prep, the
// booked Faro dinner, and the structured-transit invariant) so a regression that
// broke or deleted their content fails here. Robust substring/contains asserts on
// prose, not brittle whole-string matches.
// ===========================================================================

// --- Jun 18: Old Tokyo — Asakusa, Ueno & Electric Town (Day 3) --------------

test('Jun 18 exists and is Day 3 with the Tokyo base + Akasaka lodging', () => {
  const day = getDay('2026-06-18');
  assert.ok(day, 'Jun 18 should be present');
  assert.equal(day.dayNumber, 3, 'Jun 18 is the third trip day');
  assert.equal(day.base, 'Tokyo');
  assert.equal(getDayByNumber(3), day, 'getDayByNumber(3) round-trips to Jun 18');
  assert.ok(day.lodging, 'Jun 18 has a hotel');
  assert.equal(day.lodging.name, 'Hotel Via Inn Prime Akasaka');
});

test('Jun 18 has an out-for-breakfast block in Akasaka with The Earl as the veg-safe anchor (<=4 recs)', () => {
  const day = getDay('2026-06-18');
  const breakfast = day.plan.find(
    (p) => p.tag === 'meal' && /breakfast/i.test(p.title),
  );
  assert.ok(breakfast, 'an out-for-breakfast meal block should be present');
  assert.match(breakfast.title, /Akasaka/, 'breakfast is out in Akasaka (the lodging neighborhood)');
  assert.ok(Array.isArray(breakfast.recommendations) && breakfast.recommendations.length > 0);
  assert.ok(breakfast.recommendations.length <= 4, 'breakfast keeps <=4 recommendations');
  const earl = breakfast.recommendations.find((r) => /The Earl/.test(r.name));
  assert.ok(earl, "Megan's veg-safe anchor 'The Earl' must be present");
  assert.ok(
    earl.pros.some((p) => /veg/i.test(p)),
    "The Earl's pros must advertise the vegetarian signal",
  );
});

test('Jun 18 is an out-for-breakfast day: no hotel breakfast, breakfast taken out in the plan', () => {
  const day = getDay('2026-06-18');
  // The hotel breakfast is intentionally null — the morning starts out in Akasaka.
  assert.equal(day.lodging.breakfast, null, 'Jun 18 hotel provides no breakfast (out for breakfast)');
  // ...and that intent is realized by an actual breakfast meal block in the plan.
  const breakfast = day.plan.find((p) => p.tag === 'meal' && /breakfast/i.test(p.title));
  assert.ok(breakfast, 'breakfast is taken OUT — a breakfast meal block exists in the plan');
  assert.match(breakfast.title, /out/i, 'the breakfast block reads as eaten out, not at the hotel');
});

test('Jun 18 has an Asakusa lunch block with the Marugoto Vegan anchor (<=4 recs)', () => {
  const day = getDay('2026-06-18');
  const lunch = day.plan.find(
    (p) => p.tag === 'meal' && /lunch/i.test(p.title) && /Asakusa/.test(p.title),
  );
  assert.ok(lunch, 'an Asakusa lunch block should be present');
  assert.ok(Array.isArray(lunch.recommendations) && lunch.recommendations.length > 0);
  assert.ok(lunch.recommendations.length <= 4, 'lunch keeps <=4 recommendations');
  const vegan = lunch.recommendations.find((r) => /Marugoto Vegan/.test(r.name));
  assert.ok(vegan, "Megan's veg-safe anchor 'Marugoto Vegan Dining Asakusa' must be present");
  assert.ok(
    vegan.pros.some((p) => /vegan/i.test(p)),
    "Marugoto's pros must advertise the vegan signal",
  );
});

test('Jun 18 has a Kanda dinner block with the Genki veg anchor (<=4 recs)', () => {
  const day = getDay('2026-06-18');
  const dinner = day.plan.find(
    (p) => p.tag === 'meal' && /dinner/i.test(p.title) && /Kanda/.test(p.title),
  );
  assert.ok(dinner, 'a Kanda dinner block should be present');
  assert.ok(Array.isArray(dinner.recommendations) && dinner.recommendations.length > 0);
  assert.ok(dinner.recommendations.length <= 4, 'dinner keeps <=4 recommendations');
  const veg = dinner.recommendations.find((r) => /Genki/.test(r.name));
  assert.ok(veg, "Megan's veg-safe anchor 'Vegetable Izakaya Genki Kanda' must be present");
  assert.ok(
    veg.pros.some((p) => /veg/i.test(p)),
    "Genki's pros must advertise the vegetable/vegan signal",
  );
});

// --- Jun 19: teamLab, Tokyo Tower & Ginza (Day 4) ---------------------------

test('Jun 19 exists and is Day 4', () => {
  const day = getDay('2026-06-19');
  assert.ok(day, 'Jun 19 should be present');
  assert.equal(day.dayNumber, 4, 'Jun 19 is the fourth trip day');
  assert.equal(getDayByNumber(4), day, 'getDayByNumber(4) round-trips to Jun 19');
});

test('Jun 19 lunch in Ginza includes the Ain Soph. vegan anchor (<=4 recs)', () => {
  const day = getDay('2026-06-19');
  const lunch = day.plan.find(
    (p) => p.tag === 'meal' && /lunch/i.test(p.title) && /Ginza/.test(p.title),
  );
  assert.ok(lunch, 'a Ginza lunch block should be present');
  assert.ok(Array.isArray(lunch.recommendations) && lunch.recommendations.length > 0);
  assert.ok(lunch.recommendations.length <= 4, 'lunch keeps <=4 recommendations');
  const vegan = lunch.recommendations.find((r) => /Ain Soph\. Ginza/.test(r.name));
  assert.ok(vegan, "Megan's veg-safe anchor 'Ain Soph. Ginza' must be present");
  assert.ok(
    vegan.pros.some((p) => /vegan/i.test(p)),
    "Ain Soph.'s pros must advertise the vegan signal",
  );
});

test('Jun 19 teamLab is a 9:00 start and the prep mentions confirming hours / pre-booking the slot', () => {
  const day = getDay('2026-06-19');
  const teamlab = day.plan.find((p) => /teamLab/i.test(p.title));
  assert.ok(teamlab, 'a teamLab plan item should be present');
  assert.match(teamlab.time, /^0?9:00$/, 'teamLab opens the day at 9:00');
  // The prep array must flag confirming June hours AND pre-booking the timed slot.
  const prep = day.prep.join('\n');
  assert.match(prep, /hours/i, 'prep should mention confirming teamLab hours');
  assert.match(prep, /pre-?book/i, 'prep should mention pre-booking the timed slot');
});

test('Jun 19 Faro dinner is a confirmed booking with Megan\'s vegan tasting noted', () => {
  const day = getDay('2026-06-19');
  const faro = day.plan.find((p) => p.tag === 'meal' && /Faro/i.test(p.title));
  assert.ok(faro, 'the Faro dinner item should be present');
  assert.equal(faro.reserved, true, 'Faro is a confirmed booking (reserved:true)');
  assert.match(faro.note, /vegan tasting/i, "Faro note must mention Megan's vegan tasting menu");
});

// --- Jun 20/21 content contracts (author-tokyo-nightlife-shibuya) ------------
//
// These encode this task's acceptance criteria as regression guards: the Amam
// Dacotan / Shinjuku Gyoen timing slots, the Megan veg-anchor rec invariant,
// the Akasaka lodging, and the photo completeness for the two new days.

test('Jun 20 exists and is Day 5 with the Tokyo base + Akasaka lodging', () => {
  const day = getDay('2026-06-20');
  assert.ok(day, 'Jun 20 should be present');
  assert.equal(day.dayNumber, 5, 'Jun 20 is Day 5');
  assert.equal(day.base, 'Tokyo');
  assert.ok(day.lodging, 'Jun 20 has a hotel');
  assert.equal(day.lodging.name, 'Hotel Via Inn Prime Akasaka');
});

test('Jun 21 exists and is Day 6 with the Tokyo base + Akasaka lodging', () => {
  const day = getDay('2026-06-21');
  assert.ok(day, 'Jun 21 should be present');
  assert.equal(day.dayNumber, 6, 'Jun 21 is Day 6');
  assert.equal(day.base, 'Tokyo');
  assert.ok(day.lodging, 'Jun 21 has a hotel');
  assert.equal(day.lodging.name, 'Hotel Via Inn Prime Akasaka');
});

test('Jun 21 Amam Dacotan stays in the 11:00 Omotesando brunch slot', () => {
  // Acceptance criterion: Amam Dacotan must anchor the 11:00 window (the 11–2
  // Omotesando block). A regression that drifted it out of that slot — e.g. an
  // earlier/later time — would fail here.
  const day = getDay('2026-06-21');
  const amam = day.plan.find((p) => /Amam Dacotan/.test(p.title));
  assert.ok(amam, 'a plan item titled with "Amam Dacotan" should be present');
  assert.equal(amam.time, '11:00', 'Amam Dacotan is the 11:00 brunch window');
  assert.equal(amam.tag, 'meal', 'Amam Dacotan is a meal block');
});

test('Jun 21 Shinjuku Gyoen holds its 14:30 slot (guards the Amam-crowding bail regression)', () => {
  // Acceptance criterion: Shinjuku Gyoen must stay at 14:30. The bail-condition
  // regression was Amam crowding the afternoon and pushing Gyoen past its slot;
  // pinning the time guards against that drift.
  const day = getDay('2026-06-21');
  const gyoen = day.plan.find((p) => /Shinjuku Gyoen/.test(p.title));
  assert.ok(gyoen, 'a "Shinjuku Gyoen" plan item should be present');
  assert.equal(gyoen.time, '14:30', 'Shinjuku Gyoen is the 14:30 (2:30pm) block');
});

test('every non-booked meal on Jun 20 and Jun 21 carries a 1–4 rec block (Megan veg-anchor invariant)', () => {
  // "Every non-booked meal has a ≤4 rec block" — data-shape based so it does not
  // brittle-match restaurant names that may change. The <=4 upper bound is also
  // covered globally; this pins the LOWER bound (>=1) for the new days' meals.
  for (const iso of ['2026-06-20', '2026-06-21']) {
    const openMeals = getDay(iso).plan.filter(
      (p) => p.tag === 'meal' && p.reserved !== true,
    );
    assert.ok(openMeals.length > 0, `${iso} should have at least one non-booked meal`);
    for (const meal of openMeals) {
      assert.ok(
        Array.isArray(meal.recommendations),
        `${iso} / "${meal.title}" non-booked meal must have a recommendations array`,
      );
      assert.ok(
        meal.recommendations.length >= 1 && meal.recommendations.length <= 4,
        `${iso} / "${meal.title}" must carry 1–4 recommendations (has ${meal.recommendations.length})`,
      );
      // Megan's veg-safety cue must stay load-bearing: at least one rec advertises
      // a veg/vegan signal in its pros (matches the Jun 18/19 per-meal anchor tests).
      // Guards against the anchor being swapped out for generic recs while the
      // 1–4 count still passes.
      assert.ok(
        meal.recommendations.some((r) =>
          Array.isArray(r.pros) && r.pros.some((p) => /veg(etari|an|gie)?\b|vegan/i.test(p)),
        ),
        `${iso} / "${meal.title}" must keep at least one rec whose pros advertise a veg/vegan option for Megan`,
      );
    }
  }
});

test('Jun 20 and Jun 21 each carry at least one complete photo (url/alt/credit all non-empty)', () => {
  // Photo completeness is not a global invariant (only "photos is an array" is),
  // so guard it explicitly for the two new days.
  for (const iso of ['2026-06-20', '2026-06-21']) {
    const photos = getDay(iso).photos;
    assert.ok(Array.isArray(photos) && photos.length > 0, `${iso} should have at least one photo`);
    for (const photo of photos) {
      assert.ok(typeof photo.url === 'string' && photo.url.length > 0, `${iso} photo url non-empty`);
      assert.ok(typeof photo.alt === 'string' && photo.alt.length > 0, `${iso} photo alt non-empty`);
      assert.ok(typeof photo.credit === 'string' && photo.credit.length > 0, `${iso} photo credit non-empty`);
    }
  }
});

// --- Structured-transit invariant across both new days ----------------------

test('Jun 18 and Jun 19 transit items all carry a complete transit object (mode/from/to + numeric minutes)', () => {
  for (const iso of ['2026-06-18', '2026-06-19']) {
    const transitItems = getDay(iso).plan.filter((p) => p.tag === 'transit');
    assert.ok(transitItems.length > 0, `${iso} should have at least one transit leg`);
    for (const item of transitItems) {
      assert.ok(item.transit, `${iso} / "${item.title}" must carry a transit object`);
      assert.equal(typeof item.transit.mode, 'string', `${iso} / "${item.title}" transit.mode`);
      assert.ok(item.transit.mode.length > 0, `${iso} / "${item.title}" transit.mode non-empty`);
      assert.equal(typeof item.transit.from, 'string', `${iso} / "${item.title}" transit.from`);
      assert.ok(item.transit.from.length > 0, `${iso} / "${item.title}" transit.from non-empty`);
      assert.equal(typeof item.transit.to, 'string', `${iso} / "${item.title}" transit.to`);
      assert.ok(item.transit.to.length > 0, `${iso} / "${item.title}" transit.to non-empty`);
      assert.equal(typeof item.transit.minutes, 'number', `${iso} / "${item.title}" transit.minutes numeric`);
      assert.ok(item.transit.minutes > 0, `${iso} / "${item.title}" transit.minutes positive`);
    }
  }
});

test('Jun 18/19 transit legs pin their authored durations (guards against a minutes value regression)', () => {
  const legMinutes = (iso, fromTo) => {
    const item = getDay(iso).plan.find(
      (p) => p.tag === 'transit' && p.transit && p.transit.from === fromTo[0] && p.transit.to === fromTo[1],
    );
    assert.ok(item, `${iso} should have a transit leg ${fromTo[0]} → ${fromTo[1]}`);
    return item.transit.minutes;
  };
  // Representative durations — a regression that swapped these for a wrong value
  // (e.g. 30 → 3) would slip past the generic "positive number" invariant above.
  // (Jun 18's Asakusa→museum and museum→Akihabara legs are walks, so they carry
  // no structured `transit` block — only the Ginza Line ride is pinned here.)
  assert.equal(legMinutes('2026-06-18', ['Tameike-sanno', 'Asakusa']), 30, 'Ginza Line Tameike-sanno → Asakusa is 30 min');
  assert.equal(legMinutes('2026-06-19', ['Kamiyacho', 'Ginza']), 8, 'Hibiya Line Kamiyacho → Ginza is 8 min');
});

test('Jun 20/21 transit legs pin their authored durations (guards against a minutes value regression)', () => {
  const legMinutes = (iso, fromTo) => {
    const item = getDay(iso).plan.find(
      (p) => p.tag === 'transit' && p.transit.from === fromTo[0] && p.transit.to === fromTo[1],
    );
    assert.ok(item, `${iso} should have a transit leg ${fromTo[0]} → ${fromTo[1]}`);
    return item.transit.minutes;
  };
  // Representative durations for the two new days — a regression that swapped
  // any of these for a wrong value (e.g. 8 → 80) would slip past the generic
  // "positive number" invariant. These encode this task's specific legs.
  assert.equal(legMinutes('2026-06-20', ['Akasaka-mitsuke', 'Shinjuku-sanchome']), 8, 'Marunouchi Line Akasaka-mitsuke → Shinjuku-sanchome is 8 min');
  assert.equal(legMinutes('2026-06-21', ['Akasaka', 'Omotesando']), 6, 'Chiyoda Line Akasaka → Omotesando is 6 min');
  // Multi-leg Omotesando → Shinjuku-gyoenmae: primary leg is now Ginza Line to
  // the Akasaka-mitsuke interchange (8 min), then a 10-min Marunouchi transfer.
  assert.equal(legMinutes('2026-06-21', ['Omotesando', 'Akasaka-mitsuke']), 8, 'Ginza Line Omotesando → Akasaka-mitsuke (interchange) is 8 min');
});

test('every multi-leg transit item chains coherent stops (no two adjacent stops equal — guards the duplicate-terminal-stop bug)', () => {
  // Regression guard for the BLOCKER where a multi-leg primary `to` was authored
  // as the FINAL destination instead of the interchange, producing a rendered
  // stops chain like `Akasaka → Tsukiji → Tsukiji`. The renderer builds the chain
  // as [from, to, transfer.to]; the interchange must sit in the middle and no two
  // adjacent stops may be equal. Loops getDays() so it covers existing + future days.
  let checked = 0;
  for (const day of getDays()) {
    for (const item of day.plan ?? []) {
      const t = item.transit;
      if (!t || !t.transfer) continue;
      checked += 1;
      const chain = [String(t.from), String(t.to), String(t.transfer.to)];
      // Interchange invariant: primary `to` must equal the transfer's `from`.
      assert.equal(
        String(t.to), String(t.transfer.from),
        `${day.date} multi-leg ${t.from} → … : primary 'to' (${t.to}) must be the interchange = transfer.from (${t.transfer.from})`,
      );
      for (let i = 0; i < chain.length - 1; i += 1) {
        assert.notEqual(
          chain[i], chain[i + 1],
          `${day.date} transit chain has duplicate adjacent stop "${chain[i]}" in [${chain.join(' → ')}]`,
        );
      }
    }
  }
  assert.ok(checked > 0, 'expected at least one multi-leg transit item to be checked');
});

// --- Render smoke tests for the two new days --------------------------------

test('renderDay renders Jun 18 (Asakusa/Ueno day) without throwing', () => {
  withDom(() => {
    let r;
    assert.doesNotThrow(() => { r = renderDay(getDay('2026-06-18'), 'plan'); });
    assert.ok(r.node, 'a node is returned');
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
});

test('renderDay renders Jun 19 (teamLab/Ginza day) without throwing', () => {
  withDom(() => {
    let r;
    assert.doesNotThrow(() => { r = renderDay(getDay('2026-06-19'), 'plan'); });
    assert.ok(r.node, 'a node is returned');
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
});

test('renderDay renders Jun 20 (Tsukiji/Shinjuku nightlife day) without throwing', () => {
  withDom(() => {
    let r;
    assert.doesNotThrow(() => { r = renderDay(getDay('2026-06-20'), 'plan'); });
    assert.ok(r.node, 'a node is returned');
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
});

test('renderDay renders Jun 21 (Meiji/Omotesando/Shibuya day) without throwing', () => {
  withDom(() => {
    let r;
    assert.doesNotThrow(() => { r = renderDay(getDay('2026-06-21'), 'plan'); });
    assert.ok(r.node, 'a node is returned');
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
});

test("renderDay renders Jun 21 under the 'anticipation' framing without throwing", () => {
  // Pre-trip the landing/overview enters days via the 'anticipation' framing;
  // smoke-test the alternate framing path on a new day, mirroring how the
  // earlier authored days are exercised across framings.
  withDom(() => {
    let r;
    assert.doesNotThrow(() => { r = renderDay(getDay('2026-06-21'), 'anticipation'); });
    assert.ok(r.node, 'a node is returned');
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
});

// ===========================================================================
// Hakone leg (Jun 22-23) content contracts (author-hakone-leg)
// ===========================================================================
//
// These pin the human-corrected facts and structural validity of the two days
// that closed the Jun 16-23 gap. They are regression guards: a future accidental
// edit to data/days.js that drifts these facts (the Romancecar terminus, the
// Tamura non-veg warning, the Camp Coffee open-Tuesday lead, the Senkyoro lodging,
// or Megan's veg coverage) fails here. Facts are drawn from the authored data.

const VALID_TAGS = new Set([
  'meal', 'transit', 'sight', 'checkin', 'checkout', 'reservation', 'rest', 'bar', 'spa',
]);

// --- Criterion 7: schema / structural validity for the two new days ---------

test('Jun 22 exists, is Day 7, base Hakone, with a non-empty plan and valid tags', () => {
  const day = getDay('2026-06-22');
  assert.ok(day, 'Jun 22 should be present');
  assert.equal(day.dayNumber, 7, 'Jun 22 is Day 7');
  assert.equal(day.base, 'Hakone', 'Jun 22 base is Hakone');
  assert.ok(Array.isArray(day.plan) && day.plan.length > 0, 'Jun 22 has a non-empty plan');
  for (const item of day.plan) {
    assert.ok(VALID_TAGS.has(item.tag), `Jun 22 / "${item.title}" has a valid tag (got "${item.tag}")`);
  }
});

test('Jun 23 exists, is Day 8, base Hakone, with a non-empty plan and valid tags', () => {
  const day = getDay('2026-06-23');
  assert.ok(day, 'Jun 23 should be present');
  assert.equal(day.dayNumber, 8, 'Jun 23 is Day 8');
  assert.equal(day.base, 'Hakone', 'Jun 23 base is Hakone');
  assert.ok(Array.isArray(day.plan) && day.plan.length > 0, 'Jun 23 has a non-empty plan');
  for (const item of day.plan) {
    assert.ok(VALID_TAGS.has(item.tag), `Jun 23 / "${item.title}" has a valid tag (got "${item.tag}")`);
  }
});

test('Jun 22 and Jun 23 resolve by dayNumber too (getDayByNumber 7 -> Jun 22, 8 -> Jun 23)', () => {
  assert.equal(getDayByNumber(7).date, '2026-06-22', 'Day 7 is Jun 22');
  assert.equal(getDayByNumber(8).date, '2026-06-23', 'Day 8 is Jun 23');
});

test('Jun 22 and Jun 23 transit items all carry a complete transit object (mode/from/to + numeric minutes)', () => {
  for (const iso of ['2026-06-22', '2026-06-23']) {
    const transitItems = getDay(iso).plan.filter((p) => p.tag === 'transit');
    assert.ok(transitItems.length > 0, `${iso} should have at least one transit leg`);
    for (const item of transitItems) {
      assert.ok(item.transit, `${iso} / "${item.title}" must carry a transit object`);
      assert.equal(typeof item.transit.mode, 'string', `${iso} / "${item.title}" transit.mode`);
      assert.ok(item.transit.mode.length > 0, `${iso} / "${item.title}" transit.mode non-empty`);
      assert.equal(typeof item.transit.from, 'string', `${iso} / "${item.title}" transit.from`);
      assert.ok(item.transit.from.length > 0, `${iso} / "${item.title}" transit.from non-empty`);
      assert.equal(typeof item.transit.to, 'string', `${iso} / "${item.title}" transit.to`);
      assert.ok(item.transit.to.length > 0, `${iso} / "${item.title}" transit.to non-empty`);
      assert.equal(typeof item.transit.minutes, 'number', `${iso} / "${item.title}" transit.minutes numeric`);
      assert.ok(item.transit.minutes > 0, `${iso} / "${item.title}" transit.minutes positive`);
    }
  }
});

// Pin the EXACT per-leg transit minutes for the Hakone leg. The prior judges
// flagged that the loop/Romancecar leg durations asserted only `> 0`, so a
// fat-finger (85->8, or a swapped leg duration) would slip past. These minutes
// are the data points most likely to be mis-edited, so we pin each named leg's
// authored value. Legs are keyed by "from -> to" (unique within each day) so the
// mapping is self-documenting and a leg rename/removal also fails (the actual set
// of leg keys must equal the expected set). None of the Hakone legs are multi-leg
// transfers, so there is no `transfer.minutes` second leg to pin here.
const EXPECTED_TRANSIT_MINUTES = {
  '2026-06-22': {
    'Akasaka-mitsuke -> Shinjuku': 10,   // Marunouchi Line
    'Shinjuku -> Hakone-Yumoto': 85,     // Odakyu Romancecar
    'Hakone-Yumoto -> Senkyoro-Mae': 30, // Hakone Tozan Bus up to Sengokuhara
  },
  '2026-06-23': {
    'Senkyoro-Mae -> Gora Station': 13,           // Tozan bus down to Gora
    'Gora -> Sounzan': 9,                          // Tozan cable car
    'Sounzan -> Owakudani': 8,                     // ropeway leg 1
    'Owakudani -> Togendai': 16,                   // ropeway leg 2
    'Togendai-ko -> Moto-Hakone-ko': 30,           // pirate-ship cruise
    'Hakone-Jinja-Iriguchi -> Senkyoro-Mae': 40,  // Tozan bus back up
  },
};

test('Jun 22 + Jun 23 transit legs carry their EXACT authored minutes (value-pinned, not just > 0)', () => {
  for (const [iso, expected] of Object.entries(EXPECTED_TRANSIT_MINUTES)) {
    const actual = {};
    for (const item of getDay(iso).plan.filter((p) => p.tag === 'transit')) {
      const key = `${item.transit.from} -> ${item.transit.to}`;
      actual[key] = item.transit.minutes;
    }
    // The set of legs must match exactly — a renamed/added/removed leg fails here
    // before the per-value check (so this never silently skips a leg).
    assert.deepEqual(
      Object.keys(actual).sort(), Object.keys(expected).sort(),
      `${iso} transit legs (by from->to) must match the expected set`,
    );
    // Each named leg must carry exactly its authored minute value.
    assert.deepEqual(actual, expected, `${iso} every transit leg's minutes match its authored value`);
  }
});

// --- Criterion 1: Romancecar integrity (the highest-value corrected facts) ---

test('Jun 22 Romancecar is reserved and runs Shinjuku -> Hakone-Yumoto (NOT "Hakone")', () => {
  const day = getDay('2026-06-22');
  const romancecar = day.plan.find((p) => p.tag === 'transit' && /Romancecar/i.test(p.title));
  assert.ok(romancecar, 'a Romancecar transit item should be present on Jun 22');
  assert.equal(romancecar.reserved, true, 'the Romancecar is a confirmed booking (reserved:true)');
  assert.equal(romancecar.transit.from, 'Shinjuku', 'Romancecar departs Shinjuku');
  assert.equal(
    romancecar.transit.to, 'Hakone-Yumoto',
    'Romancecar terminus must be exactly "Hakone-Yumoto", not "Hakone"',
  );
});

test('Jun 22 Romancecar note records the booked Car-1 seats and the not-Free-Pass-covered surcharge', () => {
  const day = getDay('2026-06-22');
  const romancecar = day.plan.find((p) => p.tag === 'transit' && /Romancecar/i.test(p.title));
  assert.ok(romancecar, 'a Romancecar transit item should be present on Jun 22');
  assert.match(romancecar.note, /Car ?1/i, 'note should mention the booked Car 1 (front observation car)');
  assert.match(romancecar.note, /1C|1D|2C|2D/i, 'note should record the booked seat numbers');
  // The surcharge is explicitly NOT covered by the Hakone Free Pass — a human-
  // corrected fact that travelers rely on; guard the "not covered" phrasing.
  assert.match(
    romancecar.note, /not\s+covered\b[^.]*Free Pass/i,
    'note must state the Romancecar surcharge is NOT covered by the Hakone Free Pass',
  );
});

// --- Criterion 2: Tamura Ginkatsutei flagged non-vegetarian ------------------

test('Jun 23 Tamura Ginkatsutei rec flags it as NOT vegetarian (pork / dashi)', () => {
  const day = getDay('2026-06-23');
  const lunch = day.plan.find((p) => p.tag === 'meal' && /Lunch in Gora/i.test(p.title));
  assert.ok(lunch, 'a "Lunch in Gora" meal block should be present on Jun 23');
  const tamura = lunch.recommendations.find((r) => /Tamura/i.test(r.name));
  assert.ok(tamura, 'Tamura Ginkatsutei should be a Gora lunch rec');
  // Human correction: its "tofu-katsu" is pork + dashi, NOT vegetarian. Anchor on
  // the corrected facts (pork/dashi/not-veg signal), not the full warning prose.
  assert.match(
    tamura.con, /tofu|pork|dashi|not veg/i,
    'Tamura con must flag the non-vegetarian reality (tofu name / pork / dashi / not veg)',
  );
});

// --- Criterion 3: Camp Coffee lead Gora coffee rec, open Tuesday -------------

test('Jun 23 Camp Coffee is a Gora coffee rec noted as open Tuesday', () => {
  const day = getDay('2026-06-23');
  const coffee = day.plan.find((p) => p.tag === 'meal' && /Coffee in Gora/i.test(p.title));
  assert.ok(coffee, 'a "Coffee in Gora" block should be present on Jun 23');
  const camp = coffee.recommendations.find((r) => /Camp Coffee|COFFEE CAMP/i.test(r.name));
  assert.ok(camp, 'Camp Coffee should be a Gora coffee rec');
  // Human correction: official site has no regular closed day, so it IS open this
  // Tuesday (aggregators saying "closed Tue" are stale). The pros must say so.
  const campText = [camp.con, ...(camp.pros ?? [])].join(' ');
  assert.match(campText, /tuesday/i, 'Camp Coffee text must note it is open Tuesday');
});

// --- Criterion 4: NO Amam Dacotan on Jun 22 ----------------------------------

test('Jun 22 contains NO Amam reference (Amam Dacotan belongs to Jun 20/21 only)', () => {
  // Human correction: Amam Dacotan was moved off Day 7 so the morning is a relaxed
  // Akasaka breakfast with no crunch before the noon Romancecar. Scan titles, notes,
  // and every rec name/pro/con for any "Amam" mention.
  const day = getDay('2026-06-22');
  for (const item of day.plan) {
    const haystack = [
      item.title, item.note,
      ...(item.recommendations ?? []).flatMap((r) => [r.name, r.con, ...(r.pros ?? [])]),
    ].filter((s) => typeof s === 'string').join('   ');
    assert.doesNotMatch(
      haystack, /Amam/i,
      `Jun 22 plan must not reference Amam (found in "${item.title}")`,
    );
  }
});

// --- Criterion 5: Senkyoro lodging consistency across Jun 22/23/24 -----------

test('Jun 22 and Jun 23 share the identical Senkyoro lodging name + coords (and Jun 24 still references Senkyoro)', () => {
  // Cross-day invariant: the ryokan is the same place across the two Hakone
  // nights. If someone edits one day's lodging, this catches the drift. Expected
  // values pulled from the authored data. Jun 24's lodging is the next night's
  // Kyoto hotel (the move down), but its morning still starts AT Senkyoro — so we
  // assert the Senkyoro link survives in Jun 24's breakfast plan item, keeping the
  // hand-off between this task and add-jun24-checkout coherent.
  const EXPECTED_NAME = 'Senkyoro Ryokan';
  const EXPECTED_COORDS = { lat: 35.2596, lng: 139.0157 };
  for (const iso of ['2026-06-22', '2026-06-23']) {
    const lodging = getDay(iso).lodging;
    assert.ok(lodging, `${iso} should have lodging`);
    assert.equal(lodging.name, EXPECTED_NAME, `${iso} lodging is Senkyoro Ryokan`);
    assert.ok(lodging.coords, `${iso} lodging has coords`);
    assert.equal(lodging.coords.lat, EXPECTED_COORDS.lat, `${iso} Senkyoro lat matches`);
    assert.equal(lodging.coords.lng, EXPECTED_COORDS.lng, `${iso} Senkyoro lng matches`);
  }
  // Jun 24 morning still begins at Senkyoro (breakfast there before the bus down).
  const jun24 = getDay('2026-06-24');
  const senkyoroBreakfast = jun24.plan.find((p) => /Senkyoro/i.test(p.title) || /Senkyoro/i.test(p.note ?? ''));
  assert.ok(senkyoroBreakfast, 'Jun 24 should still reference Senkyoro (breakfast at the ryokan before the move to Kyoto)');
});

// --- Criterion 6: Megan veg-safe coverage on every non-booked meal -----------

test('every non-booked meal-with-recs on Jun 22 and Jun 23 keeps a Megan veg-safe rec', () => {
  // Robust, not brittle: only meals that actually carry a recommendations block
  // are required to keep a veg/vegan signal. Fixed ryokan meals (kaiseki dinner,
  // included breakfast) have no recs and are skipped — they're handled via prep.
  for (const iso of ['2026-06-22', '2026-06-23']) {
    const mealsWithRecs = getDay(iso).plan.filter(
      (p) => p.tag === 'meal' && p.reserved !== true && Array.isArray(p.recommendations) && p.recommendations.length > 0,
    );
    assert.ok(mealsWithRecs.length > 0, `${iso} should have at least one meal carrying recommendations`);
    for (const meal of mealsWithRecs) {
      assert.ok(
        meal.recommendations.length >= 1 && meal.recommendations.length <= 4,
        `${iso} / "${meal.title}" must carry 1-4 recommendations (has ${meal.recommendations.length})`,
      );
      // At least one rec advertises a veg/vegan option for Megan via its name,
      // pros, or con (e.g. "Megan's pick — vegetable rice bowls"). Matches the
      // data's actual signal and mirrors the Jun 20/21 anchor invariant.
      assert.ok(
        meal.recommendations.some((r) => {
          const text = [r.name, r.con, ...(r.pros ?? [])].filter((s) => typeof s === 'string').join(' ');
          // Matches vegetarian / vegetable / vegan / veggie (the data's actual
          // signals: "dedicated vegetarian sandwiches", "vegetable rice bowls").
          return /veg(etari|etabl|an|gie)/i.test(text);
        }),
        `${iso} / "${meal.title}" must keep at least one rec signalling a veg/vegan option for Megan`,
      );
    }
  }
});

// ===========================================================================
// revise-jun24-schedule — Jun 24 reservation-lock regressions.
//
// The Jun 24 dinner became a LOCKED reservation (Tousuiro Kiyamachi): its
// `recommendations` array was removed and `reserved:true` set. The Shinkansen
// down to Kyoto is likewise a confirmed booking (reserved:true) carrying a
// structured transit object. These two facts are the genuine regression risks
// of the revision; the rest of the edit was volatile content (exact times,
// prose) that the structural/invariant suite already guards. We deliberately
// do NOT pin the volatile clock times / minutes here (those can be re-corrected
// without being a regression) — only the booking-lock contract.
// ===========================================================================

test('Jun 24 dinner is a locked reservation with NO recommendations array (guards an accidental rec re-add)', () => {
  const day = getDay('2026-06-24');
  const dinner = day.plan.find((p) => p.tag === 'meal' && /Tousuiro/i.test(p.title));
  assert.ok(dinner, 'a Tousuiro dinner meal item should be present on Jun 24');
  assert.equal(dinner.reserved, true, 'the Tousuiro dinner is a confirmed booking (reserved:true)');
  // The reservation is locked, so the recommendations key must be ABSENT entirely
  // (not an empty array). If a future edit re-adds alternatives, this fails.
  assert.equal(
    Object.prototype.hasOwnProperty.call(dinner, 'recommendations'), false,
    'a locked reservation must NOT carry a recommendations key',
  );
});

test('Jun 24 Shinkansen to Kyoto is a reserved transit leg with a structurally complete transit object', () => {
  const day = getDay('2026-06-24');
  const shinkansen = day.plan.find((p) => p.tag === 'transit' && /Shinkansen/i.test(p.title));
  assert.ok(shinkansen, 'a Shinkansen transit item should be present on Jun 24');
  assert.equal(shinkansen.reserved, true, 'the Shinkansen down to Kyoto is a confirmed booking (reserved:true)');
  // Structural shape mirrors the structured-transit invariant (mode/from/to +
  // positive numeric minutes) — value-agnostic so a corrected time is not a fail.
  const t = shinkansen.transit;
  assert.ok(t, 'the Shinkansen item must carry a transit object');
  assert.equal(typeof t.mode, 'string');
  assert.ok(t.mode.length > 0, 'transit.mode non-empty');
  assert.equal(t.from, 'Odawara', 'Shinkansen departs Odawara (Hikari/Kodama — Nozomi skips Odawara)');
  assert.equal(t.to, 'Kyoto', 'Shinkansen terminus is Kyoto');
  assert.equal(typeof t.minutes, 'number');
  assert.ok(t.minutes > 0, 'transit.minutes positive');
});

// --- Render smoke tests for the two new days --------------------------------

test('renderDay renders Jun 22 (Romancecar to Hakone day) without throwing', () => {
  withDom(() => {
    let r;
    assert.doesNotThrow(() => { r = renderDay(getDay('2026-06-22'), 'plan'); });
    assert.ok(r.node, 'a node is returned');
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
});

test('renderDay renders Jun 23 (Hakone loop day) without throwing', () => {
  withDom(() => {
    let r;
    assert.doesNotThrow(() => { r = renderDay(getDay('2026-06-23'), 'plan'); });
    assert.ok(r.node, 'a node is returned');
    assert.doesNotThrow(() => { r.start(); r.stop(); });
  });
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
// gate, and walk-origin selection can be unit-tested directly, WITHOUT a DOM.
// (safeUrl / nearestPrecedingCoords were given a one-line `export` purely for
// testability; their behavior also surfaces through renderDay's DOM, asserted
// further below.)
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
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  focus() { stubDocument.activeElement = this; }
  scrollTo() {}
  get clientWidth() { return 0; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    const arr = this.listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  // Test-only helper: fire registered listeners (rec-toggle click, lightbox keys).
  _fire(type, evt) { (this.listeners[type] || []).slice().forEach((fn) => fn(evt)); }
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
  body: null,
  activeElement: null,
  _listeners: {},
  createElement(tag) { return new StubElement(tag); },
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
  removeEventListener(type, fn) {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },
  // Test-only: fire document-level listeners (lightbox keydown).
  _fire(type, evt) { (this._listeners[type] || []).slice().forEach((fn) => fn(evt)); },
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
  // Fresh document state per run so a body-mounted lightbox can't leak across tests.
  stubDocument.body = new StubElement('body');
  stubDocument.activeElement = null;
  stubDocument._listeners = {};
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

// --- Item 4 (cont.): reminisce "memory frame" + gallery ----------------------

test('renderDay wraps the header in the blue memory frame ONLY in reminisce, and drops the hero', () => {
  withDom(() => {
    const r = renderDay(fullDayFixture(), 'reminisce').node;
    assert.ok(r.firstByClass('reminisce-frame'), 'reminisce framing should include the memory frame');
    assert.equal(r.firstByClass('day-hero'), null, 'reminisce drops the hero slideshow');

    const p = renderDay(fullDayFixture(), 'plan').node;
    assert.equal(p.firstByClass('reminisce-frame'), null, 'plan framing has no memory frame');
    assert.ok(p.firstByClass('day-hero'), 'plan framing keeps the hero');

    assert.equal(renderDay(fullDayFixture(), 'anticipation').node.firstByClass('reminisce-frame'), null);
  });
});

test('reminisce shows the empty-photo note for a day with no gallery photos', () => {
  withDom(() => {
    const r = renderDay({ ...fullDayFixture(), photos: [] }, 'reminisce').node;
    assert.ok(r.firstByClass('reminisce-empty-note'), 'no-photo day shows the empty note');
    assert.equal(r.firstByClass('reminisce-gallery'), null, 'no gallery rendered when empty');
    assert.equal(r.firstByClass('reminisce-frame-seam').textContent, 'No photos yet');
  });
});

test('reminisce renders a clickable gallery from the day photos', () => {
  withDom(() => {
    const r = renderDay(fullDayFixture(), 'reminisce').node; // fixture has 3 photos
    const gallery = r.firstByClass('reminisce-gallery');
    assert.ok(gallery, 'gallery present for a day with photos');
    const thumbs = r.byClass('reminisce-photo');
    assert.equal(thumbs.length, 3, 'one thumbnail per authored photo');
    assert.equal(thumbs[0].tagName, 'BUTTON', 'thumbnails are real buttons (focusable)');
    assert.match(r.firstByClass('reminisce-frame-seam').textContent, /^3 photos$/);
    // The lightbox mounts on <body> only when opened — it must NOT be inside the view tree.
    assert.equal(r.firstByClass('lightbox'), null, 'lightbox is not pre-mounted inside the day view');
  });
});

test('reminisce gallery is capped at REMINISCE_GALLERY_MAX thumbnails', () => {
  withDom(() => {
    const photos = Array.from({ length: 15 }, (_, i) => ({ url: `https://example.com/${i}.jpg`, alt: `p${i}` }));
    const r = renderDay({ ...fullDayFixture(), photos }, 'reminisce').node;
    assert.equal(r.byClass('reminisce-photo').length, 12, 'capped at 12 of the 15 photos');
    assert.match(r.firstByClass('reminisce-frame-seam').textContent, /^12 photos$/);
  });
});

test('reminisce lightbox: tapping a thumbnail mounts it on <body>, Esc closes + restores focus', () => {
  withDom(() => {
    const r = renderDay(fullDayFixture(), 'reminisce'); // 3 photos
    const thumb = r.node.byClass('reminisce-photo')[2]; // third photo
    thumb.focus();                                       // the element that "opens" it
    assert.equal(document.body.byClass('lightbox').length, 0, 'nothing mounted before tap');

    thumb._fire('click');
    const lb = document.body.firstByClass('lightbox');
    assert.ok(lb, 'lightbox is mounted on <body> when opened (escapes the day-view containing block)');
    assert.equal(lb.hidden, false, 'lightbox is visible');
    assert.equal(lb.firstByClass('lightbox-counter').textContent, '3 / 3', 'counter opens at the tapped index');

    document._fire('keydown', { key: 'Escape', preventDefault() {} });
    assert.equal(document.body.byClass('lightbox').length, 0, 'Esc unmounts the lightbox from <body>');
    assert.equal(document.activeElement, thumb, 'focus is restored to the originating thumbnail');
  });
});

test('reminisce lightbox: renderDay stop() tears down an open lightbox (no leak across navigation)', () => {
  withDom(() => {
    const r = renderDay(fullDayFixture(), 'reminisce');
    r.node.byClass('reminisce-photo')[0]._fire('click');
    assert.equal(document.body.byClass('lightbox').length, 1, 'open before navigation');
    r.stop(); // mountApp calls this before discarding the view
    assert.equal(document.body.byClass('lightbox').length, 0, 'stop() removed the body-mounted lightbox');
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

test('renderDay shows a walking-time line when both origin and recommendation have coords (item 6)', () => {
  withDom(() => {
    // Fixture: plan[0] Yasaka has coords (origin), rec[0] Tousuiro has coords.
    const node = renderDay(fullDayFixture(), 'plan').node;
    const walks = node.byClass('rec-walk');
    assert.ok(walks.length >= 1, 'expected a walk line for the coord-bearing recommendation');
    const walk = walks[0];
    assert.match(walk.textContent, /\d+ min/, 'walk line shows a minute estimate');
    assert.doesNotMatch(walk.textContent, /walk/, 'walk line no longer carries the word "walk"');
    assert.doesNotMatch(walk.textContent, /\bm\b|km/, 'walk line no longer shows the metres/km distance');
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

test('renderDay still renders a rec transit pill when there is no walkable origin (airport-transfer case)', () => {
  withDom(() => {
    const day = fullDayFixture();
    // No usable origin (strip preceding + lodging coords), and the rec itself has
    // no coords — but it DOES carry a transit block. The pill must still render:
    // the walk distance is gated on finite metres, the transit pill must not be.
    delete day.plan[0].coords;
    day.lodging.coords = undefined;
    day.plan[1].recommendations = [
      { name: 'Airport transfer', pros: ['Direct'], con: 'Slow.',
        transit: { mode: 'bus', line: 'Limousine', from: 'NRT T1', to: 'Kioicho', minutes: 110 } },
    ];
    const node = renderDay(day, 'plan').node;
    assert.equal(node.byClass('rec-walk').length, 1, 'one line for the lone transit-bearing rec');
    assert.equal(node.byClass('rec-walk-from').length, 0, 'no "from <origin>" segment without a walkable origin');
    assert.equal(node.byClass('rec-transit').length, 1, 'transit pill still renders');
    assert.match(node.firstByClass('rec-transit').textContent, /110 min/, 'pill carries the route minutes');
  });
});

// --- Rec transit-alternative pill (add-transit-alternative-to-recs) ---------

/**
 * When a rec carries a `transit` field, the .rec-walk paragraph renders the
 * walk segment WITHOUT the "min walk" / distance wording (emoji + mode emoji
 * convey it), then a " · " separator, then an inline .rec-transit span with
 * the mode emoji(s), total minutes, and the stop chain.
 */
test('renderDay renders an inline transit-alternative pill when a rec has a transit field (single-leg)', () => {
  withDom(() => {
    const day = fullDayFixture();
    // Anchor coords on plan[0] (Yasaka). Synthesize a far-away rec with a
    // single-leg bus transit field.
    day.plan[1].recommendations = [
      {
        name: 'Faraway izakaya',
        pros: ['Worth the trip'],
        con: 'Far on foot.',
        mapUrl: 'https://maps.google.com/?q=Faraway',
        coords: { lat: 35.0500, lng: 135.8000 },
        transit: { mode: 'bus', line: 'Kyoto City Bus 207', from: 'Higashiyama-Yasui', to: 'Shijo-Kawaramachi', minutes: 18 },
      },
    ];
    const node = renderDay(day, 'plan').node;
    const walks = node.byClass('rec-walk');
    assert.equal(walks.length, 1, 'exactly one walk line for the lone rec');
    const walk = walks[0];
    // Walk half: stripped of "min walk" / distance label — just "<n> min from <anchor>".
    assert.doesNotMatch(walk.textContent, /min walk/, 'transit-bearing rec drops the "min walk" wording');
    assert.match(walk.textContent, /from Yasaka Shrine/, 'walk half names the anchor');
    // Separator + transit span present.
    const seps = node.byClass('rec-walk-sep');
    assert.equal(seps.length, 1, 'a .rec-walk-sep separator span is rendered between the walk and transit halves');
    assert.equal(seps[0].textContent, ' · ', 'separator carries the " · " glyph');
    assert.equal(node.byClass('rec-transit').length, 1, 'rec-transit span rendered');
    const transit = node.firstByClass('rec-transit');
    assert.match(transit.textContent, /🚌/, 'bus emoji rendered');
    assert.match(transit.textContent, /18 min/, 'transit minutes rendered');
    assert.match(transit.textContent, /Higashiyama-Yasui → Shijo-Kawaramachi/, 'stop chain rendered');
  });
});

test('renderDay falls back to the legacy walk pill when rec.transit is present but missing from/to', () => {
  withDom(() => {
    // Defensive branch in buildPlanItem: `hasTransit` requires BOTH from and to
    // on the transit object. A half-authored transit field (e.g. mode only)
    // should NOT trigger the transit-pill path — render the legacy walk line.
    const day = fullDayFixture();
    day.plan[1].recommendations = [
      {
        name: 'Half-authored transit rec',
        pros: ['Worth it'],
        con: 'Far.',
        coords: { lat: 35.0500, lng: 135.8000 },
        transit: { mode: 'bus', minutes: 18 }, // no from/to
      },
    ];
    const node = renderDay(day, 'plan').node;
    const walks = node.byClass('rec-walk');
    assert.equal(walks.length, 1, 'exactly one walk line');
    assert.match(walks[0].textContent, /\d+ min · from /, 'falls back to the no-transit walk format when from/to are missing');
    assert.equal(node.byClass('rec-transit').length, 0, 'no rec-transit span when transit is incomplete');
  });
});

test('renderDay concatenates emojis and chains stops for a 2-leg transit rec (transfer)', () => {
  withDom(() => {
    const day = fullDayFixture();
    day.plan[1].recommendations = [
      {
        name: 'Multi-leg rec',
        pros: ['Worth it'],
        con: 'Far.',
        coords: { lat: 35.0500, lng: 135.8000 },
        transit: {
          mode: 'train', line: 'Kintetsu Limited Express', from: 'Kintetsu-Nara', to: 'Kyoto', minutes: 38,
          transfer: { mode: 'subway', line: 'Karasuma Line', from: 'Kyoto', to: 'Shijo', minutes: 7 },
        },
      },
    ];
    const node = renderDay(day, 'plan').node;
    const transit = node.firstByClass('rec-transit');
    assert.ok(transit, 'rec-transit span rendered');
    // Both emojis appear (train + subway), concatenated.
    assert.match(transit.textContent, /🚆/, 'train emoji');
    assert.match(transit.textContent, /Ⓜ️/, 'subway emoji');
    // Total minutes = 38 + 7 = 45.
    assert.match(transit.textContent, /45 min/, 'sums primary + transfer minutes');
    // Stop chain includes all three endpoints.
    assert.match(transit.textContent, /Kintetsu-Nara → Kyoto → Shijo/, 'chained 3-stop sequence');
  });
});

test('renderDay renders the minutes-only walk pill for recs without a transit field', () => {
  withDom(() => {
    // The default fixture's Tousuiro rec has coords but NO transit field — it
    // should render the "N min · from <origin>" format (no metres, no "walk").
    const node = renderDay(fullDayFixture(), 'plan').node;
    const walks = node.byClass('rec-walk');
    assert.equal(walks.length, 1);
    assert.match(walks[0].textContent, /^\d+ min · from /, 'minutes-only walk format');
    assert.doesNotMatch(walks[0].textContent, /walk/, 'no "walk" wording');
    assert.equal(node.byClass('rec-transit').length, 0, 'no rec-transit span when rec.transit is absent');
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

test('pickLandingView DURING the trip lands on a PRESENT day for every in-window date (trip fully authored)', () => {
  // The trip is now authored end-to-end, so landing on any in-window calendar
  // day returns a 'day' descriptor with a real day (never a null placeholder)
  // and 'plan' framing (same calendar day as now). This supersedes the former
  // "absent day → null day" check: no in-window absent day exists anymore.
  for (const iso of tripWindowDates()) {
    const [y, m, d] = iso.split('-').map(Number);
    const view = pickLandingView(localDate(y, m - 1, d, 10, 0));
    assert.equal(view.view, 'day', `${iso} is a day view`);
    assert.ok(view.day, `${iso} resolves to an authored day`);
    assert.equal(view.day.date, iso, `${iso} lands on its own day`);
    assert.equal(view.framing, 'plan', `${iso} on its own calendar day is plan framing`);
  }
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

test('tripWindowDates spans the authored leg correctly (every window date is now an authored day)', () => {
  const dates = tripWindowDates();
  assert.ok(dates.includes('2026-06-24'), 'authored leg start is in the window');
  // The window enumerates every trip day, and the trip is now fully authored:
  // every window date resolves to a present day (no absent/gap date remains).
  const authored = new Set(getDays().map((d) => d.date));
  for (const iso of dates) {
    assert.ok(authored.has(iso), `window date ${iso} is authored`);
  }
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
        assert.equal(pos, 'June 16th - Day 1', 'position label shows Day 1 at the window start');
        // Clicking the (disabled) Prev / navigating below 0 is a clamped no-op:
        // still on Day 1, still no crash.
        ctl.go(-5);
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 16th - Day 1', 'clamped to Day 1, no underflow');
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
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'July 3rd - Day 18');
        // Navigating beyond the end is a clamped no-op.
        ctl.go(999);
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'July 3rd - Day 18', 'clamped to Day 18, no overflow');
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
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 16th - Day 1');
        // Fire the Next button's click listener (drives navigate(index+1)).
        root.firstByClass('day-nav-next')._fire('click');
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 17th - Day 2', 'advanced to Day 2');
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
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 24th - Day 9', 'starts on Jun 24');
        const cta = root.firstByClass('evening-prep-cta');
        assert.ok(cta, 'evening prep CTA present');
        // Clicking the CTA must move the day view to tomorrow (Day 10 / Jun 25).
        cta._fire('click');
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 25th - Day 10', 'CTA navigated to the next day');
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
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'July 3rd - Day 18', 'on the last window day');
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
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 24th - Day 9', 'lands on today');
        assert.ok(root.firstByClass('evening-prep'), 'CTA present on today in the evening window');

        // Page forward to a FUTURE day (still 22:00) → "tomorrow" no longer means
        // the day after this one, so the CTA must be gone.
        ctrl.toIso('2026-06-26'); // Day 11
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 26th - Day 11', 'navigated to a future day');
        assert.equal(root.firstByClass('evening-prep'), null,
          'no prep CTA when viewing a non-today day in the evening window');

        // And back to today → CTA returns.
        ctrl.toIso('2026-06-24'); // back to today (Day 9)
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 24th - Day 9', 'back on today');
        assert.ok(root.firstByClass('evening-prep'), 'CTA reappears on today');
      } finally {
        setNow(null);
      }
    });
  });
});

// --- nav-back-to-home: Home button + toOverview controller method ----------

test('mountApp controller exposes toOverview() alongside go/toIso/destroy', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 5, 24, 12, 0)); // mid-trip → day view landing
        const root = makeRoot();
        const ctl = mountApp(root);
        assert.ok(ctl, 'controller returned');
        assert.equal(typeof ctl.toOverview, 'function', 'toOverview is a function');
      } finally {
        setNow(null);
      }
    });
  });
});

test('day-nav bar renders a Home button (🏠) with the "Trip overview" aria-label', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 5, 24, 12, 0));
        const root = makeRoot();
        mountApp(root);
        const home = root.firstByClass('day-nav-home');
        assert.ok(home, 'home button rendered in the day-nav bar');
        assert.equal(home.textContent, '🏠', 'home button shows the 🏠 icon');
        assert.equal(home.getAttribute('aria-label'), 'Trip overview',
          'home button is labeled for screen readers');
        assert.equal(home.type, 'button', 'home button has type="button" (no form submit)');
      } finally {
        setNow(null);
      }
    });
  });
});

test('Home button is the LEADING child of the day-nav bar (before Prev)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 5, 24, 12, 0));
        const root = makeRoot();
        mountApp(root);
        const nav = root.firstByClass('day-nav');
        // Children order: home, group(prev, label, next).
        assert.ok(nav.children[0]._classList.contains('day-nav-home'),
          'first nav child is the Home button');
        assert.ok(nav.children[1]._classList.contains('day-nav-group'),
          'second nav child is the prev/label/next group');
        assert.ok(nav.children[1].children[0]._classList.contains('day-nav-prev'),
          'group leads with the Prev button');
      } finally {
        setNow(null);
      }
    });
  });
});

test('Home button click replaces the day view with the overview (no day-nav chrome remains)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 5, 24, 12, 0)); // lands on Jun 24 (Day 9)
        const root = makeRoot();
        mountApp(root);
        assert.ok(root.firstByClass('day-nav'), 'precondition: day-nav present');
        // Click Home → overview takes over.
        root.firstByClass('day-nav-home')._fire('click');
        assert.equal(root.firstByClass('day-nav'), null, 'day-nav removed');
        assert.ok(root.firstByClass('overview-view'), 'overview mounted');
        // Mid-trip overview shows "The adventure is underway." (no countdown num).
        assert.equal(root.firstByClass('overview-count-num'), null,
          'no countdown number mid-trip — pickLandingView gives no daysUntil');
      } finally {
        setNow(null);
      }
    });
  });
});

test('round-trip: Home → overview → tap a day-index row → that day view loads', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 5, 24, 12, 0)); // start on Day 9
        const root = makeRoot();
        mountApp(root);
        // Go home.
        root.firstByClass('day-nav-home')._fire('click');
        assert.ok(root.firstByClass('overview-view'), 'on overview');
        // Tap a day-index row (rows are appended in tripWindowDates order:
        // 18 rows, Jun 16 → Jul 3 → Jun 25 = index 9 = Day 10).
        const rows = root.byClass('day-index-row');
        assert.equal(rows.length, 18, 'overview rendered all 18 trip-window rows');
        rows[9]._fire('click');
        assert.ok(root.firstByClass('day-nav'), 'day view re-mounted after tapping overview row');
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 25th - Day 10',
          'navigated to the tapped day (Jun 25 = Day 10)');
      } finally {
        setNow(null);
      }
    });
  });
});

test('toOverview() is callable as a programmatic API (same effect as the Home button)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 5, 24, 12, 0));
        const root = makeRoot();
        const ctl = mountApp(root);
        assert.ok(root.firstByClass('day-nav'), 'precondition: day-nav present');
        ctl.toOverview();
        assert.equal(root.firstByClass('day-nav'), null, 'day-nav gone after toOverview()');
        assert.ok(root.firstByClass('overview-view'), 'overview mounted');
      } finally {
        setNow(null);
      }
    });
  });
});

test('Home button works on the (now-authored) Hakone leg day-view', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 5, 24, 12, 0)); // land mid-trip so day-view shows
        const root = makeRoot();
        const ctl = mountApp(root);
        ctl.toIso('2026-06-22'); // a now-authored Hakone day (was the unauthored leg)
        assert.ok(root.firstByClass('day-nav'), 'day-nav present on the day-view');
        const home = root.firstByClass('day-nav-home');
        assert.ok(home, 'home button present on the day-view');
        home._fire('click');
        assert.ok(root.firstByClass('overview-view'), 'overview reachable from the day-view');
      } finally {
        setNow(null);
      }
    });
  });
});

test('Home button is rendered on EVERY framing (anticipation / plan / reminisce)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        // anticipation: day in the future relative to now
        setNow(() => localDate(2026, 5, 24, 12, 0)); // Jun 24 = today
        let root = makeRoot();
        let ctl = mountApp(root);
        ctl.toIso('2026-06-27'); // future
        assert.ok(root.firstByClass('day-nav-home'), 'home button present in anticipation framing');

        // plan: today
        root = makeRoot();
        mountApp(root);
        assert.ok(root.firstByClass('day-nav-home'), 'home button present in plan framing');

        // reminisce: past
        ctl = mountApp(makeRoot()); // throwaway
        root = makeRoot();
        ctl = mountApp(root);
        ctl.toIso('2026-06-20'); // before today
        assert.ok(root.firstByClass('day-nav-home'), 'home button present in reminisce framing');
      } finally {
        setNow(null);
      }
    });
  });
});

test('pre-trip overview (boot-time) has no day-nav and no Home button (overview IS home)', () => {
  withDom(() => {
    withTimerSpies(() => {
      try {
        setNow(() => localDate(2026, 4, 24, 12, 0)); // before the trip
        const root = makeRoot();
        mountApp(root);
        assert.ok(root.firstByClass('overview-view'), 'overview mounted');
        assert.equal(root.firstByClass('day-nav'), null, 'no day-nav on the overview');
        assert.equal(root.firstByClass('day-nav-home'), null, 'no Home button on the overview itself');
      } finally {
        setNow(null);
      }
    });
  });
});

test('frameForDay frames a day purely by its calendar date (works off the ISO date alone)', () => {
  // frameForDay works off the ISO date alone (not the authored payload), so the
  // lifecycle framing is correct relative to now for any in-window day. Uses an
  // authored Hakone day (Jun 23) now that the former unauthored leg is filled.
  const iso = '2026-06-23';
  const [y, m, d] = iso.split('-').map(Number);
  assert.equal(frameForDay(iso, localDate(y, m - 1, d - 1, 12, 0)), 'anticipation', 'before that calendar day');
  assert.equal(frameForDay(iso, localDate(y, m - 1, d, 12, 0)), 'plan', 'on that calendar day');
  assert.equal(frameForDay(iso, localDate(y, m - 1, d + 1, 12, 0)), 'reminisce', 'after that calendar day');
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

test('renderOverview shows EVERY row as day.base + "Planned" (trip fully authored, no TBD rows remain)', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0));
      const rows = renderOverview(23, () => {}).node.byClass('day-index-row');

      // The trip is now authored end-to-end, so no row is "TBD" — every row maps
      // to a present day, shows its day.base region, the "Planned" status, and
      // carries no tbd class. (The former unauthored Jun 18–23 rows are gone.)
      const dates = tripWindowDates();
      assert.equal(rows.length, dates.length, '18 rows, one per trip-window date');
      rows.forEach((row, i) => {
        const iso = dates[i];
        const day = getDay(iso);
        assert.ok(day, `row ${i} (${iso}) is an authored day`);
        assert.equal(row.classList.contains('day-index-row-tbd'), false, `row ${i} (${iso}) has no tbd class`);
        assert.equal(row.firstByClass('day-index-region').textContent, day.base, `row ${i} (${iso}) shows its base`);
        assert.equal(row.firstByClass('day-index-status').textContent, 'Planned', `row ${i} (${iso}) is Planned`);
      });
    } finally {
      setNow(null);
    }
  });
});

test('renderOverview row shows the derived "Day N" number and a tz-safe date label', () => {
  withDom(() => {
    try {
      setNow(() => localDate(2026, 4, 24, 12, 0));
      const rows = renderOverview(23, () => {}).node.byClass('day-index-row');

      // Jun 16 (index 0) is now authored (Day 1, "In transit") — its "Day 1"
      // number is the derived dayNumber. Off-by-one numbering would surface here.
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
        assert.equal(root.firstByClass('day-nav-pos').textContent, 'June 24th - Day 9', 'tapped Jun 24 → Day 9');
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

// ===========================================================================
// collapsible-day-parts — bucketing helper, validator, render
//
// Covers:
//   A. bucketPlanByDayPart pure helper (no DOM)
//   B. buildValidatedDays accepting/sanitizing the optional `dayParts` field
//   C. renderDay's per-bucket collapsible <section class="day-part"> rendering
//
// Boundaries (per spec): hour < 12 = Morning, 12 ≤ hour ≤ 16 = Afternoon,
// hour ≥ 17 = Evening. Items lacking a parseable `time` bucket into Morning
// AND emit a console.warn.
// ===========================================================================

// --- Group A: bucketPlanByDayPart pure helper -------------------------------

test('bucketPlanByDayPart: empty plan returns three empty buckets in order', () => {
  const buckets = bucketPlanByDayPart([]);
  assert.equal(buckets.length, 3);
  assert.deepEqual(buckets.map((b) => b.name), ['Morning', 'Afternoon', 'Evening']);
  buckets.forEach((b) => assert.deepEqual(b.items, []));
});

test('bucketPlanByDayPart: all-Morning plan keeps order in Morning only', () => {
  const plan = [
    { time: '06:30', title: 'A' },
    { time: '09:15', title: 'B' },
    { time: '11:00', title: 'C' },
  ];
  const [morning, afternoon, evening] = bucketPlanByDayPart(plan);
  assert.equal(morning.items.length, 3);
  assert.deepEqual(morning.items.map((b) => b.item.title), ['A', 'B', 'C']);
  assert.equal(afternoon.items.length, 0);
  assert.equal(evening.items.length, 0);
});

test('bucketPlanByDayPart: items at 09:00 / 13:00 / 19:00 fan out one per bucket', () => {
  const plan = [
    { time: '09:00', title: 'Shrine' },
    { time: '13:00', title: 'Lunch' },
    { time: '19:00', title: 'Dinner' },
  ];
  const [morning, afternoon, evening] = bucketPlanByDayPart(plan);
  assert.equal(morning.items.length, 1);
  assert.equal(afternoon.items.length, 1);
  assert.equal(evening.items.length, 1);
  assert.equal(morning.items[0].item.title, 'Shrine');
  assert.equal(afternoon.items[0].item.title, 'Lunch');
  assert.equal(evening.items[0].item.title, 'Dinner');
});

test('bucketPlanByDayPart: boundary times 11:59, 12:00, 16:59, 17:00 land in the correct buckets', () => {
  const plan = [
    { time: '11:59', title: 'Late morning' },
    { time: '12:00', title: 'Noon' },
    { time: '16:59', title: 'Late afternoon' },
    { time: '17:00', title: 'Early evening' },
  ];
  const [morning, afternoon, evening] = bucketPlanByDayPart(plan);
  assert.deepEqual(morning.items.map((b) => b.item.title), ['Late morning']);
  assert.deepEqual(afternoon.items.map((b) => b.item.title), ['Noon', 'Late afternoon']);
  assert.deepEqual(evening.items.map((b) => b.item.title), ['Early evening']);
});

test('bucketPlanByDayPart: indexInPlan preserves each item’s ORIGINAL position across mixed buckets', () => {
  // Mixed-bucket plan of 6 items; the helper must thread the full-plan index
  // through so downstream walking-distance lookups still see preceding stops.
  const plan = [
    { time: '08:00', title: '0M' }, // index 0 → Morning
    { time: '13:30', title: '1A' }, // index 1 → Afternoon
    { time: '10:00', title: '2M' }, // index 2 → Morning
    { time: '20:00', title: '3E' }, // index 3 → Evening
    { time: '15:00', title: '4A' }, // index 4 → Afternoon
    { time: '07:00', title: '5M' }, // index 5 → Morning
  ];
  const [morning, afternoon, evening] = bucketPlanByDayPart(plan);
  // Morning gathers original indices 0, 2, 5 in input order.
  assert.deepEqual(morning.items.map((b) => b.indexInPlan), [0, 2, 5]);
  // Afternoon gathers original indices 1, 4 in input order.
  assert.deepEqual(afternoon.items.map((b) => b.indexInPlan), [1, 4]);
  // Evening gathers original index 3.
  assert.deepEqual(evening.items.map((b) => b.indexInPlan), [3]);
  // And every indexInPlan resolves back to the same item identity in the input.
  [...morning.items, ...afternoon.items, ...evening.items].forEach(({ item, indexInPlan }) => {
    assert.equal(item, plan[indexInPlan], 'indexInPlan must point to the same item ref in the input plan');
  });
});

test('bucketPlanByDayPart: items with missing or unparseable time bucket into Morning AND warn', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const plan = [
    { title: 'No time field' },               // missing time
    { time: 'not-a-time', title: 'Garbage' }, // unparseable time
  ];
  const [morning, afternoon, evening] = bucketPlanByDayPart(plan);
  assert.equal(morning.items.length, 2, 'both unparseable items land in Morning');
  assert.deepEqual(morning.items.map((b) => b.item.title), ['No time field', 'Garbage']);
  assert.equal(afternoon.items.length, 0);
  assert.equal(evening.items.length, 0);
  // Both items must produce a warning (one each).
  assert.ok(warn.mock.calls.length >= 2, 'expected at least one warning per unparseable item');
});

test('bucketPlanByDayPart: returned bucket order is Morning → Afternoon → Evening regardless of input order', () => {
  // Feed Evening-first, then Morning, then Afternoon items; output order must
  // still be the canonical Morning/Afternoon/Evening sequence.
  const plan = [
    { time: '21:00', title: 'late' },
    { time: '07:00', title: 'early' },
    { time: '14:00', title: 'mid' },
  ];
  const buckets = bucketPlanByDayPart(plan);
  assert.deepEqual(buckets.map((b) => b.name), ['Morning', 'Afternoon', 'Evening']);
});

// --- Group B: buildValidatedDays accepts/sanitizes dayParts -----------------

test('buildValidatedDays keeps a valid dayParts object verbatim on the validated day', () => {
  const day = {
    date: '2026-06-24', base: 'Kyoto', title: 't', plan: [], photos: [],
    dayParts: { morning: 'M', afternoon: 'A', evening: 'E' },
  };
  const result = buildValidatedDays([day], TRIP_STUB);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].dayParts, { morning: 'M', afternoon: 'A', evening: 'E' });
});

test('buildValidatedDays strips a non-object dayParts and warns', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const day = {
    date: '2026-06-24', base: 'Kyoto', title: 't', plan: [], photos: [],
    dayParts: 'not-an-object',
  };
  const result = buildValidatedDays([day], TRIP_STUB);
  assert.equal(result.length, 1);
  assert.equal('dayParts' in result[0], false, 'malformed dayParts must be dropped entirely');
  assert.ok(warn.mock.calls.length >= 1, 'expected a warning for the non-object dayParts');
});

test('buildValidatedDays strips only the offending per-field non-string and keeps the rest', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const day = {
    date: '2026-06-24', base: 'Kyoto', title: 't', plan: [], photos: [],
    dayParts: { morning: 'M', afternoon: 123, evening: 'E' },
  };
  const result = buildValidatedDays([day], TRIP_STUB);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].dayParts, { morning: 'M', evening: 'E' });
  assert.ok(warn.mock.calls.length >= 1, 'expected a warning for the dropped per-field value');
});

test('buildValidatedDays drops dayParts entirely when every field is invalid (no empty {} left behind)', (t) => {
  t.mock.method(console, 'warn', () => {});
  const day = {
    date: '2026-06-24', base: 'Kyoto', title: 't', plan: [], photos: [],
    dayParts: { morning: 1, afternoon: 2, evening: 3 },
  };
  const result = buildValidatedDays([day], TRIP_STUB);
  assert.equal(result.length, 1);
  assert.equal('dayParts' in result[0], false,
    'all-invalid dayParts should be dropped from the validated day, not left as {} or undefined');
});

test('buildValidatedDays leaves dayParts undefined when absent, with no warning', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const day = { date: '2026-06-24', base: 'Kyoto', title: 't', plan: [], photos: [] };
  const result = buildValidatedDays([day], TRIP_STUB);
  assert.equal(result.length, 1);
  assert.equal(result[0].dayParts, undefined);
  assert.equal('dayParts' in result[0], false);
  assert.equal(warn.mock.calls.length, 0, 'no warning should fire for an absent (optional) dayParts');
});

// --- Group C: renderDay bucket rendering ------------------------------------

// Shared fixture for render-bucket tests: items across all three buckets.
function multiBucketFixture() {
  return {
    date: '2026-06-24', dayNumber: 9, base: 'Kyoto', title: 'A full day',
    intro: 'Across the day.', photos: [], lodging: null,
    plan: [
      { time: '09:00', tag: 'sight', title: 'Yasaka Shrine',
        coords: { lat: 35.0036, lng: 135.7785 } },
      { time: '13:00', tag: 'meal', title: 'Riverside Lunch',
        recommendations: [
          { name: 'Tousuiro Kiyamachi', pros: ['Riverside'], con: 'Reservation needed.',
            coords: { lat: 35.0040, lng: 135.7710 } },
        ] },
      { time: '20:00', tag: 'meal', title: 'Late Ramen' },
    ],
  };
}

test('renderDay (multi-bucket day): produces exactly three .day-part sections', () => {
  withDom(() => {
    const node = renderDay(multiBucketFixture(), 'plan').node;
    assert.equal(node.byClass('day-part').length, 3,
      'one section per non-empty bucket — Morning, Afternoon, Evening');
  });
});

test('renderDay: section headers use the AUTHORED dayParts summary when present', () => {
  withDom(() => {
    const day = multiBucketFixture();
    day.dayParts = {
      morning: 'A gentle start at Yasaka.',
      afternoon: 'Lunch on the river.',
      evening: 'Ramen to close the day.',
    };
    const node = renderDay(day, 'plan').node;
    const summaries = node.byClass('day-part-summary').map((n) => n.textContent);
    assert.deepEqual(summaries, [
      'A gentle start at Yasaka.',
      'Lunch on the river.',
      'Ramen to close the day.',
    ]);
  });
});

test('renderDay: section headers fall back to a derived summary when dayParts is absent', () => {
  withDom(() => {
    const day = multiBucketFixture();
    delete day.dayParts;
    const node = renderDay(day, 'plan').node;
    const summaries = node.byClass('day-part-summary');
    assert.ok(summaries.length >= 1, 'expected at least one derived summary span');
    // For the Morning bucket the only item is "Yasaka Shrine" — derived summary
    // is built from item titles joined by " • ", possibly truncated. We don't
    // over-specify; just assert non-empty and that it appears as a substring of
    // the canonical joined-titles string for that bucket.
    const allTitles = day.plan.map((i) => i.title).join(' • ');
    summaries.forEach((s) => {
      assert.ok(s.textContent.length > 0, 'derived summary should be non-empty');
      // Each derived summary is built from titles belonging to its bucket; every
      // word in the summary must appear somewhere in the full title set.
      // Strip the trailing ellipsis character that the truncator may add.
      const cleaned = s.textContent.replace(/\s?…$/, '').trim();
      if (cleaned.length > 0) {
        assert.ok(
          allTitles.includes(cleaned.split(' • ')[0]),
          `derived summary "${s.textContent}" should be drawn from item titles`,
        );
      }
    });
  });
});

test('renderDay: every .day-part-body is hidden by default after render (collapsed initial state)', () => {
  withDom(() => {
    const node = renderDay(multiBucketFixture(), 'plan').node;
    const bodies = node.byClass('day-part-body');
    assert.equal(bodies.length, 3);
    bodies.forEach((b) => assert.equal(b.hidden, true,
      'each day-part body must start hidden so the day-view opens compact'));
    // And every header must have aria-expanded="false" to match.
    const headers = node.byClass('day-part-header');
    assert.equal(headers.length, 3);
    headers.forEach((h) => assert.equal(h.getAttribute('aria-expanded'), 'false'));
  });
});

test('renderDay: a Morning-only plan renders exactly one .day-part section (empty buckets are dropped)', () => {
  withDom(() => {
    const day = multiBucketFixture();
    day.plan = [
      { time: '08:00', tag: 'sight', title: 'Sunrise walk' },
      { time: '10:30', tag: 'cafe', title: 'Coffee stop' },
    ];
    const node = renderDay(day, 'plan').node;
    assert.equal(node.byClass('day-part').length, 1, 'only Morning should render a section');
    assert.equal(node.firstByClass('day-part').firstByClass('day-part-name').textContent, 'Morning');
  });
});

test('renderDay: clicking a .day-part-header toggles body.hidden, aria-expanded, and .is-open (twice = reverts)', () => {
  withDom(() => {
    const node = renderDay(multiBucketFixture(), 'plan').node;
    const header = node.firstByClass('day-part-header');
    // Find this header's section + body — they share the same parent section.
    const section = node.byClass('day-part')[0];
    const body = section.firstByClass('day-part-body');

    // Initial state: closed.
    assert.equal(body.hidden, true);
    assert.equal(header.getAttribute('aria-expanded'), 'false');
    assert.equal(section.classList.contains('is-open'), false);

    // First click: open.
    header._fire('click');
    assert.equal(body.hidden, false, 'body becomes visible on first click');
    assert.equal(header.getAttribute('aria-expanded'), 'true');
    assert.ok(section.classList.contains('is-open'), 'section gains .is-open');

    // Second click: revert to closed.
    header._fire('click');
    assert.equal(body.hidden, true, 'body hides again on second click');
    assert.equal(header.getAttribute('aria-expanded'), 'false');
    assert.equal(section.classList.contains('is-open'), false);
  });
});

test('renderDay: walking-distance origin is preserved ACROSS bucket boundaries (Morning origin → Afternoon rec)', () => {
  withDom(() => {
    // The fixture: plan[0] (09:00, Morning) Yasaka has coords. plan[1] (13:00,
    // Afternoon) has a rec with coords. If buildPlanItem received a per-bucket
    // index instead of indexInPlan, nearestPrecedingCoords would scan an empty
    // afternoon-only slice and find no origin. So the rec-walk's presence —
    // and the "from Yasaka Shrine" label — is the load-bearing proof.
    const node = renderDay(multiBucketFixture(), 'plan').node;
    const walks = node.byClass('rec-walk');
    assert.equal(walks.length, 1, 'one walking-distance line for the lone coord-bearing rec');
    assert.match(walks[0].textContent, /from Yasaka Shrine/,
      'the walk should originate from the preceding Morning stop, proving indexInPlan threaded across buckets');
  });
});

test('renderDay: a .plan-list still exists nested inside the .day-part-body (regression safety)', () => {
  withDom(() => {
    const node = renderDay(multiBucketFixture(), 'plan').node;
    const list = node.firstByClass('plan-list');
    assert.ok(list, 'expected at least one plan-list to survive the bucket refactor');
    assert.equal(list.tagName, 'OL');
    // And every plan-list must live inside a day-part-body (not as a free-floating child).
    const allLists = node.byClass('plan-list');
    assert.equal(allLists.length, 3, 'one list per bucket');
    // Each list is nested under a .day-part-body — verify by traversal.
    node.byClass('day-part-body').forEach((b) => {
      assert.ok(b.firstByClass('plan-list'),
        'each day-part-body wraps a plan-list (lists no longer float at the day-view root)');
    });
  });
});

test('renderDay: sparse day (empty plan) still renders the placeholder and NO .day-part sections leak through', () => {
  withDom(() => {
    const sparse = {
      date: '2026-06-25', dayNumber: 10, base: 'Kyoto', title: 'A quiet day',
      intro: 'Nothing planned yet.', photos: [], plan: [], lodging: null,
    };
    const node = renderDay(sparse, 'plan').node;
    assert.ok(node.firstByClass('placeholder-title'),
      'sparse day must still render the "details coming" placeholder');
    assert.equal(node.byClass('day-part').length, 0,
      'no day-part sections for an empty plan — the bucket loop must short-circuit');
    assert.equal(node.firstByClass('plan-section'), null,
      'no plan-section wrapper either');
  });
});

// ===========================================================================
// enrich-transit-data-model — mode-aware pill, .plan-transit block, checkout
// ===========================================================================
//
// These tests exercise:
//   (1) resolveTagLabel: the pill label is mode-aware for transit items with a
//       structured transit.mode, and falls back to 'Transit' otherwise.
//   (2) buildTransitBlock: a .plan-transit element is rendered under the title
//       with the line name(s), the chained stops, and the (possibly summed)
//       minutes. Items without a transit object render no .plan-transit block.
//   (3) Multi-leg journeys: a `transfer` chains both line names (with ' + '),
//       both stops (with ' → '), and sums the minutes.
//   (4) The new 'checkout' tag renders a pill labeled 'Checkout' with the
//       `tag-checkout` class.
//   (5) Data integrity: every authored transit item with a structured transit
//       object has a valid mode + populated from/to strings.

// Tiny single-day fixture seeded with one plan item — caller can override the
// item to focus each assertion. dayPart bucketing puts a 09:00 item into the
// Morning bucket; that bucket auto-expands in the DOM stub since the
// click-to-open behavior is irrelevant here (the items always exist in the
// tree even when collapsed; `byClass` walks all descendants).
function transitDayFixture(item) {
  return {
    date: '2026-06-24',
    dayNumber: 9,
    base: 'Kyoto',
    title: 'Transit-fixture day',
    intro: 'Just one plan item.',
    photos: [],
    lodging: null,
    plan: [item],
  };
}

test('resolveTagLabel: transit item with transit.mode="bus" renders pill text "Bus"', () => {
  withDom(() => {
    const item = {
      time: '09:00', tag: 'transit', title: 'Hop the bus',
      transit: { mode: 'bus', from: 'A', to: 'B' },
    };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    const pill = node.firstByClass('plan-tag');
    assert.ok(pill, 'plan-tag pill should exist');
    assert.equal(pill.textContent, 'Bus');
  });
});

test('resolveTagLabel: transit item with transit.mode="train" renders pill text "Train"', () => {
  withDom(() => {
    const item = {
      time: '09:00', tag: 'transit', title: 'Catch the train',
      transit: { mode: 'train', from: 'A', to: 'B' },
    };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    const pill = node.firstByClass('plan-tag');
    assert.equal(pill.textContent, 'Train');
  });
});

test('resolveTagLabel: transit item with transit.mode="subway" renders pill text "Subway"', () => {
  withDom(() => {
    const item = {
      time: '09:00', tag: 'transit', title: 'Take the subway',
      transit: { mode: 'subway', from: 'A', to: 'B' },
    };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    const pill = node.firstByClass('plan-tag');
    assert.equal(pill.textContent, 'Subway');
  });
});

test('resolveTagLabel: transit item WITHOUT a transit object falls back to "Transit"', () => {
  withDom(() => {
    const item = { time: '09:00', tag: 'transit', title: 'Bare transit item' };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    const pill = node.firstByClass('plan-tag');
    assert.equal(pill.textContent, 'Transit');
  });
});

test('renderDay: transit item with structured transit renders a .plan-transit block with line, stops, and minutes', () => {
  withDom(() => {
    const item = {
      time: '09:00', tag: 'transit', title: 'Bus to the temple',
      transit: { mode: 'bus', line: 'X-line', from: 'A', to: 'B', minutes: 20 },
    };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    const block = node.firstByClass('plan-transit');
    assert.ok(block, 'a .plan-transit block should be rendered for structured transit data');
    // Line row: the line name appears in textContent (emoji span is separate).
    const lineRow = block.firstByClass('plan-transit-line-name');
    assert.ok(lineRow, 'should render a .plan-transit-line-name span');
    assert.equal(lineRow.textContent, 'X-line');
    // Stops row: "A → B".
    const stopsRow = block.firstByClass('plan-transit-stops');
    assert.ok(stopsRow, 'should render a .plan-transit-stops row');
    assert.equal(stopsRow.textContent, 'A → B');
    // Minutes row: "20 min".
    const minutesRow = block.firstByClass('plan-transit-minutes');
    assert.ok(minutesRow, 'should render a .plan-transit-minutes row');
    assert.equal(minutesRow.textContent, '20 min');
  });
});

test('renderDay: transit item WITHOUT a transit object renders NO .plan-transit block', () => {
  withDom(() => {
    const item = { time: '09:00', tag: 'transit', title: 'Bare transit item' };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    assert.equal(node.firstByClass('plan-transit'), null,
      'no .plan-transit element should be rendered when transit data is absent');
  });
});

test('renderDay: multi-leg transit chains stops "A → B → C", joins line names with " + ", and sums minutes', () => {
  withDom(() => {
    const item = {
      time: '09:00', tag: 'transit', title: 'Subway then bus',
      transit: {
        mode: 'subway', line: 'L1', from: 'A', to: 'B', minutes: 10,
        transfer: { mode: 'bus', line: 'L2', from: 'B', to: 'C', minutes: 15 },
      },
    };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    const block = node.firstByClass('plan-transit');
    assert.ok(block, 'multi-leg structured transit should still render a .plan-transit block');
    // Line name joins both legs with " + ".
    const lineRow = block.firstByClass('plan-transit-line-name');
    assert.equal(lineRow.textContent, 'L1 + L2');
    // Stops chain A → B → C.
    const stopsRow = block.firstByClass('plan-transit-stops');
    assert.equal(stopsRow.textContent, 'A → B → C');
    // Minutes summed: 10 + 15 = 25.
    const minutesRow = block.firstByClass('plan-transit-minutes');
    assert.equal(minutesRow.textContent, '25 min');
  });
});

test('renderDay: a plan item with tag="checkout" renders pill "Checkout" with class tag-checkout', () => {
  withDom(() => {
    const item = { time: '09:30', tag: 'checkout', title: 'Hotel checkout' };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    const pill = node.firstByClass('plan-tag');
    assert.ok(pill, 'checkout item should render a plan-tag pill');
    assert.equal(pill.textContent, 'Checkout');
    assert.ok(pill.classList.contains('tag-checkout'),
      'checkout pill should carry the tag-checkout modifier class for theming');
  });
});

test('data integrity: every authored transit plan item with a structured transit object has mode in {bus,train,subway} + populated from/to strings', () => {
  const validModes = new Set(['bus', 'train', 'subway']);
  let structuredCount = 0;
  DAYS.forEach((day) => {
    (day.plan ?? []).forEach((item, i) => {
      if (item?.tag !== 'transit') return;
      if (!item.transit) return; // intentional fallbacks (e.g. international flight) — OK.
      structuredCount++;
      const where = `${day.date} plan[${i}] "${item.title ?? ''}"`;
      assert.equal(typeof item.transit.mode, 'string', `${where}: transit.mode must be a string`);
      assert.ok(validModes.has(item.transit.mode),
        `${where}: transit.mode must be one of bus|train|subway, got "${item.transit.mode}"`);
      assert.equal(typeof item.transit.from, 'string', `${where}: transit.from must be a string`);
      assert.ok(item.transit.from.length > 0, `${where}: transit.from must be non-empty`);
      assert.equal(typeof item.transit.to, 'string', `${where}: transit.to must be a string`);
      assert.ok(item.transit.to.length > 0, `${where}: transit.to must be non-empty`);
    });
  });
  // Sanity check that we actually iterated authored structured transit items —
  // the task says 15 of them exist; assert at least 10 so a future data
  // regression that strips out the new field doesn't silently pass this test.
  assert.ok(structuredCount >= 10,
    `expected at least 10 structured transit items in DAYS, found ${structuredCount}`);
});

// ----- buildTransitBlock edge-case branches -----------------------------------
// These guard the three conditional branches inside buildTransitBlock that the
// happy-path tests above do not exercise:
//   - line present but minutes omitted → no .plan-transit-minutes row
//   - line omitted but minutes present → no .plan-transit-line row
//   - missing endpoint (no `to`)       → no .plan-transit block at all

test('renderDay: transit with line but no minutes omits the .plan-transit-minutes row', () => {
  withDom(() => {
    const item = {
      time: '09:00', tag: 'transit', title: 'Bus, unknown duration',
      transit: { mode: 'bus', line: 'L1', from: 'A', to: 'B' },
    };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    const block = node.firstByClass('plan-transit');
    assert.ok(block, 'block should still render when line + endpoints are present');
    // Line + stops rows present.
    assert.ok(block.firstByClass('plan-transit-line'),
      'line row should render when transit.line is present');
    assert.ok(block.firstByClass('plan-transit-stops'),
      'stops row should always render when block renders');
    // Minutes row absent.
    assert.equal(block.firstByClass('plan-transit-minutes'), null,
      'minutes row should be skipped when transit.minutes is omitted');
  });
});

test('renderDay: transit with minutes but no line omits the .plan-transit-line row', () => {
  withDom(() => {
    const item = {
      time: '09:00', tag: 'transit', title: 'Unnamed bus',
      transit: { mode: 'bus', from: 'A', to: 'B', minutes: 20 },
    };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    const block = node.firstByClass('plan-transit');
    assert.ok(block, 'block should render when endpoints + minutes are present');
    // Stops + minutes rows present.
    assert.ok(block.firstByClass('plan-transit-stops'),
      'stops row should always render when block renders');
    const minutesRow = block.firstByClass('plan-transit-minutes');
    assert.ok(minutesRow, 'minutes row should render when transit.minutes is present');
    assert.equal(minutesRow.textContent, '20 min');
    // Line row absent (no transit.line and no transfer.line).
    assert.equal(block.firstByClass('plan-transit-line'), null,
      'line row should be skipped when both transit.line and transfer.line are absent');
  });
});

test('renderDay: transit missing an endpoint (no `to`) renders NO .plan-transit block', () => {
  withDom(() => {
    const item = {
      time: '09:00', tag: 'transit', title: 'Incomplete transit data',
      transit: { mode: 'bus', from: 'A' },
    };
    const node = renderDay(transitDayFixture(item), 'plan').node;
    assert.equal(node.firstByClass('plan-transit'), null,
      'buildTransitBlock should early-return null when from/to are not both populated');
  });
});

// ===========================================================================
// auth-password-gate — the network-free auth seams exported by app.js.
//
// app.js gates the whole app behind a shared Firebase-Auth account. The real
// SDK is loaded via a dynamic import() inside the browser-only boot block
// (guarded by `typeof document !== 'undefined'`), so none of that runs under
// `node --test`. The developer carved out three pure/injectable seams for us:
//   - shouldShowApp(user)      — pure decision
//   - friendlyAuthError(err)   — pure error mapping (must not leak codes/email)
//   - wireAuthGate(deps)       — wiring driven by injected stubs (no SDK)
// Real-browser concerns (the CDN SDK actually loading, the overlay's CSS
// fade, focus behaviour in a live AT tree) belong to VERIFY-APP, not here.
// ===========================================================================

// The shared handle is hardcoded in app.js (SHARED_EMAIL) but not exported. We
// assert friendly errors never leak it, so we pin the literal here.
const SHARED_EMAIL = 'jacob.press3@gmail.com';

// --- shouldShowApp ----------------------------------------------------------

test('shouldShowApp returns true for a truthy auth user', () => {
  assert.equal(shouldShowApp({ uid: 'abc123' }), true);
  // Any non-empty object/string is "a user" as far as the gate cares.
  assert.equal(shouldShowApp('user'), true);
});

test('shouldShowApp returns false for null (signed out)', () => {
  assert.equal(shouldShowApp(null), false);
});

test('shouldShowApp returns false for undefined (no callback arg)', () => {
  assert.equal(shouldShowApp(undefined), false);
});

// --- friendlyAuthError ------------------------------------------------------

/** Assert a message is user-facing safe: never the raw code, never the email. */
function assertNonLeaky(msg) {
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0, 'message should be non-empty');
  assert.ok(!msg.includes('auth/'), `message must not leak a raw code: "${msg}"`);
  assert.ok(!msg.includes(SHARED_EMAIL), `message must not leak the shared email: "${msg}"`);
}

test('friendlyAuthError maps auth/wrong-password to a friendly, non-leaky message', () => {
  const msg = friendlyAuthError({ code: 'auth/wrong-password' });
  assertNonLeaky(msg);
  assert.match(msg, /password/i);
});

test('friendlyAuthError maps auth/invalid-credential to the same friendly password message', () => {
  const msg = friendlyAuthError({ code: 'auth/invalid-credential' });
  assertNonLeaky(msg);
  assert.match(msg, /password/i);
});

test('friendlyAuthError maps auth/network-request-failed to a friendly network message', () => {
  const msg = friendlyAuthError({ code: 'auth/network-request-failed' });
  assertNonLeaky(msg);
  assert.match(msg, /network|connection/i);
});

test('friendlyAuthError maps auth/too-many-requests to a friendly throttle message', () => {
  const msg = friendlyAuthError({ code: 'auth/too-many-requests' });
  assertNonLeaky(msg);
  assert.match(msg, /too many|wait|moment/i);
});

test('friendlyAuthError returns a safe generic fallback for an unknown code', () => {
  const msg = friendlyAuthError({ code: 'auth/some-brand-new-code' });
  assertNonLeaky(msg);
});

test('friendlyAuthError returns a safe generic fallback for an empty/missing error', () => {
  // null, undefined, {} and a bare Error all hit the default branch.
  for (const err of [null, undefined, {}, new Error('boom'), 'string-error', 42]) {
    assertNonLeaky(friendlyAuthError(err));
  }
});

test('friendlyAuthError never echoes the raw code even when the code looks like a sentence', () => {
  // Defensive: an attacker-influenced or odd error object must still be scrubbed.
  const msg = friendlyAuthError({ code: 'auth/wrong-password — contact jacob.press3@gmail.com' });
  assertNonLeaky(msg);
});

// --- wireAuthGate -----------------------------------------------------------

/**
 * Build the stub DOM surface wireAuthGate wires against, plus a capturing
 * onAuthStateChanged stub and a controllable signIn stub. Returns everything a
 * test needs to drive the gate deterministically (no SDK, no timers, no net).
 */
function makeGateHarness({ signInImpl } = {}) {
  const overlay = new StubElement('div');
  const form = new StubElement('form');
  const passwordInput = new StubElement('input');
  passwordInput.value = '';
  const submitBtn = new StubElement('button');
  const errorEl = new StubElement('p');
  errorEl.hidden = true;

  let authCb = null;
  const onAuthStateChanged = (cb) => { authCb = cb; };

  const signInCalls = [];
  const signIn = (email, password) => {
    signInCalls.push([email, password]);
    return signInImpl ? signInImpl(email, password) : Promise.resolve({ uid: 'ok' });
  };

  const onAuthed = (() => {
    const fn = (...a) => { fn.calls.push(a); };
    fn.calls = [];
    return fn;
  })();
  const onSignedOut = (() => {
    const fn = (...a) => { fn.calls.push(a); };
    fn.calls = [];
    return fn;
  })();

  return {
    overlay, form, passwordInput, submitBtn, errorEl,
    onAuthStateChanged, signIn, signInCalls, onAuthed, onSignedOut,
    deps: () => ({
      onAuthStateChanged, signIn, overlay, form, passwordInput,
      submitBtn, errorEl, onAuthed, onSignedOut,
    }),
    fireAuth: (user) => authCb(user),
    submit: () => form._fire('submit', { preventDefault() {} }),
  };
}

/** Let the submit handler's Promise.resolve().then().catch() chain settle. */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('wireAuthGate shows the overlay immediately on wiring (before any callback)', () => {
  withDom(() => {
    const h = makeGateHarness();
    wireAuthGate(h.deps());
    assert.equal(h.overlay.hidden, false, 'gate must cover the app up-front');
    // Nothing mounted yet — no user has appeared.
    assert.equal(h.onAuthed.calls.length, 0);
  });
});

test('wireAuthGate reveals the app and hides the overlay when a user appears', () => {
  withDom(() => {
    const h = makeGateHarness();
    wireAuthGate(h.deps());
    h.fireAuth({ uid: 'abc' });
    assert.equal(h.overlay.hidden, true, 'overlay hidden once authed');
    assert.equal(h.onAuthed.calls.length, 1, 'app mounted exactly once');
  });
});

test('wireAuthGate mounts the app only once across repeated user callbacks', () => {
  withDom(() => {
    const h = makeGateHarness();
    wireAuthGate(h.deps());
    h.fireAuth({ uid: 'abc' });
    h.fireAuth({ uid: 'abc' }); // token refresh re-fires the same user
    assert.equal(h.onAuthed.calls.length, 1, 'onAuthed is idempotent');
  });
});

test('wireAuthGate re-shows the overlay on sign-out after a prior sign-in', () => {
  withDom(() => {
    const h = makeGateHarness();
    wireAuthGate(h.deps());
    h.fireAuth({ uid: 'abc' });
    assert.equal(h.overlay.hidden, true);
    h.fireAuth(null); // signed out
    assert.equal(h.overlay.hidden, false, 'overlay re-covers the app on sign-out');
    assert.equal(h.onSignedOut.calls.length >= 1, true, 'onSignedOut invoked');
  });
});

test('wireAuthGate submit calls signIn with (SHARED_EMAIL, password)', async () => {
  await withDom(async () => {
    const h = makeGateHarness();
    wireAuthGate(h.deps());
    h.passwordInput.value = 'hunter2';
    h.submit();
    await flushMicrotasks();
    assert.equal(h.signInCalls.length, 1, 'signIn called once');
    assert.deepEqual(h.signInCalls[0], [SHARED_EMAIL, 'hunter2']);
  });
});

test('wireAuthGate submit disables submit while pending (no double-submit)', async () => {
  await withDom(async () => {
    // signIn that never resolves → the gate stays in the pending state.
    const h = makeGateHarness({ signInImpl: () => new Promise(() => {}) });
    wireAuthGate(h.deps());
    h.passwordInput.value = 'hunter2';
    h.submit();
    await flushMicrotasks();
    assert.equal(h.submitBtn.disabled, true, 'submit disabled while signing in');
  });
});

test('wireAuthGate empty password does NOT call signIn and shows a prompt', () => {
  withDom(() => {
    const h = makeGateHarness();
    wireAuthGate(h.deps());
    h.passwordInput.value = ''; // nothing typed
    h.submit();
    assert.equal(h.signInCalls.length, 0, 'must not attempt sign-in with no password');
    assert.equal(h.errorEl.hidden, false, 'an inline prompt should appear');
    assert.ok(h.errorEl.textContent.length > 0);
  });
});

test('wireAuthGate on sign-in rejection shows the friendly error, clears the field, re-enables submit', async () => {
  await withDom(async () => {
    const h = makeGateHarness({
      signInImpl: () => Promise.reject({ code: 'auth/wrong-password' }),
    });
    wireAuthGate(h.deps());
    h.passwordInput.value = 'bad-pass';
    h.submit();
    await flushMicrotasks();

    // Friendly, non-leaky error surfaced.
    assert.equal(h.errorEl.hidden, false, 'error region revealed');
    assertNonLeaky(h.errorEl.textContent);
    assert.match(h.errorEl.textContent, /password/i);
    // Field cleared (never retain the typed password) and submit re-enabled.
    assert.equal(h.passwordInput.value, '', 'password field cleared after failure');
    assert.equal(h.submitBtn.disabled, false, 'submit re-enabled so the user can retry');
  });
});

test('wireAuthGate does not throw when signIn throws synchronously', async () => {
  await withDom(async () => {
    const h = makeGateHarness({
      signInImpl: () => { throw new Error('SDK exploded'); },
    });
    wireAuthGate(h.deps());
    h.passwordInput.value = 'whatever';
    assert.doesNotThrow(() => h.submit(), 'submit must swallow a thrown SDK error');
    await flushMicrotasks();
    // The synchronous throw is caught by the promise chain → friendly fallback.
    assert.equal(h.errorEl.hidden, false);
    assertNonLeaky(h.errorEl.textContent);
    assert.equal(h.submitBtn.disabled, false, 'submit re-enabled after the failure');
  });
});

test('wireAuthGate clears a stale error when a new submit begins', async () => {
  await withDom(async () => {
    const h = makeGateHarness({
      signInImpl: () => new Promise(() => {}), // pending: lets us inspect mid-flight
    });
    wireAuthGate(h.deps());
    // Seed a leftover error from a previous attempt.
    h.errorEl.textContent = 'old error';
    h.errorEl.hidden = false;
    h.passwordInput.value = 'retry-pass';
    h.submit();
    await flushMicrotasks();
    assert.equal(h.errorEl.textContent, '', 'prior error cleared on a fresh valid submit');
  });
});

test('wireAuthGate tolerates a missing optional onSignedOut (no throw on sign-out)', () => {
  withDom(() => {
    const h = makeGateHarness();
    const deps = h.deps();
    delete deps.onSignedOut;
    wireAuthGate(deps);
    assert.doesNotThrow(() => h.fireAuth(null), 'sign-out must not require onSignedOut');
  });
});

// After sign-out the bootstrap tears down #app-root (onSignedOut), so the
// mount-once latch must reset to let a later re-sign-in re-mount the app — else
// re-auth would un-hide an emptied root. (Pins the appMounted reset.)
test('wireAuthGate re-mounts the app on re-sign-in after a sign-out', () => {
  withDom(() => {
    const h = makeGateHarness();
    wireAuthGate(h.deps());
    h.fireAuth({ uid: 'abc' });      // first sign-in → mount
    assert.equal(h.onAuthed.calls.length, 1);
    h.fireAuth(null);                // sign-out → teardown path
    h.fireAuth({ uid: 'abc' });      // re-sign-in → must mount again
    assert.equal(h.onAuthed.calls.length, 2, 'onAuthed fires again after a sign-out + re-sign-in');
  });
});

// --- installSubmitGuard (pre-wire native-submission leak guard) --------------
//
// REGRESSION: in the async boot(), the gate is shown + the password focused
// BEFORE the Firebase SDK import resolves; wireAuthGate (with the real submit
// preventDefault) installs only AFTER those awaits. The #login-form has no
// `action`, so a native submit during that window would GET index.html?password=
// <typed>, leaking the one shared secret into the URL/history/referrer/SW fetch.
// installSubmitGuard neutralizes native submission synchronously, independent of
// the SDK import. These drive the guard directly through the DOM stub (no SDK).

/** A synthetic submit event that records whether preventDefault was called. */
function makeSubmitEvent() {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

test('installSubmitGuard makes a native form submit preventDefault (no leaky GET)', () => {
  withDom(() => {
    const form = new StubElement('form');
    assert.equal(installSubmitGuard(form), true, 'guard reports it attached');
    const evt = makeSubmitEvent();
    form._fire('submit', evt);
    assert.equal(evt.defaultPrevented, true, 'native submission is neutralized before any await');
  });
});

test('installSubmitGuard is independent of wireAuthGate (guards the pre-wire window)', () => {
  withDom(() => {
    // Only the guard is installed — wireAuthGate has NOT run yet (the SDK import
    // is still pending in the real boot). A submit must still be prevented.
    const form = new StubElement('form');
    installSubmitGuard(form);
    const evt = makeSubmitEvent();
    form._fire('submit', evt);
    assert.equal(evt.defaultPrevented, true, 'submit blocked with no wireAuthGate handler present');
  });
});

test('installSubmitGuard is harmless / idempotent alongside wireAuthGate', async () => {
  await withDom(async () => {
    const h = makeGateHarness();
    installSubmitGuard(h.form);     // early guard
    wireAuthGate(h.deps());         // real handler added on top
    const evt = makeSubmitEvent();
    h.passwordInput.value = 'hunter2';
    h.form._fire('submit', evt);
    await flushMicrotasks();        // let the sign-in microtask chain settle
    // Both handlers ran; preventDefault stays asserted, sign-in still attempted.
    assert.equal(evt.defaultPrevented, true, 'double preventDefault is fine');
    assert.equal(h.signInCalls.length, 1, 'wireAuthGate still drives the sign-in');
  });
});

test('installSubmitGuard returns false for a missing/invalid form (no throw)', () => {
  assert.equal(installSubmitGuard(null), false);
  assert.equal(installSubmitGuard(undefined), false);
  assert.equal(installSubmitGuard({}), false, 'object without addEventListener is ignored');
});
