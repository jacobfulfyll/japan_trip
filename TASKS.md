# Tasks

## Active Tasks

### harden-exif-subifd-truncation-null
**Task**: EXIF slice-truncation evidence → null degrade (never the IFD0 edit-time fallback)
**Pipeline**: code-workflow
**Branch**: task/harden-exif-subifd-truncation-null
**Worktree**: .worktree/harden-exif-subifd-truncation-null
**Base**: main
**Started**: 2026-06-10
**Files**:
- MOD: app.js
- MOD: app.test.js
- MOD: sw.js
- MOD: sw.test.js
- MOD: CLAUDE.md
- MOD: README.md
- MOD: CHANGELOG.md

### export-downscale-router-seam
**Task**: Extract exported buildDownscaleRouter factory so the worker→main retry contract is unit-testable
**Pipeline**: code-workflow
**Branch**: task/export-downscale-router-seam
**Worktree**: .worktree/export-downscale-router-seam
**Base**: main
**Started**: 2026-06-10
**Files**:
- MOD: app.js
- MOD: app.test.js
- MOD: sw.js
- MOD: sw.test.js
- MOD: CLAUDE.md
- MOD: README.md
- MOD: CHANGELOG.md

### fix-modal-stack-overlaps
**Task**: Topmost-only keyboard trap for stacked overlays + sweep stale finished upload sheet at next run
**Pipeline**: code-workflow
**Branch**: task/fix-modal-stack-overlaps
**Worktree**: .worktree/fix-modal-stack-overlaps
**Base**: main
**Started**: 2026-06-10
**Files**:
- MOD: app.js
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
<!-- v2.1 polish/perf on the photo journal + day-view UX. ALL SIX tasks below touch app.js + bump sw.js CACHE_VERSION → MUTUALLY CONFLICTING; run SERIALLY in listed order, reconciling CACHE_VERSION to the next FREE value at each merge (currently v36 after minimize-upload-modal merged 2026-06-09; lockstep: sw.js:23 + sw.test.js pinned title + assert — check main at merge time, not branch time). make-gallery-scrollable HARD-depends on harden-upload-bail-path (same downscale-result destructure). Each task also updates the test-count claim in CLAUDE.md/README/CHANGELOG. All tiered fable:high by user decision (serial chain, 7 days to trip): run pickup sessions on Fable, e.g. /reggie-code-workflow --tier fable:high. NOTE 2026-06-10: chain COMPLETE (all six shipped); fable tiering retired — newer chains use opus (see v2.2). -->

### Photo Journal v2.2 — Live-Test Fixes
<!-- From 2026-06-09/10 live photo testing + ungroomed-debt triage (16-agent researched+verified 2026-06-10). DEPLOY-STATE GOTCHA: origin/main = 4e8d343 (TEMP date-shift build — CACHE_VERSION v40 is CONSUMED on the live site); local main = 8ab3daf (UNPUSHED revert, back to v39 + real dates). The FIRST code task to merge bumps v39→v41 (SKIP v40 — reuse risks byte-identical sw.js → devices stuck on the shifted build); later merges take the next FREE version, sw.test.js pin in lockstep, re-derived from origin/main at MERGE time. The first push also carries the 8ab3daf revert. The five code tasks all touch app.js + bump CACHE_VERSION → MUTUALLY CONFLICTING; run SERIALLY in listed order. (fix-photo-storage-cors: manual, COMPLETED 2026-06-10 — bucket CORS set, gallery renders live.) Tiers per user decision 2026-06-10: opus:high for complex tasks, opus:medium for fully-specified simple ones. -->
### Ungroomed

<!-- Discovered-issue backlog (code). Surfaced by pipeline stages; not yet groomed into tasks. (Previous 5 code items triaged 2026-06-10 via /reggie-init-tasks: 2 formalized standalone, 2 bundled into fix-modal-stack-overlaps, 1 pruned — see the v2.2 section + HISTORY.md.) -->

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
