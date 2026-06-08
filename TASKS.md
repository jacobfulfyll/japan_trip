# Tasks

## Active Tasks

### reminisce-gallery-live
**Task**: Reminisce gallery goes live — merge authored + uploaded photos per day, onSnapshot, offline-cached
**Pipeline**: code-workflow
**Branch**: task/reminisce-gallery-live
**Worktree**: .worktree/reminisce-gallery-live
**Base**: redesign-reminisce-view
**Started**: 2026-06-08
**Files**:
- MOD: app.js
- MOD: index.html
- MOD: sw.js
- MOD: sw.test.js

---

## Backlog

### Trip Content & Schedule
<!-- Data edits to data/days.js (the trip content). All touch data/days.js + share a sw.js CACHE_VERSION bump → mutually conflicting; run serially. -->

### Trip Bookings (manual)
<!-- Real-world reservations already authored as reserved plan items in data/days.js; these tasks are the act of booking them. No code changes. Walk each via /reggie-manual-task <slug>. -->
- [ ] reserve-jun26-shigetsu-lunch: Reserve Shigetsu shojin-ryori lunch at Tenryu-ji Jun 26 (4 ppl, lunch-only) [P2] [simple] [tier: sonnet:medium] [manual] [planned]
  files: external (restaurant reservation)

### Firebase Photo Journal (v2 — after v1)
<!-- Four-task plan (replaces the old photo-upload-flow + reminisce-photo-gallery). Serial critical path: nav-redesign → firebase-photo-rules → photo-upload-flow → reminisce-gallery-live. Tasks 1/3/4 all touch app.js + index.html (+ sw.js for #4) → run serially, reconciling sw.js CACHE_VERSION to the next free value at each merge. -->
- [ ] firebase-photo-rules: Console — Storage/Firestore rules for trip-photos/** + photos/syncState (authed, size/type caps); confirm no composite index [P1] [simple] [tier: opus:high] [manual] [planned]
  files: external (Firebase console)

### Ungroomed

<!-- Discovered-issue backlog (code). Surfaced by pipeline stages; not yet groomed into tasks. -->
- [ ] harden-uploaded-url-origin: When `firebase-photo-rules` is finalized, constrain uploaded photo `url`s to the Firebase Storage origin (allowlist) instead of `safeUrl`'s any-https default — defence-in-depth for the reminisce gallery's user-generated content path. Not an XSS hole today (gated by write rules + `safeUrl` + textContent); a hardening. (surfaced by reminisce-gallery-live SECURITY-REVIEW)

<!-- Real-world trip bookings, confirmations & pre-trip setup. Personal to-dos, not build tasks — kept as a deadline-ordered checklist, NOT formalized into pipelines. Today: Jun 3; trip: Jun 16–Jul 3. -->
- [ ] register-visit-japan-web: Before Jun 16 — each of the 4 travelers registers their own Visit Japan Web account + QR (a single account with empty companions = paper-form lane); screenshot every QR before boarding (surfaced authoring author-travel-arrival)
- [ ] (optional) reserve-jul2-farewell-dinner: ⏰ ~2–4 wk window is open now — IF you want a special farewell dinner Jul 2 (Ningyocho Imahan or Sushi Fukunaga)
- [ ] (optional) reserve-jun26-dinner-tenamonya: Reserve ~Jun 19 — IF you want Teppan Tavern Tenamonya for Jun 26 dinner (1-week window, ~7 tables/night, sells out)
- [ ] buy-hakone-openair-tickets: Buy Hakone Open-Air Museum tickets online before Jun 23 (skip the ticket line; −¥100 with Free Pass)
- [ ] confirm-hakone-free-pass: Confirm Hakone Free Pass coverage (2-day vs 3-day) for ALL legs — Jun 22–23 (Tozan buses, cable car, ropeway, pirate cruise) AND the Jun 24 Senkyoro→Odawara bus (Romancecar surcharge is separate, already paid)
- [ ] (optional) reserve-jun27-dinner-gyuzen: IF you want Gion Gyuzen's private room for Jun 27 (Sat) dinner — reserve ahead
- [ ] (optional) reserve-jun29-dinner-robin: IF you want Pontocho Robin for the final Kyoto night (Jun 29) — reserve ≥2 days ahead via concierge, incl. Megan's vegetarian course
- [ ] reserve-jul2-couples-massage: Book the couples massage at SPA KIOI by Swiss Perfection (30F, Prince Gallery) for Jul 2 — phone/email, ahead
- [ ] reserve-jul3-narita-express: Reserve Narita Express (N'EX) seats Tokyo Station → Narita for Jul 3 (~1 PM, for the 5:35 PM flight)
- [ ] usj-app-setup: Before the trip — all 4 install the USJ app + link your (already-purchased) passes for ride times + Super Nintendo World entry
