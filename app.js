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
// Mount seam — downstream date-time-aware-navigation will decide which day +
// framing to show. renderInto() is kept as the public mount point (the API
// contract downstream tasks depend on). For now it renders one representative
// day so the screen is viewable.
// ---------------------------------------------------------------------------

// Tracks the live day-view controller so a re-render can stop its slideshow
// timer before mounting a new one (no orphaned intervals).
let activeDayView = null;

/**
 * Mount a day-view into a root element. Defaults to the first fully-populated
 * day (Jun 24) in 'plan' framing so the screen renders standalone. Clears the
 * previous render and stops its slideshow timer first.
 * @param {HTMLElement} rootEl
 * @param {object|null} [day] day object (defaults to getDay("2026-06-24"))
 * @param {'anticipation'|'plan'|'reminisce'} [framing='plan']
 */
export function renderInto(rootEl, day = getDay('2026-06-24'), framing = 'plan') {
  if (!rootEl) {
    console.warn('[app] renderInto called without a root element.');
    return;
  }

  if (activeDayView) {
    activeDayView.stop();
    activeDayView = null;
  }

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

if (typeof document !== 'undefined') {
  const boot = () => {
    const root = document.getElementById('app-root');
    if (root) renderInto(root);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
