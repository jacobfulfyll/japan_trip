# Tasks

## Active Tasks

### slice-exif-read
**Task**: Read only first ~128KB per file for EXIF + mount the progress sheet immediately ("Preparing photos…") — fixes the picker→progress dead air
**Pipeline**: code-workflow
**Branch**: task/slice-exif-read
**Worktree**: .worktree/slice-exif-read
**Base**: main
**Started**: 2026-06-09
**Files**:
- MOD: app.js
- MOD: app.test.js
- MOD: sw.js
- MOD: sw.test.js
- MOD: CLAUDE.md
- MOD: README.md
- MOD: CHANGELOG.md

---

### harden-upload-bail-path
**Task**: Downscale failure → one main-thread retry → still failing → silently upload ORIGINAL bytes with TRUE contentType/extension (magic-byte sniff)
**Pipeline**: code-workflow
**Branch**: task/harden-upload-bail-path
**Worktree**: .worktree/harden-upload-bail-path
**Base**: main
**Started**: 2026-06-09
**Files**:
- MOD: app.js
- MOD: app.test.js
- MOD: sw.js
- MOD: sw.test.js
- MOD: CLAUDE.md
- MOD: README.md
- MOD: CHANGELOG.md

---

### minimize-upload-modal
**Task**: "–" + backdrop-tap minimize the upload modal to a floating pill (live "N of M", tap to re-expand, "✓ N added" auto-fade) + interrupted-run detection (jt:upload-run marker with heartbeat, boot-only stale check, one-shot recovery notice)
**Pipeline**: code-workflow
**Branch**: task/minimize-upload-modal
**Worktree**: .worktree/minimize-upload-modal
**Base**: main
**Started**: 2026-06-09
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
<!-- v2.1 polish/perf on the photo journal + day-view UX. ALL SIX tasks below touch app.js + bump sw.js CACHE_VERSION → MUTUALLY CONFLICTING; run SERIALLY in listed order, reconciling CACHE_VERSION to the next FREE value at each merge (currently v33; lockstep: sw.js:23 + sw.test.js:623 title + :626 assert — check main at merge time, not branch time). make-gallery-scrollable HARD-depends on harden-upload-bail-path (same downscale-result destructure). Each task also updates the test-count claim in CLAUDE.md/README/CHANGELOG. All tiered fable:high by user decision (serial chain, 7 days to trip): run pickup sessions on Fable, e.g. /reggie-code-workflow --tier fable:high. -->
- [ ] make-gallery-scrollable: Remove 12-photo reminisce cap — ~66vh internally-scrollable chronological mosaic (portrait spans 2 rows, landscape 2 cols, row-dense) from width/height recorded at upload via the downscale bitmap; lazy lightbox + neighbor preload; scrollTop restore across live rebuilds; crossorigin imgs; storage.persist(); RUNTIME_MAX_ENTRIES 140→450 [P1] [depends: harden-upload-bail-path] [conflicts: slice-exif-read, harden-upload-bail-path, minimize-upload-modal, make-map-links-directions, harden-uploaded-url-origin] [complex] [tier: fable:high] [code] [planned]
  files: app.js (MOD), photo-worker.js (MOD), index.html (MOD), app.test.js (MOD), sw.js (MOD), sw.test.js (MOD), CLAUDE.md (MOD), README.md (MOD), CHANGELOG.md (MOD)
- [ ] make-map-links-directions: Map pins open Google Maps directions from current location (📍 = directions everywhere; ⓘ = place page on rec cards) — render-time URL rewrite, no data edits, no travelmode forced [P2] [conflicts: slice-exif-read, harden-upload-bail-path, make-gallery-scrollable, minimize-upload-modal, harden-uploaded-url-origin] [simple] [tier: fable:high] [code] [planned]
  files: app.js (MOD), index.html (MOD), app.test.js (MOD), sw.js (MOD), sw.test.js (MOD), CLAUDE.md (MOD), README.md (MOD), CHANGELOG.md (MOD)
- [ ] harden-uploaded-url-origin: Constrain uploaded photo URLs in the reminisce gallery to the Firebase Storage origin (allowlist on mergeGalleryPhotos' uploaded branch; authored/relative unaffected) — defense-in-depth [P3] [conflicts: slice-exif-read, harden-upload-bail-path, make-gallery-scrollable, minimize-upload-modal, make-map-links-directions] [simple] [tier: fable:high] [code] [planned]
  files: app.js (MOD), app.test.js (MOD), sw.js (MOD), sw.test.js (MOD), CLAUDE.md (MOD), README.md (MOD), CHANGELOG.md (MOD)

### Ungroomed

<!-- Discovered-issue backlog (code). Surfaced by pipeline stages; not yet groomed into tasks. (Previous 7 items triaged 2026-06-09 via /reggie-init-tasks: 2 formalized, 2 merged into harden-upload-bail-path, 3 pruned — see HISTORY.md.) -->
- [ ] export-downscale-router-seam: The worker→main-thread retry decision in `downscaleRouted` has no Node-reachable test seam (unexported browser-only closure inside `buildOnAddPhotos`) — extract/export a small `buildDownscaleRouter(workerDownscale, throttledDownscale)` factory so the retry contract is unit-testable without spawning a worker (discovered during WRITE-TESTS of harden-upload-bail-path)
  > Tech debt, not a bug: the retry outcome is covered at the wirePhotoSync seam + a worker-failure precondition test; only the routing decision itself is untestable from Node.
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
