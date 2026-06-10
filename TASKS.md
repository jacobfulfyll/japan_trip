# Tasks

## Active Tasks

### make-map-links-directions
**Task**: Map pins open Google Maps directions from current location (📍 = directions everywhere; ⓘ = place page on rec cards)
**Pipeline**: code-workflow
**Branch**: task/make-map-links-directions
**Worktree**: .worktree/make-map-links-directions
**Base**: main
**Started**: 2026-06-10
**Files**:
- MOD: app.js
- MOD: index.html
- MOD: app.test.js
- MOD: sw.js
- MOD: sw.test.js
- MOD: CLAUDE.md
- MOD: README.md
- MOD: CHANGELOG.md

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

### Photo Journal & Nav Polish (v2.1)
<!-- v2.1 polish/perf on the photo journal + day-view UX. ALL SIX tasks below touch app.js + bump sw.js CACHE_VERSION → MUTUALLY CONFLICTING; run SERIALLY in listed order, reconciling CACHE_VERSION to the next FREE value at each merge (currently v36 after minimize-upload-modal merged 2026-06-09; lockstep: sw.js:23 + sw.test.js pinned title + assert — check main at merge time, not branch time). make-gallery-scrollable HARD-depends on harden-upload-bail-path (same downscale-result destructure). Each task also updates the test-count claim in CLAUDE.md/README/CHANGELOG. All tiered fable:high by user decision (serial chain, 7 days to trip): run pickup sessions on Fable, e.g. /reggie-code-workflow --tier fable:high. -->
### Ungroomed

<!-- Discovered-issue backlog (code). Surfaced by pipeline stages; not yet groomed into tasks. (Previous 7 items triaged 2026-06-09 via /reggie-init-tasks: 2 formalized, 2 merged into harden-upload-bail-path, 3 pruned — see HISTORY.md.) -->
- [ ] export-downscale-router-seam: The worker→main-thread retry decision in `downscaleRouted` has no Node-reachable test seam (unexported browser-only closure inside `buildOnAddPhotos`) — extract/export a small `buildDownscaleRouter(workerDownscale, throttledDownscale)` factory so the retry contract is unit-testable without spawning a worker (discovered during WRITE-TESTS of harden-upload-bail-path)
  > Tech debt, not a bug: the retry outcome is covered at the wirePhotoSync seam + a worker-failure precondition test; only the routing decision itself is untestable from Node.
- [ ] harden-exif-subifd-truncation-null: `readExifDateTimeOriginal` falls back to IFD0 `0x0132 DateTime` (edit time) when the 128KB slice cuts off the Exif sub-IFD — a wrong NON-NULL timestamp instead of a null degrade (discovered during REVIEW of slice-exif-read)
  > app.js:2408 region — when the 0x8769 sub-IFD pointer EXISTS but its target/value lies beyond the buffer end (truncation evidence), return null instead of falling through to IFD0 DateTime; keep the fallback when the sub-IFD is absent or intact-but-lacks-0x9003. Violates "degraded never wrong"; only exotic >64KB-pre-EXIF editor exports hit it (~0 incidence for phone photos). Needs a fixture with IFD0 0x0132 + late sub-IFD.
- [ ] stacked-modal-keydown-traps: Two body-mounted modals (non-dismissible progress sheet + batch-date prompt) now overlap, each with its own document-level keydown focus trap and aria-modal="true" — keyboard correctness depends on listener registration order (discovered during REVIEW of slice-exif-read)
  > buildModalSheet open() (app.js ~2864) installs per-modal document keydown with no stacking awareness; focusables() doesn't exclude hidden elements, and close() restores focus to a lastFocused captured behind the still-open sheet. Suggested: suspend the under-sheet's trap while a child modal is open, skip hidden in focusables(), and make only the topmost dialog aria-modal. NOTE: overlaps minimize-upload-modal's territory (it restructures the sheet) — groom together.
- [ ] release-upload-latch-on-done: wirePhotoSync's `running` latch releases at finish() while the summary sheet still awaits its Done click — a second Add-photos tap stacks a second sheet over the finished one (pre-existing on main, surfaced during REVIEW of slice-exif-read)
  > app.js ~3255-3265 — finish() → return → finally{running=false} with the sheet mounted; suggested: release the latch from the sheet's Done/close, or destroy any prior finished sheet at the next mount. UX wart, not a leak (both sheets dismissible in reverse order). Also overlaps minimize-upload-modal's territory.
- [ ] fix-pickfiles-pending-leak: `pickFilesBrowser` (app.js ~3336) leaves its hidden `<input type="file">` and promise pending forever if the browser fires neither `change` nor `cancel` (older Safari cancel path) — each subsequent pick orphans one detached input (discovered during IMPLEMENT review of minimize-upload-modal)
  > Harmless slow leak, not a bug users see; consider a focus/visibilitychange-based settle or input reuse.

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
